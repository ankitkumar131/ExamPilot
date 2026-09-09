// Main-process audio hub: receives 16kHz PCM16 mono from the renderer
// (mic + system loopback captured via WebAudio — no SoX/Loopback drivers),
// runs voice-activity detection, and emits utterance WAVs for STT.
// Linux fallback: PulseAudio monitor capture via `parec` (optional).
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { createServiceLogger } = require('../core/logger');

const SAMPLE_RATE = 16000;

function wavEncode(pcm16, sampleRate = SAMPLE_RATE) {
  const header = Buffer.alloc(44);
  const dataLen = pcm16.length;
  header.write('RIFF', 0); header.writeUInt32LE(36 + dataLen, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, Buffer.from(pcm16)]);
}

function frameEnergy(int16, start, len) {
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const v = int16[start + i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / len);
}

// Energy-based VAD with pre-roll, hangover, and min/max utterance guards.
class VAD {
  constructor(opts = {}, onUtterance) {
    this.o = Object.assign(
      { energyFloor: 0.008, silenceHangoverMs: 800, minUtteranceMs: 400, maxUtteranceMs: 20000, preRollMs: 300 },
      opts
    );
    this.onUtterance = onUtterance;
    this.reset();
  }
  reset() {
    this.speech = Buffer.alloc(0);
    this.preRoll = Buffer.alloc(0);
    this.preRollMax = Math.floor(SAMPLE_RATE * (this.o.preRollMs / 1000)) * 2;
    this.inSpeech = false;
    this.silenceMs = 0;
    this.speechMs = 0;
  }
  updateOpts(opts) { Object.assign(this.o, opts || {}); }
  feed(pcmBuf) {
    const FRAME = 320; // 20ms @16k
    const total = Math.floor(pcmBuf.length / 2);
    const view = new Int16Array(pcmBuf.buffer, pcmBuf.byteOffset, total);
    for (let off = 0; off < total; off += FRAME) {
      const len = Math.min(FRAME, total - off);
      const e = frameEnergy(view, off, len);
      const chunk = Buffer.from(pcmBuf.buffer, pcmBuf.byteOffset + off * 2, len * 2);
      const isSpeech = e >= this.o.energyFloor;
      if (!this.inSpeech) {
        this.preRoll = Buffer.concat([this.preRoll, chunk]);
        if (this.preRoll.length > this.preRollMax) this.preRoll = this.preRoll.slice(this.preRoll.length - this.preRollMax);
        if (isSpeech) {
          this.inSpeech = true;
          this.speech = Buffer.from(this.preRoll);
          this.preRoll = Buffer.alloc(0);
          this.silenceMs = 0;
          this.speechMs = (len / SAMPLE_RATE) * 1000;
        }
      } else {
        this.speech = Buffer.concat([this.speech, chunk]);
        this.speechMs += (len / SAMPLE_RATE) * 1000;
        if (isSpeech) this.silenceMs = 0;
        else this.silenceMs += (len / SAMPLE_RATE) * 1000;
        const hangoverHit = this.silenceMs >= this.o.silenceHangoverMs && this.speechMs >= this.o.minUtteranceMs;
        const maxHit = this.speechMs >= this.o.maxUtteranceMs;
        if (hangoverHit || maxHit) {
          const pcm = this.speech;
          this.inSpeech = false; this.speech = Buffer.alloc(0);
          this.silenceMs = 0; this.speechMs = 0;
          if (pcm.length >= Math.floor(SAMPLE_RATE * (this.o.minUtteranceMs / 1000)) * 2) {
            try { this.onUtterance(pcm); } catch (_) {}
          }
        }
      }
    }
  }
  flush() {
    if (this.inSpeech && this.speech.length > 0) {
      const pcm = this.speech;
      this.inSpeech = false; this.speech = Buffer.alloc(0);
      try { this.onUtterance(pcm); } catch (_) {}
    }
  }
}

class AudioService extends EventEmitter {
  constructor({ store, config } = {}) {
    super();
    this.store = store;
    this.config = config;
    this.log = createServiceLogger('AUDIO');
    this.running = false;
    this.sources = ['mic', 'system'];
    this.manualMode = false;
    this.manualChunks = [];
    this.parec = null;
    const vadOpts = () => ((this.store && this.store.settings.audio.vad) || {});
    this.vads = {
      mic: new VAD(vadOpts(), (pcm) => this.emitUtterance('mic', pcm)),
      system: new VAD(vadOpts(), (pcm) => this.emitUtterance('system', pcm)),
    };
  }

  start({ sources, manualMode } = {}) {
    this.sources = sources && sources.length ? sources : ['mic', 'system'];
    this.manualMode = !!manualMode;
    this.running = true;
    this.vads.mic.updateOpts(this.store?.settings?.audio?.vad);
    this.vads.system.updateOpts(this.store?.settings?.audio?.vad);
    this.log.info('Audio hub started', { sources: this.sources, manualMode: this.manualMode });
    // Linux optional: parec monitor feed for system audio when renderer loopback is unavailable.
    if (process.platform === 'linux' && this.sources.includes('system') && this.store?.settings?.audio?.linuxMonitorSource) {
      this.startParec(this.store.settings.audio.linuxMonitorSource);
    }
    this.emit('status', this.status());
  }

  stop() {
    this.running = false;
    try { this.vads.mic.flush(); } catch (_) {}
    try { this.vads.system.flush(); } catch (_) {}
    this.stopParec();
    this.log.info('Audio hub stopped');
    this.emit('status', this.status());
  }

  status() {
    return { running: this.running, sources: this.sources, manualMode: this.manualMode };
  }

  // Renderer pushes base64 PCM16 chunks: { source: 'mic'|'system', data: base64 }
  ingestPCM(source, b64) {
    if (!this.running) return;
    if (!this.sources.includes(source)) return;
    let buf;
    try { buf = Buffer.from(b64, 'base64'); } catch (_) { return; }
    if (!buf.length) return;
    if (this.manualMode) {
      this.manualChunks.push(buf);
      return;
    }
    const vad = this.vads[source];
    if (vad) vad.feed(buf);
  }

  manualStop() {
    // End a manual capture and emit one utterance.
    const pcm = Buffer.concat(this.manualChunks);
    this.manualChunks = [];
    if (pcm.length > SAMPLE_RATE * 2 * 0.3) this.emitUtterance('mic', pcm);
  }

  emitUtterance(source, pcm) {
    const wav = wavEncode(pcm);
    this.log.debug('Utterance captured', { source, seconds: (pcm.length / 2 / SAMPLE_RATE).toFixed(1) });
    this.emit('utterance', { source, pcm, wav, at: Date.now() });
  }

  startParec(monitorSource) {
    try {
      this.stopParec();
      this.parec = spawn('parec', [
        '--format=s16le', '--rate=16000', '--channels=1',
        '--latency-msec=50', `--device=${monitorSource}`,
      ]);
      this.parec.stdout.on('data', (d) => this.vads.system.feed(Buffer.from(d)));
      this.parec.stderr.on('data', () => {});
      this.parec.on('error', (e) => this.log.warn('parec failed', { error: e.message }));
      this.log.info('parec monitor started', { monitorSource });
    } catch (e) {
      this.log.warn('parec unavailable', { error: e.message });
    }
  }

  stopParec() {
    try { if (this.parec) this.parec.kill('SIGKILL'); } catch (_) {}
    this.parec = null;
  }
}

module.exports = { AudioService, VAD, wavEncode, SAMPLE_RATE };
