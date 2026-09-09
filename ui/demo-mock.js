// Demo fallback so UI pages render in a plain browser (LIVE PREVIEW) and
// degrade gracefully if the bridge is ever missing. In Electron this file
// loads but `window.electronAPI` takes precedence.
(function () {
  if (window.electronAPI) return;
  const demoSettings = {
    providers: {
      openai: { enabled: true, apiKey: '••••sk1', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', hasKey: true },
      anthropic: { enabled: true, apiKey: '••••sk2', model: 'claude-sonnet-4-5', baseUrl: 'https://api.anthropic.com', hasKey: true },
      gemini: { enabled: true, apiKey: '••••sk3', model: 'gemini-2.5-flash', baseUrl: 'https://generativelanguage.googleapis.com', hasKey: true },
      groq: { enabled: true, apiKey: '••••sk4', model: 'llama-3.3-70b-versatile', baseUrl: 'https://api.groq.com/openai/v1', hasKey: true },
      mistral: { enabled: false, apiKey: '', model: 'mistral-large-latest', baseUrl: 'https://api.mistral.ai/v1' },
      deepseek: { enabled: false, apiKey: '', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' },
      together: { enabled: false, apiKey: '', model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', baseUrl: 'https://api.together.xyz/v1' },
      openrouter: { enabled: false, apiKey: '', model: 'openai/gpt-4o-mini', baseUrl: 'https://openrouter.ai/api/v1' },
      azure: { enabled: false, apiKey: '', model: '', baseUrl: '', resource: '', deployment: '', apiVersion: '2024-08-01-preview' },
      ollama: { enabled: false, apiKey: '', model: 'llama3.1:8b', baseUrl: 'http://localhost:11434/v1' },
      custom: { enabled: false, apiKey: '', model: '', baseUrl: 'http://localhost:1234/v1' },
    },
    fallbackOrder: ['groq', 'gemini', 'openai', 'anthropic', 'deepseek', 'mistral', 'together', 'openrouter', 'azure', 'ollama', 'custom'],
    taskRoutes: { answering: [], vision: [], notes: [] },
    llm: { timeoutMs: 45000, maxTokens: 2048, temperature: 0.4, retriesPerProvider: 1 },
    stt: {
      order: ['whisper-local', 'openai-whisper', 'deepgram', 'assemblyai', 'azure'],
      whisperLocal: { enabled: true, command: 'whisper', model: 'small', language: 'auto' },
      openaiWhisper: { enabled: false, apiKey: '', model: 'whisper-1', baseUrl: 'https://api.openai.com/v1' },
      deepgram: { enabled: false, apiKey: '', model: 'nova-2' },
      assemblyai: { enabled: false, apiKey: '' },
      azure: { enabled: false, key: '', region: '', language: 'en-US' },
    },
    audio: { sources: ['mic', 'system'], language: 'en', autoAnswer: true, vad: { energyFloor: 0.008, silenceHangoverMs: 800, minUtteranceMs: 400, maxUtteranceMs: 20000, preRollMs: 300 }, linuxMonitorSource: '' },
    sessionDefaults: { mode: 'auto', language: 'python', company: 'Acme', role: 'Backend Engineer', resume: '', jobDescription: '', saveTranscript: true },
    stealth: { enabled: true, disguiseName: 'Terminal ', hideOnShare: true },
    shortcuts: null,
    ui: { theme: 'dark' },
  };
  const demoSessions = [
    { id: 'sess_demo1', title: 'Acme — Backend Engineer', company: 'Acme', role: 'Backend Engineer', mode: 'system-design', language: 'python', state: 'live', createdAt: Date.now() - 12 * 60000, startedAt: Date.now() - 12 * 60000, durationSec: 0, segmentCount: 24 },
    { id: 'sess_demo2', title: 'Globex — Frontend Engineer', company: 'Globex', role: 'Frontend Engineer', mode: 'coding', language: 'typescript', state: 'ended', createdAt: Date.now() - 86400000, startedAt: Date.now() - 86400000, durationSec: 1847, segmentCount: 132 },
  ];
  const ok = (v) => Promise.resolve(Object.assign({ ok: true }, v || {}));
  window.DemoMock = {
    isDemo: true,
    sendPcm() {}, sendManualStop() {},
    appGetStatus: () => ok({ listening: false, answering: false, mockMode: false, providers: {}, sttOrder: [], activeSession: demoSessions[0], autoAnswer: true }),
    audioStart: () => ok({}), audioStop: () => ok({}), audioStatus: () => ok({ listening: false }),
    loopbackGetSource: () => ok({ sourceId: null }),
    captureListDisplays: () => ok({ displays: [] }), captureFullscreen: () => ok({}),
    pickerPick: () => ok({}), pickerDone: () => ok({}), visionAnalyzeLast: () => ok({}),
    llmAsk: () => ok({ provider: 'groq' }), llmCancel: () => ok({}), llmAutoAnswer: (on) => ok({ autoAnswer: on !== false }), llmMock: () => ok({ mockMode: false }),
    transcriptGet: () => ok({ segments: [
      { id: 'd1', ts: Date.now() - 90000, speaker: 'interviewer', text: 'How would you design a rate limiter for a public API?', provider: 'deepgram' },
      { id: 'd2', ts: Date.now() - 60000, speaker: 'you', text: 'I would start with a token bucket per API key in Redis.', provider: 'deepgram' },
      { id: 'd3', ts: Date.now() - 30000, speaker: 'interviewer', text: 'How do you handle bursts and distributed consistency?', provider: 'deepgram' },
    ], autoAnswer: true }),
    transcriptClear: () => ok({}),
    sessionList: () => ok({ sessions: demoSessions }),
    sessionCreate: () => ok({ session: demoSessions[0] }),
    sessionEnd: () => ok({ session: demoSessions[1] }),
    sessionGet: () => ok({ session: demoSessions[1] }),
    sessionRemove: () => ok({}), sessionActive: () => ok({ session: demoSessions[0] }),
    sessionUpdate: () => ok({}),
    notesGet: () => ok({ notes: { raw: '## Summary\nDiscussed rate limiting...\n## Questions Asked\n- How would you design a rate limiter?\n## Next Steps\n- Follow up on caching', summary: 'Discussed rate limiting...', questions: ['How would you design a rate limiter?'], nextSteps: ['Follow up on caching'] } }),
    settingsGet: () => ok({ settings: JSON.parse(JSON.stringify(demoSettings)) }),
    settingsSave: () => ok({ settings: demoSettings }),
    settingsResetOnboarding: () => ok({}),
    providersTest: () => ok({ text: 'OK' }), providersStatus: () => ok({ status: {} }),
    whisperStatus: () => ok({ whisper: { ok: false, error: 'demo' } }),
    stealthGet: () => ok({ stealth: demoSettings.stealth }),
    stealthSet: (_p, patch) => ok({ stealth: Object.assign({}, demoSettings.stealth, patch) }),
    windowShow: () => ok({}), windowHide: () => ok({}), windowToggleAll: () => ok({}),
    windowInteractive: () => ok({}), windowResize: () => ok({}), windowMove: () => ok({}),
    shortcutsGet: () => ok({ shortcuts: { screenshot: 'CommandOrControl+Shift+S', panic: 'CommandOrControl+Shift+H', toggleInteraction: 'CommandOrControl+Shift+I', mic: 'Alt+R', answer: 'CommandOrControl+Shift+A', chat: 'CommandOrControl+Shift+C', sessions: 'CommandOrControl+Shift+D', settings: 'CommandOrControl+,', clear: 'CommandOrControl+Shift+Backspace', quit: 'CommandOrControl+Shift+Q' } }),
    shortcutsSave: (_m, map) => ok({ shortcuts: map }),
    clipboardCopy: () => ok({}), shellOpenExternal: () => ok({}),
    onboardingStatus: () => ok({ status: { needsOnboarding: false } }), onboardingComplete: () => ok({}),
    appQuit: () => ok({}),
  };
  // on* subscriptions: no-op unsubscribers.
  ['onTranscriptSegment', 'onTranscriptCleared', 'onAudioStatus', 'onAnswerStart', 'onAnswerChunk', 'onAnswerDone', 'onAnswerError', 'onProviderAttempt', 'onSessionChanged', 'onSessionActiveChanged', 'onStealthChanged', 'onInteractionModeChanged', 'onCaptureDone', 'onCaptureError', 'onListeningChanged'].forEach((k) => {
    window.DemoMock[k] = () => () => {};
  });
  window.addEventListener('DOMContentLoaded', () => {
    if (document.body && !document.getElementById('demo-banner')) {
      const b = document.createElement('div');
      b.id = 'demo-banner';
      b.textContent = 'Demo preview — run the desktop app (npm start) for live data';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#7c3aed;color:#fff;font:12px/1.4 system-ui;text-align:center;padding:4px 8px;';
      document.body.appendChild(b);
      document.body.style.paddingTop = '24px';
    }
  });
})();
