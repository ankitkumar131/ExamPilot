import { app } from 'electron'
import fs from 'fs'
import path from 'path'

function ts(): string {
  return new Date().toISOString()
}

class Logger {
  private file: string | null = null
  private stream: fs.WriteStream | null = null

  private ensure(): fs.WriteStream | null {
    if (this.stream) return this.stream
    try {
      const dir = path.join(app.getPath('userData'), 'logs')
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      this.file = path.join(dir, 'main.log')
      this.stream = fs.createWriteStream(this.file, { flags: 'a' })
    } catch {
      this.stream = null
    }
    return this.stream
  }

  private write(level: string, args: unknown[]): void {
    const line = `[${ts()}] [${level}] ${args
      .map((a) => (typeof a === 'string' ? a : safeJson(a)))
      .join(' ')}\n`
    // eslint-disable-next-line no-console
    console.log(line.trim())
    const s = this.ensure()
    if (s) s.write(line)
  }

  info(...args: unknown[]): void {
    this.write('INFO', args)
  }
  warn(...args: unknown[]): void {
    this.write('WARN', args)
  }
  error(...args: unknown[]): void {
    this.write('ERROR', args)
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export const logger = new Logger()
