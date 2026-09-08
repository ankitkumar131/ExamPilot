import { app, Menu, Tray, nativeImage } from 'electron'
import path from 'path'
import { logger } from './logger'

export function createTray(handlers: {
  showOverlay: () => void
  showSettings: () => void
  toggleListening: () => void
  toggleHidden: () => void
  quit: () => void
}): Tray {
  let iconPath = path.join(__dirname, '../../assets/icon.png')
  let img = nativeImage.createFromPath(iconPath)
  if (img.isEmpty()) {
    // Fallback: tiny blank icon so the tray still works.
    img = nativeImage.createEmpty()
  } else {
    img = img.resize({ width: 16, height: 16 })
  }
  const tray = new Tray(img)
  tray.setToolTip('AuraNotes')

  const rebuild = () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Show overlay', click: handlers.showOverlay },
      { label: 'Settings', click: handlers.showSettings },
      { type: 'separator' },
      { label: 'Start / stop listening', click: handlers.toggleListening },
      { label: 'Hide / show windows', click: handlers.toggleHidden },
      { type: 'separator' },
      { label: 'Quit', click: handlers.quit }
    ])
    tray.setContextMenu(menu)
  }
  rebuild()

  tray.on('click', handlers.showOverlay)
  logger.info('tray created')
  return tray
}
