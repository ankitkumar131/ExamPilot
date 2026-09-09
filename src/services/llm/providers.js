// Multi-provider LLM layer (REST + streaming, no vendor SDKs).
// Internal message format: [{ role: 'system'|'user'|'assistant', text, images?: [{mime, base64}] }]
// Each provider converts to its own wire format.

const PROVIDER_META = {
  openai:     { label: 'OpenAI', needsKey: true, model: 'gpt-4o-mini', base: 'https://api.openai.com/v1', vision: true, kind: 'openai' },
  groq:       { label: 'Groq', needsKey: true, model: 'llama-3.3-70b-versatile', base: 'https://api.groq.com/openai/v1', vision: true, kind: 'openai' },
  mistral:    { label: 'Mistral', needsKey: true, model: 'mistral-large-latest', base: 'https://api.mistral.ai/v1', vision: true, kind: 'openai' },
  deepseek:   { label: 'DeepSeek', needsKey: true, model: 'deepseek-chat', base: 'https://api.deepseek.com/v1', vision: false, kind: 'openai' },
  together:   { label: 'Together AI', needsKey: true, model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', base: 'https://api.together.xyz/v1', vision: true, kind: 'openai' },
  openrouter: { label: 'OpenRouter', needsKey: true, model: 'openai/gpt-4o-mini', base: 'https://openrouter.ai/api/v1', vision: true, kind: 'openai' },
  ollama:     { label: 'Ollama (local)', needsKey: false, model: 'llama3.1:8b', base: 'http://localhost:11434/v1', vision: true, kind: 'openai' },
  custom:     { label: 'Custom (OpenAI-compatible)', needsKey: false, model: '', base: 'http://localhost:1234/v1', vision: true, kind: 'openai' },
  azure:      { label: 'Azure OpenAI', needsKey: true, model: '', base: '', vision: true, kind: 'azure' },
  anthropic:  { label: 'Anthropic', needsKey: true, model: 'claude-sonnet-4-5', base: 'https://api.anthropic.com', vision: true, kind: 'anthropic' },
  gemini:     { label: 'Google Gemini', needsKey: true, model: 'gemini-2.5-flash', base: 'https://generativelanguage.googleapis.com', vision: true, kind: 'gemini' },
};
const PROVIDER_IDS = Object.keys(PROVIDER_META);

function httpError(status, body) {
  const snippet = String(body || '').replace(/\s+/g, ' ').slice(0, 300);
  const err = new Error(`HTTP ${status}${snippet ? `: ${snippet}` : ''}`);
  err.status = status;
  return err;
}

function openAIDelta(json) {
  try {
    const c = json.choices && json.choices[0];
    if (!c) return '';
    if (c.delta && typeof c.delta.content === 'string') return c.delta.content;
    if (c.message && typeof c.message.content === 'string') return c.message.content;
    return '';
  } catch (_) { return ''; }
}

function anthropicDelta(json) {
  try {
    if (json.type === 'content_block_delta' && json.delta && typeof json.delta.text === 'string') return json.delta.text;
    return '';
  } catch (_) { return ''; }
}

function geminiDelta(json) {
  try {
    const cands = json.candidates || [];
    let out = '';
    for (const c of cands) {
      const parts = (c.content && c.content.parts) || [];
      for (const p of parts) if (typeof p.text === 'string') out += p.text;
    }
    return out;
  } catch (_) { return ''; }
}

// Stream `data: {...}` SSE lines from a fetch Response, calling onText per delta.
// Falls back to buffered parsing when the body isn't async-iterable.
async function pumpSSE(res, extract, onText) {
  let full = '';
  const emit = (t) => { if (t) { full += t; if (onText) onText(t); } };
  const handleLine = (line) => {
    const s = line.trim();
    if (!s.startsWith('data:')) return;
    const data = s.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try { emit(extract(JSON.parse(data))); } catch (_) { /* partial chunk */ }
  };
  try {
    if (res.body && typeof res.body[Symbol.asyncIterator] === 'function') {
      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          handleLine(buf.slice(0, idx));
          buf = buf.slice(idx + 1);
        }
      }
      if (buf.trim()) handleLine(buf);
      return full;
    }
  } catch (e) {
    if (full) return full; // keep partial progress
    throw e;
  }
  const text = await res.text();
  for (const line of text.split('\n')) handleLine(line);
  return full;
}

