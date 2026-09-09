// All app windows + toggleable stealth.
// Stealth ON  (default): content-protected (hidden from Meet/Zoom/Teams screen
// share on Win/mac), skipped in taskbar, always-on-top, disguised process name.
// Stealth OFF (practice): normal windows you can screen-share.
const path = require('path');
const { createServiceLogger } = require('../core/logger');

function electron() {
  try { return require('electron'); } catch (_) { return null; }
}

const FILES = {
  overlay: 'overlay.html',
  response: 'response.html',
  chat: 'chat.html',
  sessions: 'sessions.html',
  settings: 'settings.html',
  onboarding: 'onboarding.html',
};

class WindowManager {
  constructor({ config, store } = {}) {
    this.config = config;
    this.store = store;
    this.log = createServiceLogger('WINDOW');
    this.windows = new Map();
    this.interactive = true;
    this.wasVisibleBeforePanic = false;
  }

  get uiDir() { return path.join(__dirname, '..', '..', 'ui'); }
  get preload() { return path.join(__dirname, '..', '..', 'preload.js'); }
  stealthOn() { try { return this.store.settings.stealth.enabled !== false; } catch (_) { return true; } }

  async init({ showOverlay = true } = {}) {
    const e = electron();
    if (!e) throw new Error('WindowManager requires Electron');
    for (const name of ['overlay', 'response', 'chat', 'sessions', 'settings', 'onboarding']) {
      this.create(name);
    }
    this.applyStealthAll(this.stealthOn());
    if (showOverlay) this.show('overlay');
    this.log.info('Windows initialized');
  }

  sizeFor(name) {
    try {
      const c = this.config.get(`window.${name}`);
      if (c) return c;
    } catch (_) {}
    return { width: 800, height: 600 };
  }

