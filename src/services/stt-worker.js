// Main-side driver for the hidden stt-worker window (built-in offline Whisper).
// Speaks main→worker via `stt-worker:job`, receives `stt-worker:event` back.
const { EventEmitter } = require('events');

class SttWorkerClient extends EventEmitter {
  constructor({ windows } = {}) {
    super();
    this.windows = windows;
    this.seq = 0;
    this.pending = new Map();
    this.boot = null; // last known { model, cached, loaded, loadError }
    this.lastError = '';
    this.downloadActive = false;
  }

  attach(ipcMain) {
    ipcMain.on('stt-worker:event', (_e, msg) => {
      try { this.onEvent(msg && msg.channel, msg && msg.payload); } catch (_) {}
    });
  }

  onEvent(channel, p) {
    const payload = p || {};
    if (channel === 'boot' || channel === 'ready' || channel === 'error') {
      this.boot = {
        model: payload.model || (this.boot && this.boot.model) || '',
        cached: channel === 'ready' ? true : !!payload.cached,
        loaded: channel === 'ready' ? true : !!payload.loaded,
        loadError: channel === 'error' ? (payload.error || 'worker error') : '',
      };
      if (channel === 'error') this.lastError = this.boot.loadError;
      if (channel === 'ready') { this.lastError = ''; this.downloadActive = false; }
      this.emit('status', this.boot);
    }
    if (channel === 'progress') {
      this.downloadActive = true;
      this.emit('progress', payload);
    }
    if ((channel === 'done' || channel === 'status') && payload.id && this.pending.has(payload.id)) {
      const { resolve, reject, timer } = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      clearTimeout(timer);
      if (channel === 'status' || payload.ok) resolve(payload);
      else reject(new Error(payload.error || 'speech worker failed'));
    }
  }

  send(job) {
    const win = this.windows && this.windows.get('stt-worker');
    if (!win || win.isDestroyed()) throw new Error('Speech worker window unavailable');
    this.windows.send('stt-worker', 'stt-worker:job', job);
  }

  request(type, extra = {}, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const id = `w${Date.now()}-${this.seq++}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Built-in speech worker timed out'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, type, ...extra });
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  status(model) {
    return this.request('status', { model }, 15000);
  }

  ensure(model, timeoutMs = 600000) {
    return this.request('ensure', { model }, timeoutMs);
  }

  // WAV (44-byte header + PCM16 mono 16k, see audio.service wavEncode) → text.
  transcribe(wavBuffer, model, timeoutMs = 300000) {
    let samples;
    try {
      const buf = Buffer.isBuffer(wavBuffer) ? wavBuffer : Buffer.from(wavBuffer);
      const dataStart = 44;
      const n = Math.floor((buf.length - dataStart) / 2);
      if (n <= 0) throw new Error('empty audio');
      samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(dataStart + i * 2) / 32768;
    } catch (e) {
      return Promise.reject(new Error('Bad audio for built-in engine: ' + e.message));
    }
    return this.request('transcribe', { model, samples }, timeoutMs)
      .then((p) => ({ text: (p.text || '').trim(), provider: 'whisper-builtin' }));
  }
}

module.exports = { SttWorkerClient };
