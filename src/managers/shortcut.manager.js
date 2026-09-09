// Global keyboard shortcuts (registered in main process).
const { createServiceLogger } = require('../core/logger');

function electron() {
  try { return require('electron'); } catch (_) { return null; }
}

class ShortcutManager {
  constructor() {
    this.log = createServiceLogger('SHORTCUT');
    this.registered = [];
  }

  registerAll(shortcuts, handlers) {
    const e = electron();
    if (!e) { this.log.warn('Shortcuts unavailable outside Electron'); return; }
    this.unregisterAll();
    for (const [action, accelerator] of Object.entries(shortcuts || {})) {
      if (!accelerator || !handlers[action]) continue;
      try {
        const ok = e.globalShortcut.register(accelerator, () => {
          try { handlers[action](); } catch (err) { this.log.warn('Shortcut handler failed', { action, error: err.message }); }
        });
        if (ok) this.registered.push(accelerator);
        else this.log.warn('Shortcut registration failed (in use?)', { action, accelerator });
      } catch (err) {
        this.log.warn('Invalid shortcut', { action, accelerator, error: err.message });
      }
    }
    this.log.info('Shortcuts registered', { count: this.registered.length });
  }

  unregisterAll() {
    const e = electron();
    try { if (e) e.globalShortcut.unregisterAll(); } catch (_) {}
    this.registered = [];
  }

  dispose() { this.unregisterAll(); }
}

module.exports = ShortcutManager;
