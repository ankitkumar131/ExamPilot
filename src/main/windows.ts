import {
  app,
  BrowserWindow,
  screen,
  shell,
  WebContents
} from 'electron'
import path from 'path'
import { AppConfig } from '../shared/types'
import { AppStatus } from '../shared/types'
import { logger } from './logger'

export const DEV_SERVER = process.env.VITE_DEV_SERVER_URL || ''

export interface Windows {
  overlay: BrowserWindow | null
  settings: BrowserWindow | null
}

export class WindowMgr {
  overlay: BrowserWindow | null = null
  settings: BrowserWindow | null = null

  constructor(
    private getCfg: () => AppConfig,
    private sendStatus: () => void,
    private saveBounds: (b: Electron.Rectangle) => void
  ) {}

  private url(page: string): string {
    if (DEV_SERVER) return `${DEV_SERVER}${page}`
    return `file://${path.join(__dirname, '../renderer/', page)}`
  }

  private preloadPath(): string {
    // dist/preload/index.js from dist/main/index.js
    return path.join(__dirname, '../preload/index.js')
  }

  // ------------------------------------------------------------------ overlay

  createOverlay(): BrowserWindow {
    if (this.overlay && !this.overlay.isDestroyed()) return this.overlay
    const cfg = this.getCfg()
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    const w = Math.min(cfg.overlay.width, width - 40)
    const h = Math.min(cfg.overlay.height, height - 40)
    const x =
      cfg.overlay.x !== null && cfg.overlay.x >= 0 && cfg.overlay.x < width - 100
        ? cfg.overlay.x
        : width - w - 24
    const y =
      cfg.overlay.y !== null && cfg.overlay.y >= 0 && cfg.overlay.y < height - 100
        ? cfg.overlay.y
        : 80

    const win = new BrowserWindow({
      width: w,
      height: h,
      x,
      y,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })

    win.setAlwaysOnTop(true, 'screen-saver')
    try {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    } catch {
      /* not supported on some Linux WMs */
    }
    if (cfg.stealth.contentProtection) this.applyContentProtection(win)

    win.once('ready-to-show', () => {
      win.showInactive()
      this.sendStatus()
    })
    win.on('closed', () => {
      this.overlay = null
      this.sendStatus()
    })

    // Persist geometry, debounced.
    let saveTimer: NodeJS.Timeout | null = null
    const save = () => {
      if (win.isDestroyed()) return
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        if (win.isDestroyed()) return
        this.saveBounds(win.getBounds())
      }, 600)
    }
    win.on('resize', save)
    win.on('move', save)

    win.loadURL(this.url('overlay.html'))
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })
    this.overlay = win
    return win
  }

  // ---------------------------------------------------------------- settings

  createSettings(): BrowserWindow {
    if (this.settings && !this.settings.isDestroyed()) {
      this.settings.show()
      this.settings.focus()
      return this.settings
    }
    const win = new BrowserWindow({
      width: 1020,
      height: 740,
      minWidth: 860,
      minHeight: 600,
      show: false,
      title: 'Settings',
      webPreferences: {
        preload: this.preloadPath(),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    if (this.getCfg().stealth.contentProtection) this.applyContentProtection(win)
    win.once('ready-to-show', () => {
      win.show()
      this.sendStatus()
    })
    win.on('closed', () => {
      this.settings = null
      this.sendStatus()
    })
    win.loadURL(this.url('settings.html'))
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })
    this.settings = win
    return win
  }

  // ------------------------------------------------------------------ helpers

  applyContentProtection(win: BrowserWindow): void {
    try {
      win.setContentProtection(true)
    } catch (e) {
      logger.warn('setContentProtection failed:', e)
    }
  }

  applyContentProtectionAll(): void {
    const cfg = this.getCfg()
    for (const w of [this.overlay, this.settings]) {
      if (w && !w.isDestroyed()) {
        try {
          w.setContentProtection(cfg.stealth.contentProtection)
        } catch {
          /* ignore */
        }
      }
    }
  }

  setClickThrough(enabled: boolean): void {
    if (this.overlay && !this.overlay.isDestroyed()) {
      this.overlay.setIgnoreMouseEvents(enabled, { forward: true })
    }
  }

  /** Panic toggle: hide / restore every window. Returns hidden state. */
  toggleHidden(force?: boolean): boolean {
    const wins = [this.overlay, this.settings].filter(
      (w) => w && !w.isDestroyed()
    ) as BrowserWindow[]
    const anyVisible = wins.some((w) => w.isVisible())
    const hide = force !== undefined ? force : anyVisible
    for (const w of wins) {
      if (hide) {
        if (w.isVisible()) w.hide()
      } else {
        w.showInactive()
      }
    }
    return hide
  }

  broadcast(channel: string, ...args: unknown[]): void {
    for (const w of [this.overlay, this.settings]) {
      if (w && !w.isDestroyed()) {
        try {
          w.webContents.send(channel, ...args)
        } catch (e) {
          logger.warn('broadcast failed', channel, e)
        }
      }
    }
  }

  allWebContents(): WebContents[] {
    return [this.overlay, this.settings]
      .filter((w): w is BrowserWindow => !!w && !w.isDestroyed())
      .map((w) => w.webContents)
  }

  restoreOverlay(): void {
    if (this.overlay && !this.overlay.isDestroyed() && !this.overlay.isVisible()) {
      this.overlay.showInactive()
    }
  }
}

