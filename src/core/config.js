// Central defaults + data-dir resolution. No hard dependency on Electron
// so plain `node` tooling (smoke tests) can use this module too.
const os = require('os');
const path = require('path');

function getElectronApp() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') return app;
  } catch (_) { /* not in electron main process */ }
  return null;
}

function getDataDir() {
  if (process.env.EXAMPILOT_DATA_DIR) return process.env.EXAMPILOT_DATA_DIR;
  const app = getElectronApp();
  if (app) {
    try { return app.getPath('userData'); } catch (_) { /* fall through */ }
  }
  return path.join(os.homedir(), '.exampilot');
}

const DEFAULTS = {
  app: {
    name: 'ExamPilot',
    version: '0.1.0',
    processTitle: 'ExamPilot',
  },
  window: {
    overlay: { width: 660, height: 64 },
    response: { width: 880, height: 560 },
    chat: { width: 540, height: 720 },
    sessions: { width: 1020, height: 680 },
    settings: { width: 940, height: 700 },
    onboarding: { width: 640, height: 760 },
    'stt-worker': { width: 10, height: 10 },
  },
  llm: {
    timeoutMs: 45000,
    maxTokens: 2048,
    temperature: 0.4,
    retriesPerProvider: 1,
  },
  audio: {
    sampleRate: 16000,
    channels: 1,
    vad: {
      energyFloor: 0.008,
      silenceHangoverMs: 800,
      minUtteranceMs: 400,
      maxUtteranceMs: 20000,
      preRollMs: 300,
    },
  },
  transcript: {
    maxSegments: 500,
    contextChars: 6000,
    autoAnswerDebounceMs: 1400,
  },
  session: {
    autosaveSec: 30,
    maxStoredSegments: 1000,
  },
  stealth: {
    defaultDisguise: 'Terminal ',
  },
  shortcuts: {
    screenshot: 'CommandOrControl+Shift+S',
    panic: 'CommandOrControl+Shift+H',
    toggleInteraction: 'CommandOrControl+Shift+I',
    mic: 'Alt+R',
    answer: 'CommandOrControl+Shift+A',
    chat: 'CommandOrControl+Shift+C',
    sessions: 'CommandOrControl+Shift+D',
    settings: 'CommandOrControl+,',
    clear: 'CommandOrControl+Shift+Backspace',
    quit: 'CommandOrControl+Shift+Q',
    moveUp: 'CommandOrControl+Up',
    moveDown: 'CommandOrControl+Down',
    moveLeft: 'CommandOrControl+Left',
    moveRight: 'CommandOrControl+Right',
  },
};

const SHORTCUT_LABELS = {
  screenshot: 'Screenshot + analyze',
  panic: 'Hide / show all windows (panic)',
  toggleInteraction: 'Toggle click-through',
  mic: 'Start / stop listening',
  answer: 'Force answer from transcript',
  chat: 'Open chat',
  sessions: 'Open sessions dashboard',
  settings: 'Open settings',
  clear: 'Clear session memory',
  quit: 'Quit app',
  moveUp: 'Move overlay up',
  moveDown: 'Move overlay down',
  moveLeft: 'Move overlay left',
  moveRight: 'Move overlay right',
};

class ConfigManager {
  constructor() {
    this.env = process.env.NODE_ENV || 'development';
    this.dataDir = getDataDir();
    this.config = JSON.parse(JSON.stringify(DEFAULTS));
    this.config.app.isDevelopment = this.env === 'development';
    this.config.app.dataDir = this.dataDir;
  }

  get(keyPath) {
    if (!keyPath) return this.config;
    return keyPath.split('.').reduce((obj, key) => (obj ? obj[key] : undefined), this.config);
  }

  set(keyPath, value) {
    const keys = keyPath.split('.');
    const last = keys.pop();
    const target = keys.reduce((obj, key) => { obj[key] = obj[key] || {}; return obj[key]; }, this.config);
    target[last] = value;
  }
}

module.exports = new ConfigManager();
module.exports.ConfigManager = ConfigManager;
module.exports.getDataDir = getDataDir;
module.exports.SHORTCUT_LABELS = SHORTCUT_LABELS;