class BaseProvider {
  constructor(id, cfg = {}) {
    this.id = id;
    this.cfg = cfg || {};
    const meta = PROVIDER_META[id] || {};
    this.model = this.cfg.model || meta.model || '';
    this.baseUrl = String(this.cfg.baseUrl || meta.base || '').replace(/\/+$/, '');
    this.apiKey = this.cfg.apiKey || '';
  }
  get label() { return (PROVIDER_META[this.id] || {}).label || this.id; }
  get supportsVision() { return !!(PROVIDER_META[this.id] || {}).vision; }
  isConfigured() {
    const meta = PROVIDER_META[this.id] || {};
    if (this.id === 'azure') return !!(this.cfg.resource && (this.cfg.deployment || this.model) && this.apiKey);
    if (this.id === 'custom' || this.id === 'ollama') return !!this.baseUrl;
    if (!meta.needsKey) return true;
    return !!this.apiKey;
  }
  // eslint-disable-next-line no-unused-vars
  async chat(_opts) { throw new Error('not implemented'); }
}

function attachImagesToOpenAI(messages, images) {
  const msgs = messages.map((m) => ({ role: m.role, text: m.text, images: m.images || [] }));
  if (images && images.length) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { msgs[i].images = (msgs[i].images || []).concat(images); break; }
    }
  }
  return msgs.map((m) => {
    if (m.role === 'system') return { role: 'system', content: m.text };
    const imgs = (m.images || []).filter((x) => x && x.base64);
    if (!imgs.length) return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text };
    return {
      role: 'user',
      content: [
        { type: 'text', text: m.text || 'Analyze this image.' },
        ...imgs.slice(0, 4).map((x) => ({
          type: 'image_url',
          image_url: { url: `data:${x.mime || 'image/png'};base64,${x.base64}` },
        })),
      ],
    };
  });
}

class OpenAICompatibleProvider extends BaseProvider {
  buildUrl() { return `${this.baseUrl}/chat/completions`; }
  buildHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    if (this.id === 'openrouter') {
      h['HTTP-Referer'] = 'https://exampilot.local';
      h['X-Title'] = 'ExamPilot';
    }
    return h;
  }
  async chat({ messages, images, onToken, signal, maxTokens, temperature }) {
    if (!this.model) throw new Error(`${this.label}: no model configured`);
    const stream = !!onToken;
    const body = {
      model: this.model,
      messages: attachImagesToOpenAI(messages, images),
      temperature: temperature ?? 0.4,
      max_tokens: maxTokens || 2048,
      stream,
    };
    const res = await fetch(this.buildUrl(), {
      method: 'POST', headers: this.buildHeaders(), body: JSON.stringify(body), signal,
    });
    if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
    if (stream) {
      const text = await pumpSSE(res, openAIDelta, onToken);
      return { text, model: this.model, provider: this.id };
    }
    const j = await res.json();
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    return { text: String(text), model: this.model, provider: this.id };
  }
}

class AzureOpenAIProvider extends OpenAICompatibleProvider {
  buildUrl() {
    const r = this.cfg.resource;
    const d = this.cfg.deployment || this.model;
    const v = this.cfg.apiVersion || '2024-08-01-preview';
    return `https://${r}.openai.azure.com/openai/deployments/${encodeURIComponent(d)}/chat/completions?api-version=${encodeURIComponent(v)}`;
  }
  buildHeaders() {
    return { 'Content-Type': 'application/json', 'api-key': this.apiKey };
  }
  async chat(opts) {
    const keep = this.model;
    this.model = this.cfg.deployment || this.model; // deployment name goes in body for some gateways
    try {
      const body = {
        messages: attachImagesToOpenAI(opts.messages, opts.images),
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens || 2048,
        stream: !!opts.onToken,
      };
      const res = await fetch(this.buildUrl(), {
        method: 'POST', headers: this.buildHeaders(), body: JSON.stringify(body), signal: opts.signal,
      });
      if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
      if (body.stream) {
        const text = await pumpSSE(res, openAIDelta, opts.onToken);
        return { text, model: this.model, provider: this.id };
      }
      const j = await res.json();
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      return { text: String(text), model: this.model, provider: this.id };
    } finally {
      this.model = keep;
    }
  }
}

