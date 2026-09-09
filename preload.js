// Renderer ↔ main bridge (context-isolated).
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = [
  'app:get-status',
  'audio:start', 'audio:stop', 'audio:status',
  'loopback:get-source',
  'capture:list-displays', 'capture:fullscreen',
  'picker:pick', 'picker:done',
  'vision:analyze-last',
  'llm:ask', 'llm:cancel', 'llm:auto-answer', 'llm:mock',
  'transcript:get', 'transcript:clear',
  'session:list', 'session:create', 'session:end', 'session:get',
  'session:remove', 'session:active', 'session:update',
  'notes:get',
  'settings:get', 'settings:save', 'settings:reset-onboarding',
  'providers:test', 'providers:status',
  'whisper:status',
  'stealth:get', 'stealth:set',
  'window:show', 'window:hide', 'window:toggle-all',
  'window:interactive', 'window:resize', 'window:move',
  'shortcuts:get', 'shortcuts:save',
  'clipboard:copy', 'shell:open-external',
  'onboarding:status', 'onboarding:complete',
  'app:quit',
];

const SEND = ['audio:pcm', 'audio:manual-stop'];

const ON = [
  'transcript:segment', 'transcript:cleared',
  'audio:status',
  'answer:start', 'answer:chunk', 'answer:done', 'answer:error', 'provider:attempt',
  'session:changed', 'session:active-changed',
  'stealth:changed', 'interaction-mode-changed',
  'capture:done', 'capture:error',
  'listening:changed',
];

const api = {};
for (const ch of INVOKE) {
  const key = ch.replace(/[:\-](\w)/g, (_, c) => c.toUpperCase());
  api[key] = (...args) => ipcRenderer.invoke(ch, ...args);
}
api.sendPcm = (source, base64) => {
  try { ipcRenderer.send('audio:pcm', { source, data: base64 }); } catch (_) {}
};
api.sendManualStop = () => {
  try { ipcRenderer.send('audio:manual-stop'); } catch (_) {}
};
for (const ch of ON) {
  const key = 'on' + ch.split(':').map((p) => p[0].toUpperCase() + p.slice(1)).join('').replace(/-(\w)/g, (_, c) => c.toUpperCase());
  api[key] = (cb) => {
    const wrapped = (_e, payload) => { try { cb(payload); } catch (e) { console.error(key, e); } };
    ipcRenderer.on(ch, wrapped);
    return () => ipcRenderer.removeListener(ch, wrapped);
  };
}
api.removeAll = (ch) => { try { ipcRenderer.removeAllListeners(ch); } catch (_) {} };

contextBridge.exposeInMainWorld('electronAPI', api);
