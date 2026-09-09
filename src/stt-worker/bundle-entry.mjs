// Built-in offline speech engine (runs in the hidden stt-worker window).
// Bundled for browsers with esbuild → ui/vendor/stt-bundle.js + ort wasm files.
// Uses Transformers.js (Whisper ONNX, WASM) — no Python, no ffmpeg, no keys.
// Models download once from Hugging Face Hub, then cache in the app profile.
import { pipeline, env } from '@xenova/transformers';

// Keep everything local: WASM runtime ships in ui/vendor/ort next to this bundle.
try {
  const selfSrc = (document.currentScript && document.currentScript.src) || '';
  const ortDir = selfSrc ? new URL('./ort/', selfSrc).href : new URL('./vendor/ort/', location.href).href;
  env.backends.onnx.wasm.wasmPaths = ortDir;
} catch (_) { /* fall back to defaults (CDN) */ }
env.allowRemoteModels = true;

const MODELS = {
  'tiny.en': 'Xenova/whisper-tiny.en',
  tiny: 'Xenova/whisper-tiny',
  'base.en': 'Xenova/whisper-base.en',
};
let transcriber = null;
let loadingModel = null;
let loadError = '';

function post(channel, payload) {
  try {
    if (window.electronAPI && window.electronAPI.sendSttWorkerEvent) {
      window.electronAPI.sendSttWorkerEvent(channel, payload);
    }
  } catch (_) {}
}

async function ensureModel(modelKey, onProgress) {
  const id = MODELS[modelKey] || MODELS['tiny.en'];
  if (transcriber && transcriber._modelKey === modelKey) return transcriber;
  if (loadingModel) {
    if (loadingModel.key === modelKey) return loadingModel.promise;
    await loadingModel.promise.catch(() => {});
  }
  loadError = '';
  const job = {};
  job.promise = (async () => {
    const t = await pipeline('automatic-speech-recognition', id, {
      quantized: true,
      progress_callback: (p) => {
        try { onProgress && onProgress(p); } catch (_) {}
        post('progress', { model: modelKey, status: p.status, file: p.file || '', loaded: p.loaded || 0, total: p.total || 0 });
      },
    });
    t._modelKey = modelKey;
    transcriber = t;
    post('ready', { model: modelKey });
    return t;
  })().catch((e) => {
    loadError = String((e && e.message) || e);
    post('error', { model: modelKey, error: loadError });
    throw e;
  }).finally(() => { if (loadingModel === job) loadingModel = null; });
  job.key = modelKey;
  loadingModel = job;
  return job.promise;
}

// 16kHz mono float32 in → text out. Chunks long audio like the CLI would.
async function transcribe(float32, modelKey) {
  const t = await ensureModel(modelKey || 'tiny.en');
  const out = await t(float32, {
    chunk_length_s: 30,
    stride_length_s: 5,
    task: 'transcribe',
  });
  const text = out && out.text ? String(out.text).trim() : '';
  return { text };
}

async function cacheStatus(modelKey) {
  const id = MODELS[modelKey] || MODELS['tiny.en'];
  try {
    if (transcriber && transcriber._modelKey === modelKey) return { model: modelKey, cached: true, loaded: true };
    const short = id.split('/')[1];
    const keys = await caches.keys();
    for (const k of keys) {
      try {
        const c = await caches.open(k);
        const reqs = await c.keys();
        if (reqs.some((r) => String(r.url || '').includes(short))) return { model: modelKey, cached: true, loaded: false };
      } catch (_) {}
    }
  } catch (_) {}
  return { model: modelKey, cached: false, loaded: false };
}

window.__sttWorker = { ensureModel, transcribe, cacheStatus, MODELS, isReady: () => !!transcriber };

// Wire to main via the preload bridge (same pattern as other windows).
try {
  const api = window.electronAPI;
  if (api && api.onSttWorkerJob) {
    api.onSttWorkerJob(async (job) => {
      if (!job || !job.id) return;
      try {
        if (job.type === 'status') {
          const s = await cacheStatus(job.model);
          post('status', { id: job.id, ...s, loadError });
        } else if (job.type === 'ensure') {
          await ensureModel(job.model);
          post('done', { id: job.id, ok: true, model: job.model });
        } else if (job.type === 'transcribe') {
          const pcm = Float32Array.from(job.samples || []);
          const r = await transcribe(pcm, job.model);
          post('done', { id: job.id, ok: true, text: r.text, model: job.model });
        } else {
          post('done', { id: job.id, ok: false, error: 'unknown job type' });
        }
      } catch (e) {
        post('done', { id: job.id, ok: false, error: String((e && e.message) || e) });
      }
    });
  }
  cacheStatus('tiny.en').then((s) => post('boot', s)).catch(() => post('boot', { model: 'tiny.en', cached: false }));
} catch (e) {
  post('error', { model: '', error: String((e && e.message) || e) });
}
