// Fallback router: tries providers in the user's priority order until one
// succeeds. Any failure (network, 429, 5xx, timeout, bad key...) moves to
// the next provider. Nothing is retried on auth errors for the SAME provider.
const { createProvider } = require('./providers');
const { createServiceLogger } = require('../../core/logger');

const AUTH_RE = /\b(401|403)\b|invalid.*(key|api)|unauthorized|forbidden|authentication/i;
const RATE_RE = /\b429\b|rate.?limit|quota|insufficient.*(quota|credit|balance)|too many requests/i;

class LLMRouter {
  constructor({ store, config } = {}) {
    this.store = store;
    this.config = config;
    this.log = createServiceLogger('LLM');
    this._create = (id, cfg) => createProvider(id, cfg); // test seam
    this._cancel = null;
  }

  cancel() {
    try { if (this._cancel) this._cancel.abort(new Error('cancelled')); } catch (_) {}
    this._cancel = null;
  }

  resolveOrder(task = 'answering', needsVision = false) {
    const s = this.store.settings;
    const override = s.taskRoutes && s.taskRoutes[task];
    const order = (override && override.length ? override : s.fallbackOrder) || [];
    return order.filter((id) => {
      const p = (s.providers || {})[id];
      if (!p || !p.enabled) return false;
      try {
        const inst = this._create(id, this.store.getProviderConfig(id));
        if (!inst.isConfigured()) return false;
        if (needsVision && !inst.supportsVision) return false;
        return true;
      } catch (_) {
        return false;
      }
    });
  }

  status() {
    const s = this.store.settings;
    const out = {};
    for (const id of Object.keys(s.providers || {})) {
      try {
        const cfg = this.store.getProviderConfig(id);
        const inst = this._create(id, cfg);
        out[id] = { enabled: !!s.providers[id].enabled, configured: inst.isConfigured(), model: inst.model, vision: inst.supportsVision, keyCount: (cfg.apiKeys || []).length };
      } catch (e) {
        out[id] = { enabled: false, configured: false, error: e.message, keyCount: 0 };
      }
    }
    return out;
  }

  async complete({ task = 'answering', messages, images = [], onToken, onAttempt, maxTokens, temperature, timeoutMs }) {
    const needsVision = !!(images && images.length);
    const order = this.resolveOrder(task, needsVision);
    if (!order.length) {
      throw new Error('No AI providers configured. Open Settings → Providers and add at least one API key (or enable Ollama).');
    }
    const llmCfg = (this.store.settings && this.store.settings.llm) || {};
    const tries = 1 + (llmCfg.retriesPerProvider ?? 1);
    const timeout = timeoutMs || llmCfg.timeoutMs || 45000;
    const attempts = [];
    let lastErr = null;

    for (const id of order) {
      const cfg = this.store.getProviderConfig(id);
      const keys = ((cfg.apiKeys && cfg.apiKeys.length ? cfg.apiKeys : [cfg.apiKey]) || []).filter(Boolean);
      if (!keys.length) continue;
      let providerFailed = false; // non-key error → skip remaining keys, go to next provider
      for (let ki = 0; ki < keys.length && !providerFailed; ki++) {
        const key = keys[ki];
        let provider;
        try {
          provider = this._create(id, { ...cfg, apiKey: key });
        } catch (e) {
          attempts.push({ provider: id, key: ki + 1, ok: false, error: e.message });
          continue;
        }
        for (let a = 0; a < tries; a++) {
          if (onAttempt) { try { onAttempt({ provider: id, model: provider.model, attempt: a + 1, key: ki + 1, keys: keys.length }); } catch (_) {} }
          this.log.info('LLM attempt', { task, provider: id, model: provider.model, key: `${ki + 1}/${keys.length}`, attempt: a + 1 });
          const ctrl = new AbortController();
          this._cancel = ctrl;
          const timer = setTimeout(() => ctrl.abort(new Error(`timeout after ${timeout}ms`)), timeout);
          try {
            const r = await provider.chat({
              messages, images,
              signal: ctrl.signal,
              maxTokens: maxTokens || llmCfg.maxTokens || 2048,
              temperature: temperature ?? llmCfg.temperature ?? 0.4,
              onToken,
            });
            clearTimeout(timer);
            this._cancel = null;
            attempts.push({ provider: id, key: ki + 1, ok: true, model: provider.model });
            this.log.info('LLM success', { task, provider: id, key: ki + 1, chars: (r.text || '').length });
            return { text: r.text || '', provider: id, model: provider.model, key: ki + 1, attempts };
          } catch (e) {
            clearTimeout(timer);
            if (this._cancel === ctrl) this._cancel = null;
            lastErr = e;
            const msg = String((e && e.message) || e);
            attempts.push({ provider: id, key: ki + 1, ok: false, error: msg });
            this.log.warn('LLM attempt failed, falling back', { task, provider: id, key: ki + 1, error: msg });
            if (/cancelled/i.test(msg)) {
              const err = new Error('Request cancelled');
              err.attempts = attempts;
              throw err;
            }
            if (AUTH_RE.test(msg) || RATE_RE.test(msg)) break; // bad/limited key → try next key
            providerFailed = true; // outage/network/timeout → try next provider
            break;
          }
        }
      }
    }
    const err = new Error(`All AI providers failed (${order.join(' → ')}). Last error: ${lastErr ? lastErr.message : 'unknown'}`);
    err.attempts = attempts;
    throw err;
  }
}

module.exports = LLMRouter;
