// Persistent user settings (providers, fallback order, audio, stealth...).
// Lives in the OS user-data dir (or ~/.exampilot / EXAMPILOT_DATA_DIR).
// API keys are encrypted with Electron safeStorage when available.
// Each provider holds MULTIPLE keys (apiKeys[]) — auto-rotated on rate limits.
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./config');

let safeStorage = null;
try {
  const electron = require('electron');
  if (electron && electron.safeStorage) safeStorage = electron.safeStorage;
} catch (_) { /* plain node */ }

function canEncrypt() {
  try { return !!(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()); }
  catch (_) { return false; }
}

function encSecret(plain) {
  const s = String(plain || '');
  if (!s) return { enc: 0, data: '' };
  if (canEncrypt()) {
    try { return { enc: 1, data: safeStorage.encryptString(s).toString('base64') }; }
    catch (_) { /* fall through */ }
  }
  return { enc: 0, data: Buffer.from(s, 'utf8').toString('base64') };
}

function decSecret(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj; // legacy plaintext
  if (!obj.data) return '';
  if (obj.enc === 1 && canEncrypt()) {
    try { return safeStorage.decryptString(Buffer.from(obj.data, 'base64')); }
    catch (_) { return ''; }
  }
  try { return Buffer.from(obj.data, 'base64').toString('utf8'); }
  catch (_) { return String(obj.data || ''); }
}

// Env fallback for keys (used when Settings has no key saved).
const ENV_KEY_MAP = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  groq: ['GROQ_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  together: ['TOGETHER_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  azure: ['AZURE_OPENAI_API_KEY'],
  deepgram: ['DEEPGRAM_API_KEY'],
  assemblyai: ['ASSEMBLYAI_API_KEY'],
};

