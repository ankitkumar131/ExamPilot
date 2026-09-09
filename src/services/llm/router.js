// Fallback router: tries providers in the user's priority order until one
// succeeds. Any failure (network, 429, 5xx, timeout, bad key...) moves to
// the next provider. Nothing is retried on auth errors for the SAME provider.
const { createProvider } = require('./providers');
const { createServiceLogger } = require('../../core/logger');

const AUTH_RE = /\b(401|403)\b|invalid.*(key|api)|unauthorized|forbidden|authentication/i;

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
        const inst = this._create(id, this.store.getProviderConfig(id));
        out[id] = { enabled: !!s.providers[id].enabled, configured: inst.isConfigured(), model: inst.model, vision: inst.supportsVision };
      } catch (e) {
        out[id] = { enabled: false, configured: false, error: e.message };
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
      let provider;
      try {
        provider = this._create(id, cfg);
      } catch (e) {
        attempts.push({ provider: id, ok: false, error: e.message });
        continue;
      }
      for (let a = 0; a < tries; a++) {
        if (onAttempt) { try { onAttempt({ provider: id, model: provider.model, attempt: a + 1 }); } catch (_) {} }
        this.log.info('LLM attempt', { task, provider: id, model: provider.model, attempt: a + 1 });
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
          attempts.push({ provider: id, ok: true, model: provider.model });
          this.log.info('LLM success', { task, provider: id, chars: (r.text || '').length });
          return { text: r.text || '', provider: id, model: provider.model, attempts };
        } catch (e) {
          clearTimeout(timer);
          if (this._cancel === ctrl) this._cancel = null;
          lastErr = e;
          const msg = String((e && e.message) || e);
          attempts.push({ provider: id, ok: false, error: msg });
          this.log.warn('LLM attempt failed, falling back', { task, provider: id, error: msg });
          if (AUTH_RE.test(msg)) break; // bad key → don't retry same provider
          if (/cancelled/i.test(msg)) {
            const err = new Error('Request cancelled');
            err.attempts = attempts;
            throw err;
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
