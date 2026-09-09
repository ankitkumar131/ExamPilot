// ExamPilot main process: stealth, windows, shortcuts, audio→STT→transcript→LLM loop.
const path = require('path');
const fs = require('fs');
const { app, ipcMain, shell, clipboard, desktopCapturer } = require('electron');

function resolveEnvPath() {
  try {
    const userDataEnv = path.join(app.getPath('userData'), '.env');
    const projectEnv = path.join(process.cwd(), '.env');
    if (!fs.existsSync(userDataEnv) && fs.existsSync(projectEnv)) return projectEnv;
    return userDataEnv;
  } catch (_) {
    try { return path.join(app.getPath('userData'), '.env'); }
    catch (_) { return path.join(process.cwd(), '.env'); }
  }
}
try { require('dotenv').config({ path: resolveEnvPath() }); } catch (_) {}

// Linux: avoid Chromium GPU-process crashes on broken Mesa/stacks.
if (process.platform === 'linux') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('in-process-gpu');
}
app.commandLine.appendSwitch('log-level', '3');

const config = require('./src/core/config');
const { getStore } = require('./src/core/store');
const { createServiceLogger } = require('./src/core/logger');
const FirstRunManager = require('./src/core/first-run');
const LLMRouter = require('./src/services/llm/router');
const { testProvider } = require('./src/services/llm/providers');
const { STTRouter, checkWhisperLocal } = require('./src/services/stt');
const { AudioService } = require('./src/services/audio.service');
const captureService = require('./src/services/capture.service');
const { TranscriptService } = require('./src/services/transcript.service');
const SessionService = require('./src/services/session.service');
const { generateNotes } = require('./src/services/notes.service');
const WindowManager = require('./src/managers/window.manager');
const ShortcutManager = require('./src/managers/shortcut.manager');
const prompts = require('./src/prompts/templates');

const logger = createServiceLogger('MAIN');

// Legacy overlay Answer-button payload: never send to the LLM, redirect to transcript-derived manual answer.
const MANUAL_ANSWER_PLACEHOLDER = '(Use the live transcript above and answer the latest question now.)';

process.on('uncaughtException', (err) => logger.error('Uncaught exception (kept alive)', { error: err && err.message }));
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection (kept alive)', { reason: String((reason && reason.message) || reason) }));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

class ApplicationController {
  constructor() {
    this.store = getStore();
    this.windows = new WindowManager({ config, store: this.store });
    this.shortcuts = new ShortcutManager();
    this.router = new LLMRouter({ store: this.store, config });
    this.stt = new STTRouter({ store: this.store });
    this.audio = new AudioService({ store: this.store, config });
    this.transcript = new TranscriptService({ config });
    this.sessions = new SessionService({ dataDir: config.get('app.dataDir'), config });
    this.firstRun = new FirstRunManager({ store: this.store, logger });
    this.chatHistory = [];
    this.mockMode = false;
    this.listening = false;
    this.answering = false;
    this.lastScreenshot = null; // { base64, mime, at }
    this.sessionSegCursor = 0;
    this.isReady = false;
    this.transcript.setAutoAnswer(this.store.settings.audio.autoAnswer !== false);
    this.syncTranscriptMode();
  }

  syncTranscriptMode() {
    try { this.transcript.setMode(this.sessionContext().mode); } catch (_) {}
  }

  // ---------- stealth identity ----------
  applyProcessStealth() {
    const on = this.store.settings.stealth.enabled !== false;
    const name = this.store.settings.stealth.disguiseName || 'Terminal ';
    try {
      if (on) { app.setName(name); process.title = name; }
      else { app.setName('ExamPilot'); process.title = 'ExamPilot'; }
    } catch (_) {}
    try {
      if (process.platform === 'win32') app.setAppUserModelId(on ? 'Microsoft.Terminal' : 'com.exampilot.app');
    } catch (_) {}
  }