function defaultProviders() {
  const p = (extra) => Object.assign(
    { enabled: false, apiKeys: [], model: '', baseUrl: '' }, extra || {}
  );
  return {
    openai: p({ model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' }),
    anthropic: p({ model: 'claude-sonnet-4-5', baseUrl: 'https://api.anthropic.com' }),
    gemini: p({ model: 'gemini-2.5-flash', baseUrl: 'https://generativelanguage.googleapis.com' }),
    groq: p({ model: 'llama-3.3-70b-versatile', baseUrl: 'https://api.groq.com/openai/v1' }),
    mistral: p({ model: 'mistral-large-latest', baseUrl: 'https://api.mistral.ai/v1' }),
    deepseek: p({ model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' }),
    together: p({ model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', baseUrl: 'https://api.together.xyz/v1' }),
    openrouter: p({ model: 'openai/gpt-4o-mini', baseUrl: 'https://openrouter.ai/api/v1' }),
    azure: p({ model: '', baseUrl: '', resource: '', deployment: '', apiVersion: '2024-08-01-preview' }),
    ollama: p({ enabled: false, model: 'llama3.1:8b', baseUrl: 'http://localhost:11434/v1' }),
    custom: p({ model: '', baseUrl: 'http://localhost:1234/v1' }),
  };
}

function defaults() {
  return {
    version: 2,
    providers: defaultProviders(),
    // Global fallback chain (first = primary). Reorder in Settings → Fallback.
    fallbackOrder: ['groq', 'gemini', 'openai', 'anthropic', 'deepseek', 'mistral', 'together', 'openrouter', 'azure', 'ollama', 'custom'],
    // Optional per-task override chains (empty = use fallbackOrder).
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
    audio: {
      sources: ['mic', 'system'],
      language: 'en',
      autoAnswer: true,
      vad: { energyFloor: 0.008, silenceHangoverMs: 800, minUtteranceMs: 400, maxUtteranceMs: 20000, preRollMs: 300 },
      linuxMonitorSource: '',
    },
    sessionDefaults: {
      mode: 'auto', language: 'python', company: '', role: '',
      resume: '', jobDescription: '', saveTranscript: true,
    },
    stealth: { enabled: true, disguiseName: 'Terminal ', hideOnShare: true },
    shortcuts: null, // null = use config defaults
    ui: { theme: 'dark' },
  };
}

function deepMerge(base, over) {
  if (Array.isArray(over)) return over.slice();
  if (over && typeof over === 'object') {
    const out = (base && typeof base === 'object' && !Array.isArray(base)) ? { ...base } : {};
    for (const k of Object.keys(over)) out[k] = deepMerge(out[k], over[k]);
    return out;
  }
  return over === undefined ? base : over;
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir || getDataDir();
    this.file = path.join(this.dataDir, 'settings.json');
    this.settings = this.load();
  }

  load() {
    const d = defaults();
    try {
      if (!fs.existsSync(this.file)) return d;
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // Decrypt secrets into memory (memory holds plaintext; disk holds ciphertext).
      this.decryptInPlace(raw);
      return deepMerge(d, raw);
    } catch (_) {
      return d;
    }
  }

  save() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const clone = JSON.parse(JSON.stringify(this.settings));
      this.encryptInPlace(clone);
      fs.writeFileSync(this.file, JSON.stringify(clone, null, 2), 'utf8');
      return true;
    } catch (_) {
      return false;
    }
  }

  decryptInPlace(obj) {
    try {
      for (const id of Object.keys(obj.providers || {})) {
        const p = obj.providers[id];
        if (Array.isArray(p.apiKeys)) {
          p.apiKeys = p.apiKeys.map(decSecret).filter(Boolean);
        } else if (p.apiKey !== undefined) {
          // v1 migration: single apiKey string → apiKeys array.
          const v = decSecret(p.apiKey);
          p.apiKeys = v ? [v] : [];
          delete p.apiKey;
        } else {
          p.apiKeys = [];
        }
      }
      const s = obj.stt || {};
      if (s.openaiWhisper) s.openaiWhisper.apiKey = decSecret(s.openaiWhisper.apiKey);
      if (s.deepgram) s.deepgram.apiKey = decSecret(s.deepgram.apiKey);
      if (s.assemblyai) s.assemblyai.apiKey = decSecret(s.assemblyai.apiKey);
      if (s.azure) s.azure.key = decSecret(s.azure.key);
    } catch (_) { /* keep going */ }
  }

  encryptInPlace(obj) {
    for (const id of Object.keys(obj.providers || {})) {
      const p = obj.providers[id];
      if (Array.isArray(p.apiKeys)) {
        p.apiKeys = p.apiKeys.filter((k) => k).map(encSecret);
      } else if (typeof p.apiKey === 'string') {
        p.apiKeys = p.apiKey ? [encSecret(p.apiKey)] : [];
        delete p.apiKey;
      } else {
        p.apiKeys = [];
      }
    }
    const s = obj.stt || {};
    if (s.openaiWhisper && typeof s.openaiWhisper.apiKey === 'string') s.openaiWhisper.apiKey = encSecret(s.openaiWhisper.apiKey);
    if (s.deepgram && typeof s.deepgram.apiKey === 'string') s.deepgram.apiKey = encSecret(s.deepgram.apiKey);
    if (s.assemblyai && typeof s.assemblyai.apiKey === 'string') s.assemblyai.apiKey = encSecret(s.assemblyai.apiKey);
    if (s.azure && typeof s.azure.key === 'string') s.azure.key = encSecret(s.azure.key);
  }

  get(keyPath) {
    if (!keyPath) return this.settings;
    return keyPath.split('.').reduce((o, k) => (o ? o[k] : undefined), this.settings);
  }

  set(keyPath, value) {
    const keys = keyPath.split('.');
    const last = keys.pop();
    const t = keys.reduce((o, k) => { o[k] = o[k] || {}; return o[k]; }, this.settings);
    t[last] = value;
    this.save();
  }

  update(patch) {
    this.settings = deepMerge(this.settings, patch || {});
    this.save();
    return this.settings;
  }

  envKeyFor(providerId) {
    const names = ENV_KEY_MAP[providerId] || [];
    for (const n of names) {
      if (process.env[n]) return process.env[n];
    }
    return '';
  }

  // Effective provider config: apiKeys[] = stored keys (+ env key appended
  // as last resort). apiKey = first key (primary).
  getProviderConfig(id) {
    const p = this.settings.providers[id] || {};
    let keys = [];
    if (Array.isArray(p.apiKeys)) keys = p.apiKeys.filter(Boolean);
    else if (typeof p.apiKey === 'string' && p.apiKey) keys = [p.apiKey];
    const env = this.envKeyFor(id);
    if (env && !keys.includes(env)) keys = keys.concat([env]);
    const cfg = { ...p, apiKeys: keys, apiKey: keys[0] || '' };
    if (id === 'azure') {
      cfg.resource = p.resource || process.env.AZURE_OPENAI_RESOURCE || '';
      cfg.deployment = p.deployment || process.env.AZURE_OPENAI_DEPLOYMENT || p.model || '';
      cfg.apiVersion = p.apiVersion || process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview';
    }
    return cfg;
  }

  getSttConfig(id) {
    const s = this.settings.stt || {};
    if (id === 'whisper-local') {
      return {
        enabled: s.whisperLocal?.enabled !== false,
        command: s.whisperLocal?.command || process.env.WHISPER_COMMAND || 'whisper',
        model: s.whisperLocal?.model || process.env.WHISPER_MODEL || 'small',
        language: s.whisperLocal?.language || process.env.WHISPER_LANGUAGE || 'auto',
      };
    }
    if (id === 'openai-whisper') {
      return { ...(s.openaiWhisper || {}), apiKey: s.openaiWhisper?.apiKey || process.env.OPENAI_API_KEY || '' };
    }
    if (id === 'deepgram') return { ...(s.deepgram || {}), apiKey: s.deepgram?.apiKey || this.envKeyFor('deepgram') };
    if (id === 'assemblyai') return { ...(s.assemblyai || {}), apiKey: s.assemblyai?.apiKey || this.envKeyFor('assemblyai') };
    if (id === 'azure') {
      return {
        ...(s.azure || {}),
        key: s.azure?.key || process.env.AZURE_SPEECH_KEY || '',
        region: s.azure?.region || process.env.AZURE_SPEECH_REGION || '',
      };
    }
    return {};
  }

  // Safe copy for the renderer (keys masked, positions preserved for merging).
  publicSettings() {
    const clone = JSON.parse(JSON.stringify(this.settings));
    for (const id of Object.keys(clone.providers || {})) {
      const cp = clone.providers[id];
      const arr = Array.isArray(cp.apiKeys) ? cp.apiKeys : (cp.apiKey ? [cp.apiKey] : []);
      cp.apiKeys = arr.filter(Boolean).map((k) => {
        const s = String(k);
        return s.startsWith('••••') ? s : '••••••' + s.slice(-4);
      });
      delete cp.apiKey;
      cp.hasKey = cp.apiKeys.length > 0 || !!this.envKeyFor(id);
    }
    const mask = (v) => (v ? '••••••' + String(v).slice(-4) : '');
    if (clone.stt?.openaiWhisper) clone.stt.openaiWhisper.apiKey = mask(clone.stt.openaiWhisper.apiKey);
    if (clone.stt?.deepgram) clone.stt.deepgram.apiKey = mask(clone.stt.deepgram.apiKey);
    if (clone.stt?.assemblyai) clone.stt.assemblyai.apiKey = mask(clone.stt.assemblyai.apiKey);
    if (clone.stt?.azure) clone.stt.azure.key = mask(clone.stt.azure.key);
    return clone;
  }
}

let singleton = null;
function getStore(dataDir) {
  if (!singleton) singleton = new Store(dataDir);
  return singleton;
}

module.exports = { Store, getStore, defaults };
