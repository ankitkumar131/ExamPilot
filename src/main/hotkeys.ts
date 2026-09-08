import { globalShortcut } from 'electron'
import { AppConfig } from '../shared/types'
import { logger } from './logger'

export interface HotkeyActions {
  ask: () => void
  screenshot: () => void
  listening: () => void
  panic: () => void
  clickThrough: () => void
}

/** Registers global shortcuts from config; call again after config changes. */
export function registerHotkeys(cfg: AppConfig, actions: HotkeyActions): void {
  globalShortcut.unregisterAll()
  const map: [string, string, () => void][] = [
    ['ask', cfg.hotkeys.ask, actions.ask],
    ['screenshot', cfg.hotkeys.screenshot, actions.screenshot],
    ['listening', cfg.hotkeys.listening, actions.listening],
    ['panic', cfg.hotkeys.panic, actions.panic],
    ['clickThrough', cfg.hotkeys.clickThrough, actions.clickThrough]
  ]
  for (const [name, accel, handler] of map) {
    if (!accel) continue
    try {
      const ok = globalShortcut.register(accel, handler)
      if (!ok) logger.warn(`hotkey "${name}" (${accel}) could not be registered`)
    } catch (e) {
      logger.warn(`invalid hotkey "${name}" (${accel}):`, e)
    }
  }
}

export function unregisterAll(): void {
  try {
    globalShortcut.unregisterAll()
  } catch {
    /* ignore */
  }
}
