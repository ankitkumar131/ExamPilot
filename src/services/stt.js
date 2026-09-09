// Speech-to-text engines with automatic fallback:
// whisper-local → openai-whisper → deepgram → assemblyai → azure
// Input is always a 16kHz mono 16-bit WAV Buffer (see audio.service wavEncode).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createServiceLogger } = require('../core/logger');

const STT_IDS = ['whisper-local', 'openai-whisper', 'deepgram', 'assemblyai', 'azure'];
const STT_LABELS = {
  'whisper-local': 'Whisper (local CLI)',
  'openai-whisper': 'Whisper (OpenAI API)',
  deepgram: 'Deepgram',
  assemblyai: 'AssemblyAI',
  azure: 'Azure Speech',
};

function withTimeout(promise, ms, label) {
  let t;
  const gate = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms); });
  return Promise.allSettled([promise, gate]).then(() => Promise.race([promise, gate])).finally(() => clearTimeout(t));
}

function runCmd(cmd, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) { reject(e); return; }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} reject(new Error('whisper timeout')); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`whisper exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}

async function transcribeWhisperLocal(wavBuffer, cfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exampilot-whisper-'));
  const wavPath = path.join(dir, 'audio.wav');
  fs.writeFileSync(wavPath, wavBuffer);
  const parts = String(cfg.command || 'whisper').split(' ').filter(Boolean);
  const cmd = parts[0];
  const baseArgs = parts.slice(1);
  const args = [
    ...baseArgs, wavPath,
    '--model', cfg.model || 'small',
    '--output_format', 'txt',
    '--output_dir', dir,
    '--fp16', 'False',
  ];
  if (cfg.language && cfg.language !== 'auto') args.push('--language', cfg.language);
  try {
    await runCmd(cmd, args);
    const out = path.join(dir, 'audio.txt');
    const text = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim() : '';
    return { text, provider: 'whisper-local' };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function checkWhisperLocal(cfg) {
  try {
    const parts = String(cfg.command || 'whisper').split(' ').filter(Boolean);
    await runCmd(parts[0], [...parts.slice(1), '--help'], { timeoutMs: 10000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function transcribeOpenAIWhisper(wavBuffer, cfg, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  try {
    const form = new FormData();
    form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', cfg.model || 'whisper-1');
    const base = String(cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    const j = await res.json();
    return { text: (j.text || '').trim(), provider: 'openai-whisper' };
  } finally {
    clearTimeout(t);
  }
}

async function transcribeDeepgram(wavBuffer, cfg, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  try {
    const model = encodeURIComponent(cfg.model || 'nova-2');
    const res = await fetch(`https://api.deepgram.com/v1/listen?model=${model}&smart_format=true`, {
      method: 'POST',
      headers: { Authorization: `Token ${cfg.apiKey}`, 'Content-Type': 'audio/wav' },
      body: wavBuffer,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    const j = await res.json();
    const text = j.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    return { text: String(text).trim(), provider: 'deepgram' };
  } finally {
    clearTimeout(t);
  }
}

async function transcribeAssemblyAI(wavBuffer, cfg, timeoutMs) {
  const headers = { authorization: cfg.apiKey };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  try {
    const up = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'audio/wav' }, body: wavBuffer, signal: ctrl.signal,
    });
    if (!up.ok) throw new Error(`upload HTTP ${up.status}`);
    const { upload_url } = await up.json();
    const st = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_url: upload_url }), signal: ctrl.signal,
    });
    if (!st.ok) throw new Error(`transcript HTTP ${st.status}`);
    const { id } = await st.json();
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers, signal: ctrl.signal });
      if (!poll.ok) throw new Error(`poll HTTP ${poll.status}`);
      const p = await poll.json();
      if (p.status === 'completed') return { text: (p.text || '').trim(), provider: 'assemblyai' };
      if (p.status === 'error') throw new Error(`assemblyai: ${p.error || 'failed'}`);
    }
    throw new Error('assemblyai polling timeout');
  } finally {
    clearTimeout(t);
  }
}

async function transcribeAzure(wavBuffer, cfg, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  try {
    const lang = encodeURIComponent(cfg.language || 'en-US');
    const res = await fetch(`https://${cfg.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${lang}`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': cfg.key, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000' },
      body: wavBuffer,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    const j = await res.json();
    if (j.RecognitionStatus && j.RecognitionStatus !== 'Success') throw new Error(`azure: ${j.RecognitionStatus}`);
    return { text: (j.DisplayText || '').trim(), provider: 'azure' };
  } finally {
    clearTimeout(t);
  }
}

class STTRouter {
  constructor({ store } = {}) {
    this.store = store;
    this.log = createServiceLogger('STT');
    this.timeoutMs = 90000;
  }

  resolveOrder() {
    const s = this.store.settings.stt || {};
    const order = s.order && s.order.length ? s.order : STT_IDS;
    return order.filter((id) => {
      const c = this.store.getSttConfig(id);
      if (id === 'whisper-local') return c.enabled !== false;
      if (id === 'openai-whisper') return c.enabled && !!c.apiKey;
      if (id === 'azure') return c.enabled && !!c.key && !!c.region;
      return c.enabled && !!c.apiKey;
    });
  }

  async transcribe(wavBuffer, { onAttempt } = {}) {
    const order = this.resolveOrder();
    if (!order.length) throw new Error('No speech engines configured. Enable local Whisper or add an STT key in Settings → Audio & Speech.');
    let lastErr = null;
    for (const id of order) {
      const cfg = this.store.getSttConfig(id);
      if (onAttempt) { try { onAttempt({ provider: id }); } catch (_) {} }
      try {
        let r;
        if (id === 'whisper-local') r = await transcribeWhisperLocal(wavBuffer, cfg);
        else if (id === 'openai-whisper') r = await transcribeOpenAIWhisper(wavBuffer, cfg, this.timeoutMs);
        else if (id === 'deepgram') r = await transcribeDeepgram(wavBuffer, cfg, this.timeoutMs);
        else if (id === 'assemblyai') r = await transcribeAssemblyAI(wavBuffer, cfg, this.timeoutMs);
        else if (id === 'azure') r = await transcribeAzure(wavBuffer, cfg, this.timeoutMs);
        else continue;
        // Empty = silence, not failure: don't burn the fallback chain.
        return { text: r.text || '', provider: id };
      } catch (e) {
        lastErr = e;
        this.log.warn('STT engine failed, falling back', { provider: id, error: String(e.message || e) });
      }
    }
    throw new Error(`All speech engines failed. Last error: ${lastErr ? lastErr.message : 'unknown'}`);
  }
}

module.exports = { STTRouter, STT_IDS, STT_LABELS, checkWhisperLocal, withTimeout };
