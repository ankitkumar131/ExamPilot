// First-run onboarding state: needs setup until at least one LLM provider
// is enabled + has a key (or keyless local like Ollama is enabled).
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./config');

class FirstRunManager {
  constructor({ store, logger } = {}) {
    this.store = store;
    this.log = logger;
    this.dataDir = getDataDir();
    this.sentinelPath = path.join(this.dataDir, '.exampilot-onboarded');
  }

  anyProviderReady() {
    try {
      const s = this.store.settings;
      for (const id of Object.keys(s.providers || {})) {
        const p = s.providers[id];
        if (!p || !p.enabled) continue;
        const cfg = this.store.getProviderConfig(id);
        if (id === 'ollama' || id === 'custom') return true; // keyless local
        if (cfg.apiKey) return true;
      }
    } catch (_) { /* not ready */ }
    return false;
  }

  getStatus() {
    const completed = fs.existsSync(this.sentinelPath);
    const ready = this.anyProviderReady();
    return { needsOnboarding: !completed || !ready, completed, providerReady: ready };
  }

  complete() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(this.sentinelPath, new Date().toISOString(), 'utf8');
    } catch (e) {
      if (this.log) this.log.warn('Failed to write onboarding sentinel', { error: e.message });
    }
  }

  reset() {
    try { if (fs.existsSync(this.sentinelPath)) fs.unlinkSync(this.sentinelPath); } catch (_) {}
  }
}

module.exports = FirstRunManager;