  // ---------- lifecycle ----------
  async onReady() {
    if (this.isReady) return;
    this.isReady = true;
    this.applyProcessStealth();
    logger.info('ExamPilot starting', { version: config.get('app.version'), platform: process.platform });

    this.setupPermissions();
    const status = this.firstRun.getStatus();
    const showOverlay = !status.needsOnboarding;
    await this.windows.init({ showOverlay });
    if (status.needsOnboarding) {
      this.windows.show('onboarding');
    } else if (this.sessions.active()) {
      this.attachActiveSessionTranscript();
    }
    this.registerShortcuts();
    this.setupIpc();
    this.setupServiceEvents();
    this.startAutosave();
  }

  setupPermissions() {
    try {
      const { session } = require('electron');
      session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
        cb(permission === 'media' || permission === 'audioCapture');
      });
    } catch (e) {
      logger.warn('Permission handler failed', { error: e.message });
    }
  }

  effectiveShortcuts() {
    const over = this.store.settings.shortcuts;
    return { ...config.get('shortcuts'), ...(over || {}) };
  }

  registerShortcuts() {
    const s = this.effectiveShortcuts();
    this.shortcuts.registerAll(s, {
      screenshot: () => this.flowScreenshotFullscreen(),
      panic: () => this.windows.toggleAll(),
      toggleInteraction: () => this.windows.toggleInteraction(),
      mic: () => this.toggleListening(),
      answer: () => this.flowManualAnswer(),
      chat: () => this.windows.show('chat'),
      sessions: () => this.windows.show('sessions'),
      settings: () => this.windows.show('settings'),
      clear: () => this.clearMemory(),
      quit: () => app.quit(),
      moveUp: () => this.windows.moveOverlay(0, -20),
      moveDown: () => this.windows.moveOverlay(0, 20),
      moveLeft: () => this.windows.moveOverlay(-20, 0),
      moveRight: () => this.windows.moveOverlay(20, 0),
    });
  }

  // ---------- sessions + transcript ----------
  attachActiveSessionTranscript() {
    const a = this.sessions.active();
    if (a && a.transcript && a.transcript.length) {
      this.transcript.load(a.transcript);
      this.sessionSegCursor = a.transcript.length;
    }
  }

  persistNewSegments() {
    const a = this.sessions.active();
    if (!a || !a.saveTranscript) return;
    const segs = this.transcript.toJSON();
    if (segs.length > this.sessionSegCursor) {
      this.sessions.appendSegments(a.id, segs.slice(this.sessionSegCursor));
      this.sessionSegCursor = segs.length;
      this.sessions.persist();
    }
  }

  startAutosave() {
    const sec = config.get('session.autosaveSec') || 30;
    setInterval(() => { try { this.persistNewSegments(); } catch (_) {} }, sec * 1000);
  }

  sessionContext() {
    const a = this.sessions.active();
    const d = this.store.settings.sessionDefaults;
    return {
      mode: (a && a.mode) || d.mode || 'auto',
      language: (a && a.language) || d.language || 'python',
      resume: (a && a.resume) || d.resume || '',
      jobDescription: (a && a.jobDescription) || d.jobDescription || '',
      company: (a && a.company) || d.company || '',
      role: (a && a.role) || d.role || '',
      customPrompt: (a && a.customPrompt) || d.customPrompt || '',
    };
  }

  clearMemory() {
    this.transcript.clear();
    this.chatHistory = [];
    this.lastScreenshot = null;
    this.sessionSegCursor = 0;
    const a = this.sessions.active();
    if (a) { a.transcript = []; this.sessions.persist(); }
    this.windows.broadcast('transcript:cleared', {});
    logger.info('Session memory cleared');
  }

  // ---------- listening (mic + system) ----------
  async toggleListening() {
    if (this.listening) await this.stopListening();
    else await this.startListening();
  }

  async startListening() {
    const sources = this.store.settings.audio.sources || ['mic', 'system'];
    this.audio.start({ sources });
    this.listening = true;
    this.windows.broadcast('listening:changed', { listening: true, sources });
    this.windows.broadcast('audio:status', this.audio.status());
    logger.info('Listening started', { sources });
    this.checkSttReady(); // fire-and-forget: loud warning if transcription cannot work
  }

  async stopListening() {
    this.audio.stop();
    this.listening = false;
    this.persistNewSegments();
    this.windows.broadcast('listening:changed', { listening: false });
    logger.info('Listening stopped');
  }

  // Pre-flight: warn LOUDLY (never silently) if transcription cannot work.
  // Listening still starts — STT keys are read per utterance, so the user can
  // fix Settings → Audio & Speech mid-session and the next utterance works.
  async checkSttReady() {
    try {
      const order = this.stt.resolveOrder();
      if (!order.length) {
        this.windows.broadcast('answer:error', { scope: 'stt', error: 'No speech engines configured. Enable local Whisper or add an STT key in Settings → Audio & Speech.' });
        return;
      }
      if (order.length === 1 && order[0] === 'whisper-local') {
        const r = await checkWhisperLocal(this.store.getSttConfig('whisper-local'));
        if (!r.ok) {
          this.windows.broadcast('answer:error', {
            scope: 'stt',
            error: `Local Whisper CLI not found (${r.error || 'not on PATH'}). Transcription will fail until you install it (pip install openai-whisper + ffmpeg) or enable a cloud STT engine in Settings → Audio & Speech.`,
          });
        }
      }
    } catch (e) {
      logger.warn('STT readiness check failed', { error: e.message });
    }
  }

  setupServiceEvents() {
    this.audio.on('utterance', ({ source, wav }) => this.handleUtterance(source, wav).catch((e) => {
      logger.warn('Utterance handling failed', { error: e.message });
    }));
    this.transcript.on('segment', (seg) => {
      this.windows.broadcast('transcript:segment', seg);
    });
    this.transcript.on('cleared', () => this.windows.broadcast('transcript:cleared', {}));
    this.transcript.on('auto-question', ({ question, context }) => {
      this.flowAutoAnswer(question, context).catch((e) => {
        logger.warn('Auto-answer failed', { error: e.message });
      });
    });
  }

  async handleUtterance(source, wav) {
    const speaker = source === 'mic' ? 'you' : 'interviewer';
    let r;
    try {
      r = await this.stt.transcribe(wav, {
        onAttempt: (a) => this.windows.broadcast('provider:attempt', { ...a, stt: true }),
      });
    } catch (e) {
      this.windows.broadcast('answer:error', { scope: 'stt', error: e.message });
      return;
    }
    if (!r.text) return; // silence
    this.transcript.add({ speaker, text: r.text, provider: r.provider });
  }

  // ---------- answering ----------
  recentImages() {
    if (this.lastScreenshot && Date.now() - this.lastScreenshot.at < 2 * 60 * 1000) {
      return [{ mime: this.lastScreenshot.mime, base64: this.lastScreenshot.base64 }];
    }
    return [];
  }

  async runAnswer({ scope, question, context, images, task = 'answering', systemOverride, history }) {
    const hasQ = !!(question && String(question).trim());
    const hasCtx = !!(context && String(context).trim());
    const hasImg = !!(images && images.length);
    const hasHist = !!((history && history.length) || (!systemOverride && this.chatHistory.length));
    if (!hasQ && !hasCtx && !hasImg && !hasHist) {
      throw new Error('No transcript yet — start listening or take a screenshot first.');
    }
    if (this.answering) {
      // Queue-bust: cancel previous and start fresh (interviews move fast).
      try { this.router.cancel(); } catch (_) {}
    }
    this.answering = true;
    const ctx = this.sessionContext();
    const messages = systemOverride
      ? [{ role: 'system', text: systemOverride }, ...(history || []), { role: 'user', text: `Conversation:\n${context || ''}\n\nQuestion:\n${question || ''}` }]
      : prompts.buildAnswerMessages({
        mode: ctx.mode, language: ctx.language, resume: ctx.resume,
        jobDescription: ctx.jobDescription, company: ctx.company, role: ctx.role,
        customPrompt: ctx.customPrompt,
        transcriptContext: context || this.transcript.getContext(),
        question: question || this.transcript.latestQuestion(),
        history: history || this.chatHistory.slice(-10),
      });
    const imgs = images || this.recentImages();
    this.windows.show('response');
    this.windows.send('response', 'answer:start', { scope, question, task });
    this.windows.broadcast('answer:start', { scope, question, task });
    try {
      const r = await this.router.complete({
        task,
        messages,
        images: imgs,
        onAttempt: (a) => {
          this.windows.send('response', 'provider:attempt', a);
          this.windows.send('overlay', 'provider:attempt', a);
        },
        onToken: (t) => this.windows.send('response', 'answer:chunk', { scope, text: t }),
      });
      this.windows.send('response', 'answer:done', { scope, provider: r.provider, model: r.model, attempts: r.attempts });
      this.windows.send('chat', 'answer:done', { scope, provider: r.provider, model: r.model, text: r.text });
      this.windows.send('overlay', 'answer:done', { scope, provider: r.provider, model: r.model });
      return r;
    } catch (e) {
      this.windows.send('response', 'answer:error', { scope, error: e.message, attempts: e.attempts });
      this.windows.send('overlay', 'answer:error', { scope, error: e.message });
      throw e;
    } finally {
      this.answering = false;
    }
  }

  async flowAutoAnswer(question, context) {
    if (!question || !question.trim()) return;
    logger.info('Auto-answer triggered', { chars: question.length });
    await this.runAnswer({ scope: 'auto', question, context });
  }

  async flowManualAnswer() {
    const { question, context } = this.transcript.forceQuestion();
    if (!question && !context) {
      this.windows.send('overlay', 'answer:error', { scope: 'manual', error: 'No transcript yet — start listening or take a screenshot.' });
      return;
    }
    await this.runAnswer({ scope: 'manual', question, context });
  }

  async flowScreenshotFullscreen() {
    try {
      const shot = await captureService.captureAndProcess({});
      this.lastScreenshot = { base64: shot.imageBuffer.toString('base64'), mime: shot.mime, at: Date.now() };
      this.windows.broadcast('capture:done', { width: shot.width, height: shot.height });
      await this.flowVisionAnalyze('Analyze the attached screenshot for this interview.');
    } catch (e) {
      this.windows.broadcast('capture:error', { error: e.message });
    }
  }

  async flowVisionAnalyze(instruction) {
    if (!this.lastScreenshot) throw new Error('No screenshot captured');
    const ctx = this.sessionContext();
    const messages = prompts.buildVisionMessages({
      mode: ctx.mode, language: ctx.language, resume: ctx.resume,
      jobDescription: ctx.jobDescription, company: ctx.company, role: ctx.role,
      transcriptContext: this.transcript.getContext({ maxChars: 3000 }),
      instruction,
    });
    if (this.answering) { try { this.router.cancel(); } catch (_) {} }
    this.answering = true;
    this.windows.show('response');
    this.windows.send('response', 'answer:start', { scope: 'vision', task: 'vision' });
    try {
      const r = await this.router.complete({
        task: 'vision',
        messages,
        images: [{ mime: this.lastScreenshot.mime, base64: this.lastScreenshot.base64 }],
        onAttempt: (a) => {
          this.windows.send('response', 'provider:attempt', a);
          this.windows.send('chat', 'provider:attempt', a);
        },
        onToken: (t) => {
          this.windows.send('response', 'answer:chunk', { scope: 'vision', text: t });
          this.windows.send('chat', 'answer:chunk', { scope: 'vision', text: t });
        },
      });
      this.windows.send('response', 'answer:done', { scope: 'vision', provider: r.provider, model: r.model, attempts: r.attempts });
      this.windows.send('chat', 'answer:done', { scope: 'vision', provider: r.provider, model: r.model, text: r.text });
      return r;
    } catch (e) {
      this.windows.send('response', 'answer:error', { scope: 'vision', error: e.message, attempts: e.attempts });
      throw e;
    } finally {
      this.answering = false;
    }
  }

  // ---------- IPC ----------
  setupIpc() {
    const ok = (v) => ({ ok: true, ...(v || {}) });
    const fail = (e) => ({ ok: false, error: String((e && e.message) || e) });

    ipcMain.handle('app:get-status', () => ok({
      listening: this.listening,
      answering: this.answering,
      mockMode: this.mockMode,
      providers: this.router.status(),
      sttOrder: this.stt.resolveOrder(),
      activeSession: this.sessions.active(),
      autoAnswer: this.transcript.autoAnswer,
    }));

    ipcMain.handle('audio:start', async () => { await this.startListening(); return ok({}); });
    ipcMain.handle('audio:stop', async () => { await this.stopListening(); return ok({}); });
    ipcMain.handle('audio:status', () => ok({ audio: this.audio.status(), listening: this.listening }));
    ipcMain.on('audio:pcm', (_e, { source, data }) => this.audio.ingestPCM(source, data));
    ipcMain.on('audio:manual-stop', () => this.audio.manualStop());

    ipcMain.handle('loopback:get-source', async () => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        return ok({ sourceId: sources[0] ? sources[0].id : null });
      } catch (e) { return fail(e); }
    });

    ipcMain.handle('capture:list-displays', () => captureService.listDisplays());
    ipcMain.handle('capture:fullscreen', async () => {
      await this.flowScreenshotFullscreen();
      return ok({});
    });
    ipcMain.handle('vision:analyze-last', async (_e, instruction) => {
      await this.flowVisionAnalyze(instruction || 'Analyze the attached screenshot for this interview.');
      return ok({});
    });

    ipcMain.handle('llm:ask', async (_e, { text, scope }) => {
      const q = String(text || '').trim();
      if (!q) return fail(new Error('Empty message'));
      if (q === MANUAL_ANSWER_PLACEHOLDER) {
        // Legacy overlay button payload — answer from the live transcript instead
        // of sending placeholder text to the LLM. Never enters chat history.
        await this.flowManualAnswer();
        return ok({ manual: true });
      }
      this.chatHistory.push({ role: 'user', text: q });
      if (this.mockMode) {
        const ctx = this.sessionContext();
        const r = await this.runAnswer({
          scope: scope || 'mock',
          question: q,
          context: `Mock interview so far:\n${this.chatHistory.slice(-8).map((m) => `${m.role}: ${m.text}`).join('\n')}`,
          images: [],
          systemOverride: prompts.MOCK_INTERVIEWER(ctx),
          history: [],
        });
        this.chatHistory.push({ role: 'assistant', text: r.text });
        return ok({ provider: r.provider });
      }
      const r = await this.runAnswer({ scope: scope || 'chat', question: q, context: this.transcript.getContext() });
      this.chatHistory.push({ role: 'assistant', text: r.text });
      return ok({ provider: r.provider });
    });
    ipcMain.handle('llm:cancel', () => { try { this.router.cancel(); } catch (_) {} return ok({}); });
    ipcMain.handle('llm:manual-answer', async () => { await this.flowManualAnswer(); return ok({}); });
    ipcMain.handle('llm:auto-answer', (_e, on) => {
      this.transcript.setAutoAnswer(on);
      this.store.set('audio.autoAnswer', !!on);
      return ok({ autoAnswer: this.transcript.autoAnswer });
    });
    ipcMain.handle('llm:mock', (_e, on) => {
      this.mockMode = !!on;
      if (this.mockMode) {
        this.chatHistory = [];
        this.runAnswer({
          scope: 'mock', question: 'Start the mock interview with your first question.',
          context: '', images: [], systemOverride: prompts.MOCK_INTERVIEWER(this.sessionContext()), history: [],
        }).then((r) => this.chatHistory.push({ role: 'assistant', text: r.text })).catch(() => {});
      }
      return ok({ mockMode: this.mockMode });
    });

    ipcMain.handle('transcript:get', () => ok({ segments: this.transcript.toJSON(), autoAnswer: this.transcript.autoAnswer }));
    ipcMain.handle('transcript:clear', () => { this.clearMemory(); return ok({}); });

    ipcMain.handle('session:list', (_e, opts) => ok({ sessions: this.sessions.list(opts || {}) }));
    ipcMain.handle('session:create', (_e, opts) => {
      this.persistNewSegments();
      const d = this.store.settings.sessionDefaults;
      const s = this.sessions.create({ ...d, ...(opts || {}) });
      this.transcript.clear();
      this.chatHistory = [];
      this.sessionSegCursor = 0;
      this.syncTranscriptMode();
      this.windows.broadcast('session:active-changed', { session: this.sessions.active() });
      this.windows.broadcast('session:changed', {});
      return ok({ session: s });
    });
    ipcMain.handle('session:active', () => ok({ session: this.sessions.active() }));
    ipcMain.handle('session:get', (_e, id) => ok({ session: this.sessions.get(id) }));
    ipcMain.handle('session:update', (_e, { id, patch }) => ok({ session: this.sessions.update(id, patch || {}) }));
    ipcMain.handle('session:remove', (_e, id) => {
      this.sessions.remove(id);
      this.windows.broadcast('session:changed', {});
      return ok({});
    });
    ipcMain.handle('session:end', async (_e, id) => {
      const target = this.sessions.get(id) || this.sessions.active();
      if (!target) return fail(new Error('No active session'));
      this.persistNewSegments();
      let notes = null;
      try {
        const full = this.sessions.get(target.id);
        const text = (full.transcript || []).map((s) => `${s.speaker === 'you' ? 'You' : 'Interviewer'}: ${s.text}`).join('\n');
        if (text.trim().length > 50) notes = await generateNotes({ router: this.router, session: full, transcriptText: text.slice(-12000) });
      } catch (e) {
        logger.warn('Notes generation failed', { error: e.message });
      }
      const ended = this.sessions.end(target.id, { notes });
      this.windows.broadcast('session:changed', {});
      this.windows.broadcast('session:active-changed', { session: null });
      return ok({ session: ended });
    });
    ipcMain.handle('notes:get', (_e, id) => {
      const s = this.sessions.get(id);
      return ok({ notes: s ? s.notes : null });
    });

    ipcMain.handle('document:parse-pdf', async (_e, { name, base64 }) => {
      try {
        let parse;
        try { parse = require('pdf-parse'); }
        catch (_) { return fail(new Error('PDF parser not installed. Run: npm install')); }
        const buf = Buffer.from(String(base64 || ''), 'base64');
        if (!buf.length) return fail(new Error('Empty file'));
        if (buf.length > 15 * 1024 * 1024) return fail(new Error('PDF too large (max 15MB)'));
        const data = await parse(buf);
        const text = String(data.text || '').replace(/[ \t]+\n/g, '\n').trim().slice(0, 15000);
        if (!text) return fail(new Error('No readable text in this PDF (scanned image?). Try a text PDF.'));
        logger.info('PDF parsed', { name, pages: data.numpages, chars: text.length });
        return ok({ text, pages: data.numpages || 0, name });
      } catch (e) { return fail(e); }
    });

    ipcMain.handle('settings:get', () => ok({ settings: this.store.publicSettings() }));
    ipcMain.handle('settings:save', (_e, patch) => {
      // Masked placeholders (••••) mean "unchanged" — merge with stored keys by position.
      const clean = JSON.parse(JSON.stringify(patch || {}));
      if (clean.providers) {
        for (const [id, p] of Object.entries(clean.providers)) {
          const stored = (this.store.settings.providers[id] && this.store.settings.providers[id].apiKeys) || [];
          if (Array.isArray(p.apiKeys)) {
            p.apiKeys = p.apiKeys
              .map((k, i) => ((typeof k === 'string' && k.startsWith('••••')) ? (stored[i] || '') : String(k || '')))
              .filter((k) => !!k);
          }
          if (typeof p.apiKey === 'string') {
            // legacy single-key payload
            if (p.apiKey && !p.apiKey.startsWith('••••')) p.apiKeys = (p.apiKeys || []).concat([p.apiKey]);
            delete p.apiKey;
          }
        }
      }
      if (clean.stt) {
        for (const k of ['openaiWhisper', 'deepgram', 'assemblyai']) {
          if (clean.stt[k] && typeof clean.stt[k].apiKey === 'string' && clean.stt[k].apiKey.startsWith('••••')) delete clean.stt[k].apiKey;
        }
        if (clean.stt.azure && typeof clean.stt.azure.key === 'string' && clean.stt.azure.key.startsWith('••••')) delete clean.stt.azure.key;
      }
      this.store.update(clean);
      this.transcript.setAutoAnswer(this.store.settings.audio.autoAnswer !== false);
      this.syncTranscriptMode();
      this.transcript.debounceMs = 1400;
      return ok({ settings: this.store.publicSettings() });
    });
    ipcMain.handle('settings:reset-onboarding', () => { this.firstRun.reset(); return ok({}); });

    ipcMain.handle('providers:test', async (_e, { id, keyIndex, config: cfg }) => {
      try {
        const merged = { ...this.store.getProviderConfig(id), ...(cfg || {}) };
        if (!(cfg && cfg.apiKey) && keyIndex != null) {
          // Test a saved (masked) key by position.
          const list = merged.apiKeys && merged.apiKeys.length ? merged.apiKeys : (merged.apiKey ? [merged.apiKey] : []);
          merged.apiKey = list[keyIndex] || '';
        }
        const r = await testProvider(id, merged);
        return ok({ id, ...r });
      } catch (e) { return fail(e); }
    });
    ipcMain.handle('providers:status', () => ok({ status: this.router.status() }));
    ipcMain.handle('whisper:status', async () => {
      const r = await checkWhisperLocal(this.store.getSttConfig('whisper-local'));
      return ok({ whisper: r });
    });

    ipcMain.handle('stealth:get', () => ok({ stealth: this.store.settings.stealth }));
    ipcMain.handle('stealth:set', (_e, patch) => {
      this.store.update({ stealth: { ...this.store.settings.stealth, ...(patch || {}) } });
      const on = this.store.settings.stealth.enabled !== false;
      this.windows.applyStealthAll(on);
      this.applyProcessStealth();
      this.windows.broadcast('stealth:changed', { stealth: this.store.settings.stealth });
      return ok({ stealth: this.store.settings.stealth });
    });

    ipcMain.handle('window:show', (_e, name) => { this.windows.show(name); return ok({}); });
    ipcMain.handle('window:hide', (_e, name) => { this.windows.hide(name); return ok({}); });
    ipcMain.handle('window:toggle-all', () => { this.windows.toggleAll(); return ok({}); });
    ipcMain.handle('window:interactive', (_e, on) => { this.windows.setInteractive(on !== false); return ok({ interactive: this.windows.interactive }); });
    ipcMain.handle('window:resize', (_e, { name, width, height }) => { this.windows.resize(name, width, height); return ok({}); });
    ipcMain.handle('window:move', (_e, { dx, dy }) => { this.windows.moveOverlay(dx || 0, dy || 0); return ok({}); });

    ipcMain.handle('shortcuts:get', () => ok({ shortcuts: this.effectiveShortcuts() }));
    ipcMain.handle('shortcuts:save', (_e, map) => {
      this.store.set('shortcuts', { ...this.effectiveShortcuts(), ...(map || {}) });
      this.registerShortcuts();
      return ok({ shortcuts: this.effectiveShortcuts() });
    });

    ipcMain.handle('clipboard:copy', (_e, text) => {
      try { clipboard.writeText(String(text || '')); return ok({}); }
      catch (e) { return fail(e); }
    });
    ipcMain.handle('shell:open-external', (_e, url) => {
      try {
        const u = String(url || '');
        if (!/^https?:\/\//.test(u)) return fail(new Error('Blocked URL'));
        shell.openExternal(u);
        return ok({});
      } catch (e) { return fail(e); }
    });

    ipcMain.handle('onboarding:status', () => ok({ status: this.firstRun.getStatus() }));
    ipcMain.handle('onboarding:complete', () => {
      this.firstRun.complete();
      this.windows.hide('onboarding');
      this.windows.show('overlay');
      return ok({});
    });

    ipcMain.handle('app:quit', () => { app.quit(); return ok({}); });
  }
}

const controller = new ApplicationController();

app.whenReady().then(() => controller.onReady());
app.on('second-instance', () => {
  try { controller.windows.panicRestore(); } catch (_) {}
});
app.on('window-all-closed', () => {
  // Keep running in background (shortcuts stay alive); quit via shortcut/tray.
  if (process.platform === 'darwin') { /* stay alive */ }
});
app.on('activate', () => {
  try { controller.windows.show('overlay'); } catch (_) {}
});
app.on('will-quit', () => {
  try { controller.shortcuts.dispose(); } catch (_) {}
  try { controller.persistNewSegments(); } catch (_) {}
});

module.exports = controller;
