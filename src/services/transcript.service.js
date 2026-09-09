// Rolling live transcript with speaker labels + question detection for Auto Answer.
// Speakers: 'you' (mic) | 'interviewer' (system loopback).
const { EventEmitter } = require('events');

const QUESTION_STARTS = [
  'what', 'why', 'how', 'when', 'where', 'which', 'who', 'whom', 'whose',
  'explain', 'describe', 'design', 'implement', 'solve', 'write', 'code',
  'tell me', 'walk me through', 'can you', 'could you', 'do you', 'have you',
  'is there', 'are there', 'suppose', 'given', 'consider', 'compare',
];

function isQuestionLike(text) {
  const t = String(text || '').trim();
  if (t.length < 12) return false;
  if (t.includes('?')) return true;
  const low = t.toLowerCase();
  return QUESTION_STARTS.some((s) => low.startsWith(s));
}

class TranscriptService extends EventEmitter {
  constructor({ config } = {}) {
    super();
    this.config = config;
    this.segments = [];
    this.autoAnswer = true;
    this.debounceMs = 1400;
    this._timer = null;
    this._seq = 0;
    try {
      const c = config && config.get && config.get('transcript');
      if (c) {
        this.maxSegments = c.maxSegments || 500;
        this.contextChars = c.contextChars || 6000;
        this.debounceMs = c.autoAnswerDebounceMs || 1400;
      }
    } catch (_) { /* defaults */ }
    this.maxSegments = this.maxSegments || 500;
    this.contextChars = this.contextChars || 6000;
  }

  setAutoAnswer(on) { this.autoAnswer = !!on; }

  add({ speaker, text, provider }) {
    const clean = String(text || '').trim();
    if (!clean) return null;
    const seg = {
      id: `s${Date.now()}-${this._seq++}`,
      ts: Date.now(),
      speaker: speaker === 'you' ? 'you' : 'interviewer',
      text: clean,
      provider: provider || '',
    };
    this.segments.push(seg);
    if (this.segments.length > this.maxSegments) {
      this.segments.splice(0, this.segments.length - this.maxSegments);
    }
    this.emit('segment', seg);
    this.maybeAutoAnswer(seg);
    return seg;
  }

  maybeAutoAnswer(seg) {
    if (!this.autoAnswer) return;
    if (seg.speaker !== 'interviewer') return;
    if (!isQuestionLike(seg.text)) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this.emit('auto-question', {
        question: this.latestQuestion(),
        context: this.getContext(),
      });
    }, this.debounceMs);
  }

  forceQuestion() {
    return { question: this.latestQuestion(), context: this.getContext() };
  }

  latestQuestion() {
    const qs = this.segments.filter((s) => s.speaker === 'interviewer' && isQuestionLike(s.text));
    if (qs.length) return qs.slice(-2).map((s) => s.text).join('\n');
    const any = this.segments.filter((s) => s.speaker === 'interviewer');
    if (any.length) return any.slice(-2).map((s) => s.text).join('\n');
    return this.segments.slice(-3).map((s) => s.text).join('\n');
  }

  getContext({ maxChars } = {}) {
    const cap = maxChars || this.contextChars;
    const lines = [];
    let len = 0;
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i];
      const line = `${s.speaker === 'you' ? 'You' : 'Interviewer'}: ${s.text}`;
      if (len + line.length > cap) break;
      lines.unshift(line);
      len += line.length;
    }
    return lines.join('\n');
  }

  recent(n = 10) { return this.segments.slice(-n); }
  clear() { this.segments = []; clearTimeout(this._timer); this.emit('cleared'); }
  toJSON() { return this.segments; }
  load(arr) { this.segments = Array.isArray(arr) ? arr.slice(-this.maxSegments) : []; }
}

module.exports = { TranscriptService, isQuestionLike };
