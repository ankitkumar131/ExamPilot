import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { AppConfig } from '../shared/types'
import { DEFAULT_CONFIG } from '../shared/defaults'
import { deepMerge } from '../shared/utils'
import { logger } from './logger'

type Listener = (cfg: AppConfig) => void

/**
 * JSON-file backed configuration store with atomic writes.
 * Lives at userData/config.json.
 */
export class ConfigStore {
  private file: string
  private data: AppConfig
  private listeners = new Set<Listener>()
  private saveTimer: NodeJS.Timeout | null = null

  constructor() {
    this.file = path.join(app.getPath('userData'), 'config.json')
    this.data = this.load()
  }

  private load(): AppConfig {
    try {
      if (fs.existsSync(this.file)) {
        const raw = fs.readFileSync(this.file, 'utf8')
        const parsed = JSON.parse(raw)
        return deepMerge(DEFAULT_CONFIG, parsed)
      }
    } catch (e) {
      logger.error('Failed to read config, using defaults:', e)
    }
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AppConfig
  }

  get(): AppConfig {
    return this.data
  }

  /** Deep-merges a patch into the config, persists and notifies listeners. */
  set(patch: unknown): AppConfig {
    this.data = deepMerge(this.data, patch)
    this.scheduleSave()
    for (const l of this.listeners) {
      try {
        l(this.data)
      } catch (e) {
        logger.error('config listener error', e)
      }
    }
    return this.data
  }

  reset(): AppConfig {
    this.data = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AppConfig
    this.scheduleSave()
    for (const l of this.listeners) {
      try {
        l(this.data)
      } catch (e) {
        logger.error('config listener error', e)
      }
    }
    return this.data
  }

  on(l: Listener): void {
    this.listeners.add(l)
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveNow(), 250)
  }

  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    try {
      const dir = path.dirname(this.file)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const tmp = this.file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch (e) {
      logger.error('Failed to save config:', e)
    }
  }
}