  create(name) {
    const e = electron();
    if (this.windows.has(name)) return this.windows.get(name);
    const size = this.sizeFor(name);
    const isOverlayLike = ['overlay', 'response'].includes(name);
    const win = new e.BrowserWindow({
      width: size.width,
      height: size.height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: name !== 'overlay',
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      visibleOnAllWorkspaces: true,
      webPreferences: {
        preload: this.preload,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
      ...(process.platform === 'darwin' ? { type: 'panel', acceptFirstMouse: true } : {}),
    });
    win.loadFile(path.join(this.uiDir, FILES[name]));
    win.on('closed', () => this.windows.delete(name));
    if (isOverlayLike) {
      win.on('blur', () => { /* keep overlay family on top */ });
    }
    this.windows.set(name, win);
    return win;
  }

  get(name) { return this.windows.get(name); }

  // ---- stealth ----
  // Taskbar/dock hiding is ALWAYS on: ExamPilot never appears in the Windows
  // taskbar, Linux dock/taskbar, or macOS dock, and creates no tray icon —
  // it is only visible in Task Manager / System Monitor. The stealth toggle
  // controls screen-share invisibility (content protection) only.
  applyStealthTo(win, on) {
    if (!win || win.isDestroyed()) return;
    try { win.setContentProtection(on); } catch (_) { /* linux/no-op */ }
    try { win.setSkipTaskbar(true); } catch (_) {} // always hidden
    try { win.setAlwaysOnTop(true); } catch (_) {}
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {
      try { win.setVisibleOnAllWorkspaces(true); } catch (_) {}
    }
    if (process.platform === 'darwin') {
      try { win.setAlwaysOnTop(true, on ? 'screen-saver' : 'floating', 2); } catch (_) {}
    }
  }

  applyStealthAll(on) {
    for (const win of this.windows.values()) this.applyStealthTo(win, on);
    const e = electron();
    // macOS dock is always hidden — windows return via global shortcut.
    try {
      if (e && e.app && e.app.dock) e.app.dock.hide();
    } catch (_) {}
    this.log.info(`Share-protection ${on ? 'ENABLED' : 'DISABLED'} (taskbar/dock always hidden)`, { windows: this.windows.size });
  }

  // ---- visibility ----
  show(name) {
    const win = this.get(name) || this.create(name);
    if (!win || win.isDestroyed()) return;
    this.showOnCurrentDesktop(win);
    if (name === 'response') this.dockResponseUnderOverlay();
    if (name === 'overlay') {
      try { win.setSize(this.sizeFor('overlay').width, this.sizeFor('overlay').height); } catch (_) {}
    }
  }

  hide(name) {
    const win = this.get(name);
    if (win && !win.isDestroyed() && win.isVisible()) win.hide();
  }

  showOnCurrentDesktop(win) {
    const e = electron();
    try {
      if (process.platform === 'darwin') win.setAlwaysOnTop(true, 'screen-saver', 2);
      else win.setAlwaysOnTop(true);
    } catch (_) {}
    try {
      const cursor = e.screen.getCursorScreenPoint();
      const display = e.screen.getDisplayNearestPoint(cursor);
      if (display && !win.isVisible()) {
        const b = win.getBounds();
        const wb = display.workArea;
        const x = Math.min(Math.max(b.x || wb.x, wb.x), wb.x + Math.max(0, wb.width - b.width));
        const y = Math.min(Math.max(b.y || wb.y, wb.y), wb.y + Math.max(0, wb.height - b.height));
        win.setPosition(Math.floor(x), Math.floor(y));
      }
    } catch (_) {}
    // Focus without activating other apps' capture indicators.
    try { win.showInactive(); } catch (_) { try { win.show(); } catch (_) {} }
  }

  toggleAll() {
    const anyVisible = [...this.windows.values()].some((w) => !w.isDestroyed() && w.isVisible());
    if (anyVisible) this.panicHide();
    else this.show('overlay');
  }

  panicHide() {
    this.wasVisibleBeforePanic = [...this.windows.values()].some((w) => !w.isDestroyed() && w.isVisible());
    for (const win of this.windows.values()) {
      try { if (!win.isDestroyed() && win.isVisible()) win.hide(); } catch (_) {}
    }
  }

  panicRestore() {
    this.show('overlay');
  }

  dockResponseUnderOverlay() {
    try {
      const o = this.get('overlay');
      const r = this.get('response');
      if (!o || !r || o.isDestroyed() || r.isDestroyed()) return;
      const ob = o.getBounds();
      r.setPosition(ob.x, ob.y + ob.height + 8);
    } catch (_) {}
  }

  setInteractive(on) {
    this.interactive = !!on;
    for (const name of ['overlay', 'response']) {
      const win = this.get(name);
      if (!win || win.isDestroyed()) continue;
      try {
        if (this.interactive) win.setIgnoreMouseEvents(false);
        else win.setIgnoreMouseEvents(true, { forward: true });
      } catch (_) {}
    }
    this.broadcast('interaction-mode-changed', { interactive: this.interactive });
  }

  toggleInteraction() { this.setInteractive(!this.interactive); }

  moveOverlay(dx, dy) {
    const win = this.get('overlay');
    if (!win || win.isDestroyed()) return;
    try {
      const b = win.getBounds();
      win.setPosition(b.x + dx, b.y + dy);
      this.dockResponseUnderOverlay();
    } catch (_) {}
  }

  resize(name, width, height) {
    const win = this.get(name);
    if (!win || win.isDestroyed()) return;
    try { win.setSize(Math.floor(width), Math.floor(height)); } catch (_) {}
  }

  // ---- messaging ----
  send(name, channel, payload) {
    const win = this.get(name);
    if (win && !win.isDestroyed()) {
      try { win.webContents.send(channel, payload); } catch (_) {}
    }
  }

  broadcast(channel, payload) {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) { try { win.webContents.send(channel, payload); } catch (_) {} }
    }
  }

  destroyAll() {
    for (const win of this.windows.values()) {
      try { if (!win.isDestroyed()) win.destroy(); } catch (_) {}
    }
    this.windows.clear();
  }
}

module.exports = WindowManager;
