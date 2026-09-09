// Interview sessions: create/live/end, transcript persistence, AI notes.
// Stored at <dataDir>/sessions.json
const fs = require('fs');
const path = require('path');
const { createServiceLogger } = require('../core/logger');

function uid() {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

class SessionService {
  constructor({ dataDir, config } = {}) {
    this.log = createServiceLogger('SESSION');
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'sessions.json');
    this.maxStored = 1000;
    try { this.maxStored = (config && config.get('session.maxStoredSegments')) || 1000; } catch (_) {}
    this.sessions = this.load();
    this.activeId = null;
    for (const s of this.sessions) {
      if (s.state === 'live') { this.activeId = s.id; break; }
    }
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return [];
      const arr = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  persist() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.sessions, null, 2), 'utf8');
    } catch (e) {
      this.log.warn('Failed to persist sessions', { error: e.message });
    }
  }

  create({ title, company, role, mode, language, resume, jobDescription, saveTranscript }) {
    const now = Date.now();
    const s = {
      id: uid(),
      title: title || `${company || 'Untitled'} — ${role || 'Interview'}`,
      company: company || '', role: role || '',
      mode: mode || 'auto', language: language || 'python',
      resume: resume || '', jobDescription: jobDescription || '',
      saveTranscript: saveTranscript !== false,
      state: 'live', createdAt: now, startedAt: now, endedAt: null, durationSec: 0,
      transcript: [], notes: null,
    };
    // Only one live session at a time.
    for (const prev of this.sessions) {
      if (prev.state === 'live') {
        prev.state = 'ended';
        prev.endedAt = now;
        prev.durationSec = Math.max(0, Math.round(((prev.startedAt || now) ? (now - (prev.startedAt || now)) : 0) / 1000));
      }
    }
    this.sessions.unshift(s);
    this.activeId = s.id;
    this.persist();
    this.log.info('Session created', { id: s.id, title: s.title });
    return s;
  }

  get(id) { return this.sessions.find((s) => s.id === id) || null; }
  active() { return (this.activeId && this.get(this.activeId)) || null; }

  list({ q, state } = {}) {
    let arr = this.sessions.slice();
    if (state && state !== 'all') arr = arr.filter((s) => s.state === state);
    if (q) {
      const needle = String(q).toLowerCase();
      arr = arr.filter((s) => `${s.title} ${s.company} ${s.role}`.toLowerCase().includes(needle));
    }
    return arr.map((s) => ({
      ...s,
      transcript: undefined, // keep list payloads light; fetch full via get()
      segmentCount: (s.transcript || []).length,
    }));
  }

  appendSegments(id, segments) {
    const s = this.get(id);
    if (!s || !s.saveTranscript) return;
    s.transcript = (s.transcript || []).concat(segments).slice(-this.maxStored);
  }

  end(id, { notes } = {}) {
    const s = this.get(id);
    if (!s) return null;
    const now = Date.now();
    s.state = 'ended';
    s.endedAt = now;
    s.durationSec = Math.max(0, Math.round((now - (s.startedAt || s.createdAt || now)) / 1000));
    if (notes) s.notes = notes;
    if (!s.saveTranscript) s.transcript = [];
    if (this.activeId === id) this.activeId = null;
    this.persist();
    this.log.info('Session ended', { id, durationSec: s.durationSec });
    return s;
  }

  remove(id) {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    if (this.activeId === id) this.activeId = null;
    this.persist();
    return true;
  }

  update(id, patch) {
    const s = this.get(id);
    if (!s) return null;
    Object.assign(s, patch || {});
    this.persist();
    return s;
  }
}

module.exports = SessionService;
