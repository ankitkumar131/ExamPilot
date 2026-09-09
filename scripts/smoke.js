// Zero-dependency smoke suite: `node scripts/smoke.js` (no npm install needed).
// Covers config, store, providers, fallback router, transcript, sessions,
// prompts, VAD, notes parsing + syntax check of every JS file.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
process.env.EXAMPILOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'exampilot-smoke-'));

let pass = 0, fail = 0;
const results = [];
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pass++; results.push(`PASS  ${name}`); })
    .catch((e) => { fail++; results.push(`FAIL  ${name} :: ${e.message}`); });
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

(async () => {
  await t('config defaults + get/set', () => {
    const config = require('../src/core/config');
    assert(config.get('app.name') === 'ExamPilot', 'app name');
    assert(config.get('shortcuts.panic'), 'panic shortcut');
    config.set('x.y', 1);
    assert(config.get('x.y') === 1, 'set');
  });

  await t('store save/load + provider merge + key masking', () => {
    const { Store } = require('../src/core/store');
    const s = new Store(process.env.EXAMPILOT_DATA_DIR);
    s.set('providers.groq.enabled', true);
    s.set('providers.groq.apiKey', 'gsk-secret');
    assert(s.get('providers.groq.apiKey') === 'gsk-secret', 'key roundtrip');
    const s2 = new Store(process.env.EXAMPILOT_DATA_DIR);
    assert(s2.get('providers.groq.enabled') === true, 'persist enabled');
    assert(s2.get('providers.groq.apiKey') === 'gsk-secret', 'persist key');
    const pub = s2.publicSettings();
    assert(pub.providers.groq.apiKey.includes('••••'), 'masked');
    process.env.OPENAI_API_KEY = 'env-key-123';
    const cfg = s2.getProviderConfig('openai');
    assert(cfg.apiKey === 'env-key-123', 'env fallback key');
    delete process.env.OPENAI_API_KEY;
  });

  await t('providers registry + wire-format helpers', () => {
    const P = require('../src/services/llm/providers');
    assert(P.PROVIDER_IDS.length >= 11, 'provider count');
    const ollama = P.createProvider('ollama', { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1:8b' });
    assert(ollama.isConfigured(), 'ollama keyless configured');
    const openai = P.createProvider('openai', { apiKey: '', model: 'gpt-4o-mini' });
    assert(!openai.isConfigured(), 'openai needs key');
    const wire = P.__test__.attachImagesToOpenAI(
      [{ role: 'system', text: 's' }, { role: 'user', text: 'q' }],
      [{ mime: 'image/png', base64: 'AAA' }]
    );
    assert(wire[0].role === 'system', 'system passthrough');
    assert(Array.isArray(wire[1].content) && wire[1].content[1].type === 'image_url', 'vision attach');
    assert(P.__test__.openAIDelta({ choices: [{ delta: { content: 'hi' } }] }) === 'hi', 'openai delta');
    assert(P.__test__.anthropicDelta({ type: 'content_block_delta', delta: { text: 'yo' } }) === 'yo', 'anthropic delta');
    assert(P.__test__.geminiDelta({ candidates: [{ content: { parts: [{ text: 'g' }] } }] }) === 'g', 'gemini delta');
  });

  await t('LLM router falls back across providers in order', async () => {
    const { Store } = require('../src/core/store');
    const LLMRouter = require('../src/services/llm/router');
    const store = new Store(process.env.EXAMPILOT_DATA_DIR);
    store.update({
      providers: {
        groq: { enabled: true, apiKey: 'k', model: 'm', baseUrl: 'http://x' },
        gemini: { enabled: true, apiKey: 'k', model: 'm', baseUrl: 'http://x' },
        openai: { enabled: true, apiKey: 'k', model: 'm', baseUrl: 'http://x' },
      },
      fallbackOrder: ['groq', 'gemini', 'openai'],
      llm: { timeoutMs: 5000, maxTokens: 64, temperature: 0, retriesPerProvider: 0 },
    });
    const router = new LLMRouter({ store });
    const calls = [];
    router._create = (id) => ({
      model: 'm', supportsVision: true, isConfigured: () => true,
      chat: async () => {
        calls.push(id);
        if (id !== 'openai') throw new Error('HTTP 429: rate limited');
        return { text: 'ANSWER', model: 'm', provider: id };
      },
    });
    const r = await router.complete({ messages: [{ role: 'user', text: 'hi' }] });
    assert(r.text === 'ANSWER' && r.provider === 'openai', 'lands on third provider');
    assert(calls.join(',') === 'groq,gemini,openai', 'order respected');
    assert(r.attempts.length === 3, 'attempts recorded');
  });

  await t('LLM router errors when nothing configured', async () => {
    const { Store } = require('../src/core/store');
    const LLMRouter = require('../src/services/llm/router');
    const store = new Store(process.env.EXAMPILOT_DATA_DIR);
    store.update({ providers: { groq: { enabled: false } }, fallbackOrder: ['groq'] });
    const router = new LLMRouter({ store });
    let threw = false;
    try { await router.complete({ messages: [{ role: 'user', text: 'hi' }] }); }
    catch (e) { threw = /No AI providers/.test(e.message); }
    assert(threw, 'friendly error');
  });

  await t('transcript question detection + auto-question event', async () => {
    const { TranscriptService, isQuestionLike } = require('../src/services/transcript.service');
    assert(isQuestionLike('How does Raft work?'), 'qmark');
    assert(isQuestionLike('Explain virtual memory to me please'), 'imperative');
    assert(!isQuestionLike('ok got it'), 'not question');
    const tr = new TranscriptService({});
    tr.debounceMs = 10;
    const got = await new Promise((resolve) => {
      tr.on('auto-question', resolve);
      tr.add({ speaker: 'interviewer', text: 'Can you design a rate limiter for our API?' });
    });
    assert(got.question.includes('rate limiter'), 'auto question payload');
    assert(got.context.includes('Interviewer:'), 'context format');
  });

  await t('sessions create/list/end/remove', () => {
    const SessionService = require('../src/services/session.service');
    const svc = new SessionService({ dataDir: process.env.EXAMPILOT_DATA_DIR });
    const s = svc.create({ title: 'Acme — BE', company: 'Acme', mode: 'coding' });
    assert(s.state === 'live' && svc.active().id === s.id, 'active');
    svc.appendSegments(s.id, [{ id: '1', speaker: 'interviewer', text: 'hi', ts: Date.now() }]);
    const ended = svc.end(s.id, { notes: { raw: 'n' } });
    assert(ended.state === 'ended' && ended.notes.raw === 'n', 'ended with notes');
    assert(svc.list({}).length === 1, 'listed');
    svc.remove(s.id);
    assert(svc.list({}).length === 0, 'removed');
  });

  await t('prompts build for every mode', () => {
    const pr = require('../src/prompts/templates');
    for (const mode of pr.MODE_IDS) {
      const msgs = pr.buildAnswerMessages({
        mode, language: 'python', transcriptContext: 'Interviewer: hi', question: 'Explain X in detail please',
      });
      assert(msgs.length >= 2 && msgs[0].role === 'system' && msgs[0].text.length > 100, `mode ${mode}`);
    }
    const v = pr.buildVisionMessages({ mode: 'auto' });
    assert(v.length === 2, 'vision messages');
    assert(typeof pr.MOCK_INTERVIEWER({}) === 'string', 'mock prompt');
  });

  await t('VAD emits utterance after hangover silence', () => {
    const { VAD } = require('../src/services/audio.service');
    const got = [];
    const vad = new VAD({ energyFloor: 0.01, silenceHangoverMs: 100, minUtteranceMs: 50, maxUtteranceMs: 5000, preRollMs: 40 }, (pcm) => got.push(pcm));
    const speech = Buffer.alloc(3200);
    for (let i = 0; i < 1600; i++) speech.writeInt16LE(i % 2 ? 8000 : -8000, i * 2);
    const silence = Buffer.alloc(3200);
    vad.feed(speech); vad.feed(speech); vad.feed(silence); vad.feed(silence);
    assert(got.length === 1 && got[0].length > 1000, 'one utterance');
  });

  await t('notes parse sections', () => {
    const { parseNotes } = require('../src/services/notes.service');
    const n = parseNotes('## Summary\nDid great.\n## Questions Asked\n- What is X?\n## Next Steps\n- Follow up');
    assert(n.summary.includes('great') && n.questions.length === 1 && n.nextSteps.length === 1, 'sections');
  });

  await t('required files exist', () => {
    const files = [
      'main.js', 'preload.js', 'package.json',
      'src/core/config.js', 'src/core/logger.js', 'src/core/store.js', 'src/core/first-run.js',
      'src/services/llm/providers.js', 'src/services/llm/router.js',
      'src/services/stt.js', 'src/services/audio.service.js', 'src/services/capture.service.js',
      'src/services/transcript.service.js', 'src/services/session.service.js', 'src/services/notes.service.js',
      'src/prompts/templates.js',
      'src/managers/window.manager.js', 'src/managers/shortcut.manager.js',
      'ui/overlay.html', 'ui/response.html', 'ui/chat.html', 'ui/sessions.html',
      'ui/settings.html', 'ui/onboarding.html', 'ui/picker.html',
      'ui/markdown.js', 'ui/demo-mock.js', 'ui/index.html',
    ];
    for (const f of files) assert(fs.existsSync(path.join(ROOT, f)), `missing ${f}`);
  });

  await t('node --check on every JS file', () => {
    const walk = (dir) => {
      let out = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out = out.concat(walk(p));
        else if (e.name.endsWith('.js')) out.push(p);
      }
      return out;
    };
    for (const f of walk(ROOT)) {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    }
  });

  console.log('\n' + results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SMOKE CRASH:', e); process.exit(1); });