class AnthropicProvider extends BaseProvider {
  async chat({ messages, images, onToken, signal, maxTokens, temperature }) {
    let system = '';
    const msgs = [];
    for (const m of messages) {
      if (m.role === 'system') { system += (system ? '\n' : '') + m.text; continue; }
      msgs.push(m);
    }
    if (images && images.length) {
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'user') { msgs[i] = { ...msgs[i], images: (msgs[i].images || []).concat(images) }; break; }
      }
    }
    const wire = msgs.map((m) => {
      const content = [{ type: 'text', text: m.text || '' }];
      for (const img of (m.images || []).slice(0, 4)) {
        if (!img || !img.base64) continue;
        content.push({ type: 'image', source: { type: 'base64', media_type: img.mime || 'image/png', data: img.base64 } });
      }
      return { role: m.role === 'assistant' ? 'assistant' : 'user', content };
    });
    const body = {
      model: this.model, max_tokens: maxTokens || 2048,
      temperature: temperature ?? 0.4, stream: !!onToken,
      ...(system ? { system } : {}),
      messages: wire.length ? wire : [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    };
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
    if (body.stream) {
      const text = await pumpSSE(res, anthropicDelta, onToken);
      return { text, model: this.model, provider: this.id };
    }
    const j = await res.json();
    const text = (j.content || []).map((b) => (typeof b.text === 'string' ? b.text : '')).join('');
    return { text, model: this.model, provider: this.id };
  }
}

class GeminiProvider extends BaseProvider {
  toContents(messages, images) {
    let system = '';
    const contents = [];
    for (const m of messages) {
      if (m.role === 'system') { system += (system ? '\n' : '') + m.text; continue; }
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', text: m.text || '', images: m.images || [] });
    }
    if (images && images.length && contents.length) {
      const last = [...contents].reverse().find((c) => c.role === 'user') || contents[contents.length - 1];
      last.images = (last.images || []).concat(images);
    }
    return {
      system,
      contents: contents.map((c) => ({
        role: c.role,
        parts: [
          { text: c.text || 'Analyze.' },
          ...(c.images || []).slice(0, 4).filter((x) => x && x.base64)
            .map((x) => ({ inlineData: { mimeType: x.mime || 'image/png', data: x.base64 } })),
        ],
      })),
    };
  }
  async chat({ messages, images, onToken, signal, maxTokens, temperature }) {
    const { system, contents } = this.toContents(messages, images);
    const body = {
      contents: contents.length ? contents : [{ role: 'user', parts: [{ text: 'Hi' }] }],
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { temperature: temperature ?? 0.4, maxOutputTokens: maxTokens || 2048 },
    };
    const key = encodeURIComponent(this.apiKey);
    // Prefer streaming; fall back to unary on any stream failure.
    if (onToken) {
      try {
        const res = await fetch(`${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse&key=${key}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal,
        });
        if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
        const text = await pumpSSE(res, geminiDelta, onToken);
        if (text) return { text, model: this.model, provider: this.id };
      } catch (e) {
        if (signal && signal.aborted) throw e;
        if (onToken) onToken(''); // keep stream contract
        // fall through to unary
      }
    }
    const res = await fetch(`${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body), signal,
    });
    if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
    const j = await res.json();
    return { text: geminiDelta(j), model: this.model, provider: this.id };
  }
}

function createProvider(id, cfg = {}) {
  const meta = PROVIDER_META[id];
  if (!meta) throw new Error(`Unknown provider: ${id}`);
  if (meta.kind === 'anthropic') return new AnthropicProvider(id, cfg);
  if (meta.kind === 'gemini') return new GeminiProvider(id, cfg);
  if (meta.kind === 'azure') return new AzureOpenAIProvider(id, cfg);
  return new OpenAICompatibleProvider(id, cfg);
}

async function testProvider(id, cfg = {}, timeoutMs = 25000) {
  const p = createProvider(id, cfg);
  if (!p.isConfigured()) throw new Error(`${p.label}: not configured (missing key / model / URL)`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  try {
    const r = await p.chat({
      messages: [{ role: 'user', text: 'Reply with exactly: OK' }],
      signal: ctrl.signal, maxTokens: 16, temperature: 0,
    });
    return { ok: true, text: r.text.slice(0, 200), model: p.model };
  } finally {
    clearTimeout(t);
  }
}

module.exports = {
  PROVIDER_META, PROVIDER_IDS, createProvider, testProvider,
  BaseProvider, OpenAICompatibleProvider, AzureOpenAIProvider, AnthropicProvider, GeminiProvider,
  __test__: { attachImagesToOpenAI, openAIDelta, anthropicDelta, geminiDelta },
};
