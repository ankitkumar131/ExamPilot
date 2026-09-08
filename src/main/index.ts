import { app, session } from 'electron'
import { AppConfig, AppStatus } from '../shared/types'
import { IPC } from '../shared/constants'
import { logger } from './logger'
import { ConfigStore } from './config'
import { WindowMgr } from './windows'
import { createTray } from './tray'
import { registerHotkeys, unregisterAll } from './hotkeys'

// Keep audio capture working without user gestures (overlay starts streams
// programmatically when listening is toggled).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// Single instance: a second launch focuses the existing overlay.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

const store = new ConfigStore()

const status: AppStatus = {
  listeningSystem: false,
  listeningMic: false,
  sttMode: 'segments',
  activeStt: null,
  clickThrough: false,
  hidden: false
}

function sendStatus(): void {
  mgr.broadcast(IPC.evtStatus, status)
}

const mgr = new WindowMgr(
  () => store.get(),
  sendStatus,
  (b) => store.set({ overlay: { x: b.x, y: b.y, width: b.width, height: b.height } })
)

// ------------------------------------------------------------------- actions

function toggleListening(): void {
  const cfg = store.get()
  const any = status.listeningSystem || status.listeningMic
  if (any) {
    status.listeningSystem = false
    status.listeningMic = false
  } else {
    status.listeningSystem = cfg.stt.sources.system
    status.listeningMic = cfg.stt.sources.mic
    if (!status.listeningSystem && !status.listeningMic) status.listeningSystem = true
  }
  logger.info(`listening -> system=${status.listeningSystem} mic=${status.listeningMic}`)
  sendStatus()
}

function togglePanic(): void {
  status.hidden = mgr.toggleHidden()
  logger.info(`panic toggle -> hidden=${status.hidden}`)
  sendStatus()
}

function toggleClickThrough(): void {
  status.clickThrough = !status.clickThrough
  mgr.setClickThrough(status.clickThrough)
  logger.info(`click-through -> ${status.clickThrough}`)
  sendStatus()
}

function askHotkey(): void {
  // TODO(next): forward to the interview session engine (auto-answer / solve
  // the latest question). Wires up once ai/llm-service and session land.
  logger.info('ask hotkey pressed (session engine pending)')
}

function screenshotHotkey(): void {
  // TODO(next): capture the active display and send it through the vision
  // chain. Wires up once screenshot.ts lands.
  logger.info('screenshot hotkey pressed (capture pending)')
}

// ------------------------------------------------------------------- startup

app.whenReady().then(() => {
  logger.info(`AuraNotes starting (v${app.getVersion()})`)

  // Allow media capture (mic + desktop audio) from our windows.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media' || permission === 'display-capture')
  })

  const cfg = store.get()
  registerHotkeys(cfg, {
    ask: askHotkey,
    screenshot: screenshotHotkey,
    listening: toggleListening,
    panic: togglePanic,
    clickThrough: toggleClickThrough
  })

  mgr.createOverlay()

  if (!cfg.firstRunDone) {
    mgr.createSettings()
    store.set({ firstRunDone: true })
  }

  createTray({
    showOverlay: () => mgr.restoreOverlay(),
    showSettings: () => mgr.createSettings(),
    toggleListening,
    toggleHidden: togglePanic,
    quit: () => app.quit()
  })

  // React to config edits from the settings window.
  store.on((next: AppConfig) => {
    registerHotkeys(next, {
      ask: askHotkey,
      screenshot: screenshotHotkey,
      listening: toggleListening,
      panic: togglePanic,
      clickThrough: toggleClickThrough
    })
    mgr.applyContentProtectionAll()
    mgr.broadcast(IPC.evtCfg, next)
  })

  logger.info('startup complete')
})

app.on('second-instance', () => {
  mgr.restoreOverlay()
})

app.on('window-all-closed', () => {
  // Tray app: keep running until explicitly quit.
})

app.on('before-quit', () => {
  unregisterAll()
  store.saveNow()
  logger.info('shutdown')
})
