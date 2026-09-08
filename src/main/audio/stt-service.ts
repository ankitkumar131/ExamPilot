import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import WS from 'ws'
import { AppConfig, AudioSource, ProviderTestResult, TranscriptEvent } from '../../shared/types'
import { errMsg, uuid } from '../../shared/utils'
import { logger } from '../logger'
import { pcmToWav } from './wav'

export interface SttEvents {
  transcript(e: TranscriptEvent): void
  activeStt(provider: string | null): void
  /** Live streaming died; the pipeline should switch to VAD segments. */
  streamingFallback(reason: string): void
}

interface DeepgramSocket {
  ws: WS
  source: AudioSource
  everGotResult: boolean
  closed: boolean
  reconnectDelay: number
}

const DEEPGRAM_BASE = 'wss://api.deepgram.com/v1/listen'
const TARGET_RATE = 16000

/**
 * Speech-to-text engine.
 *
 * Two modes:
 *  - "streaming": live Deepgram WebSocket per audio source (best latency).
 *  - "segments": renderer sends VAD-gated speech segments; each segment goes
 *    through the configured provider fallback chain (groq -> openai ->
 *    assemblyai -> local whisper CLI).
 */
export class SttService {
  private sockets = new Map<AudioSource, DeepgramSocket>()

  constructor(
    private getCfg: () => AppConfig,
    private events: SttEvents
  ) {}

  // ------------------------------------------------------------- streaming

  /** Returns true when a live streaming session could be established. */
  startStreaming(source: AudioSource): boolean {
    const cfg = this.getCfg()
    if (!cfg.stt.deepgram.apiKey) return false
    if (!cfg.stt.streaming) return false
    this.stopStreaming(source)
    const sock = this.connectDeepgram(source)
    if (!sock) return false
    this.sockets.set(source, sock)
    this.events.activeStt('deepgram')
    return true
  }

  private connectDeepgram(source: AudioSource): DeepgramSocket | null {
    const cfg = this.getCfg()
    const key = cfg.stt.deepgram.apiKey
    const model = cfg.stt.deepgram.model || 'nova-2'
    const params = new URLSearchParams({
      encoding: 'linear16',
      sample_rate: String(TARGET_RATE),
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      endpointing: '250',
      model
    })
    // "auto" -> multilingual model when supported, otherwise Deepgram default.
    if (cfg.stt.language && cfg.stt.language !== 'auto') {
      params.set('language', cfg.stt.language)
    } else if (model.startsWith('nova-2')) {
      params.set('language', 'multi')
    }

    const handle: DeepgramSocket = {
      ws: null as unknown as WS,
      source,
      everGotResult: false,
      closed: false,
      reconnectDelay: 1000
    }

    try {
      const ws = new WS(`${DEEPGRAM_BASE}?${params.toString()}`, {
        headers: { Authorization: `Token ${key}` }
      })
      handle.ws = ws

      ws.on('open', () => {
        logger.info(`deepgram[${source}] connected`)
        this.events.activeStt('deepgram')
      })
      ws.on('message', (data: WS.RawData, isBinary: boolean) => {
        if (isBinary) return
        this.onDeepgramMessage(handle, data.toString('utf8'))
      })
      ws.on('error', () => {
        /* close handler drives recovery */
      })
      ws.on('close', (code: number, reason: Buffer) => {
        if (handle.closed) return
        const why = reason?.toString('utf8') ?? ''
        logger.warn(`deepgram[${source}] closed code=${code} reason=${why}`)
        // Auth problems will not fix themselves: drop to segment mode.
        if (code === 401 || code === 403 || !handle.everGotResult) {
          this.sockets.delete(source)
          this.events.streamingFallback(
            `Deepgram disconnected (${code}${why ? ': ' + why : ''}); falling back to segment mode`
          )
          return
        }
        // Transient failure after results: reconnect with backoff.
        setTimeout(() => {
          if (handle.closed) return
          const again = this.connectDeepgram(source)
          if (again) {
            this.sockets.set(source, again)
          } else {
            this.sockets.delete(source)
            this.events.streamingFallback('Deepgram reconnect failed; falling back to segment mode')
          }
        }, handle.reconnectDelay)
        handle.reconnectDelay = Math.min(handle.reconnectDelay * 2, 15000)
      })
      return handle
    } catch (e) {
      logger.error('deepgram connect failed:', e)
      return null
    }
  }

  private onDeepgramMessage(handle: DeepgramSocket, raw: string): void {
    let msg: any
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.type !== 'Results') return
    const alt = msg.channel?.alternatives?.[0]
    const text: string = (alt?.transcript ?? '').trim()
    if (!text) return
    handle.everGotResult = true
    const isFinal = !!msg.is_final
    if (isFinal) {
      logger.info(`deepgram[${handle.source}] final: ${text}`)
    }
    this.events.transcript({
      id: uuid(),
      source: handle.source,
      text,
      isFinal,
      ts: Date.now(),
      provider: 'deepgram'
    })
  }

  pushAudio(source: AudioSource, chunk: Buffer): void {
    const s = this.sockets.get(source)
    if (s && s.ws.readyState === WS.OPEN) {
      try {
        s.ws.send(chunk)
      } catch (e) {
        logger.warn('deepgram send failed:', e)
      }
    }
  }

  stopStreaming(source: AudioSource): void {
    const s = this.sockets.get(source)
    if (!s) return
    s.closed = true
    this.sockets.delete(source)
    try {
      s.ws.close()
    } catch {
      /* ignore */
    }
    if (this.sockets.size === 0) this.events.activeStt(null)
  }

  stopAll(): void {
    for (const source of [...this.sockets.keys()]) this.stopStreaming(source)
  }

  isStreaming(source: AudioSource): boolean {
    const s = this.sockets.get(source)
    return !!s && s.ws.readyState === WebSocket.OPEN
  }

  // -------------------------------------------------------------- segments

  /** Runs a VAD speech segment through the fallback chain. */
  async transcribeSegment(source: AudioSource, pcm: Buffer): Promise<void> {
    const cfg = this.getCfg()
    const wav = pcmToWav(pcm, TARGET_RATE)
    const failures: { id: string; error: string }[] = []

    for (const id of cfg.stt.chain) {
      if (id === 'deepgram') {
        // Deepgram streaming handles its own path; skip for segments.
        continue
      }
      const conf = (cfg.stt as any)[id] as { apiKey?: string; command?: string } | undefined
      const configured =
        id === 'local' ? !!conf?.command : !!conf?.apiKey
      if (!configured) continue

      this.events.activeStt(id)
      const t0 = Date.now()
      try {
        const text = await this.runBatchProvider(id, wav)
        this.events.activeStt(null)
        if (text && text.trim()) {
          logger.info(`stt[${id}] (${Date.now() - t0}ms): ${text}`)
          this.events.transcript({
            id: uuid(),
            source,
            text: text.trim(),
            isFinal: true,
            ts: Date.now(),
            provider: id
          })
          return
        }
        failures.push({ id, error: 'empty transcript' })
      } catch (e) {
        const err = errMsg(e)
        logger.warn(`stt[${id}] failed: ${err}`)
        failures.push({ id, error: err })
        this.events.activeStt(null)
      }
    }
    if (failures.length) {
      logger.warn(`stt segment failed on all providers:`, failures)
    }
  }

  private async runBatchProvider(id: string, wav: Buffer): Promise<string> {
    const cfg = this.getCfg()
    const lang = cfg.stt.language && cfg.stt.language !== 'auto' ? cfg.stt.language : undefined
    switch (id) {
      case 'groq':
        return openAiCompatTranscribe(
          'https://api.groq.com/openai/v1/audio/transcriptions',
          cfg.stt.groq.apiKey,
          cfg.stt.groq.model || 'whisper-large-v3-turbo',
          wav,
          lang
        )
      case 'openai':
        return openAiCompatTranscribe(
          'https://api.openai.com/v1/audio/transcriptions',
          cfg.stt.openai.apiKey,
          cfg.stt.openai.model || 'whisper-1',
          wav,
          lang
        )
      case 'assemblyai':
        return assemblyAiTranscribe(cfg.stt.assemblyai.apiKey, wav, lang)
      case 'local':
        return localWhisper(cfg.stt.local, wav)
      default:
        throw new Error(`unknown provider ${id}`)
    }
  }

  // ---------------------------------------------------------------- probes

  async probe(id: string): Promise<ProviderTestResult> {
    const cfg = this.getCfg()
    const t0 = Date.now()
    const done = (ok: boolean, detail?: string, error?: string): ProviderTestResult => ({
      ok,
      ms: Date.now() - t0,
      detail,
      error
    })
    try {
      switch (id) {
        case 'deepgram': {
          if (!cfg.stt.deepgram.apiKey) return done(false, undefined, 'no API key')
          const r = await fetch('https://api.deepgram.com/v1/projects', {
            headers: { Authorization: `Token ${cfg.stt.deepgram.apiKey}` }
          })
          return r.ok ? done(true, 'authenticated') : done(false, undefined, `HTTP ${r.status}`)
        }
        case 'groq': {
          if (!cfg.stt.groq.apiKey) return done(false, undefined, 'no API key')
          const r = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { Authorization: `Bearer ${cfg.stt.groq.apiKey}` }
          })
          return r.ok ? done(true, 'authenticated') : done(false, undefined, `HTTP ${r.status}`)
        }
        case 'openai': {
          if (!cfg.stt.openai.apiKey) return done(false, undefined, 'no API key')
          const r = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${cfg.stt.openai.apiKey}` }
          })
          return r.ok ? done(true, 'authenticated') : done(false, undefined, `HTTP ${r.status}`)
        }
        case 'assemblyai': {
          if (!cfg.stt.assemblyai.apiKey) return done(false, undefined, 'no API key')
          // 404 with valid auth = key works; 401/403 = bad key.
          const r = await fetch(
            'https://api.assemblyai.com/v2/transcript/00000000-0000-0000-0000-000000000000',
            { headers: { authorization: cfg.stt.assemblyai.apiKey } }
          )
          if (r.status === 401 || r.status === 403) return done(false, undefined, `HTTP ${r.status}`)
          return done(true, 'authenticated')
        }
        case 'local': {
          const cmd = cfg.stt.local.command?.trim()
          if (!cmd) return done(false, undefined, 'no command configured')
          return await new Promise<ProviderTestResult>((resolve) => {
            const child = spawn(cmd, ['--help'], { shell: true })
            child.on('error', (e) => resolve(done(false, undefined, errMsg(e))))
            child.on('exit', (code) =>
              code === 0
                ? resolve(done(true, 'command found'))
                : resolve(done(true, `command ran (exit ${code})`))
            )
            setTimeout(() => {
              if (!child.killed) child.kill()
              resolve(done(false, undefined, 'timed out'))
            }, 8000)
          })
        }
        default:
          return done(false, undefined, 'unknown provider')
      }
    } catch (e) {
      return done(false, undefined, errMsg(e))
    }
  }
}

// ---------------------------------------------------------------------------
// Batch provider implementations
// ---------------------------------------------------------------------------

async function openAiCompatTranscribe(
  url: string,
  apiKey: string,
  model: string,
  wav: Buffer,
  language?: string
): Promise<string> {
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav')
  fd.append('model', model)
  fd.append('response_format', 'json')
  if (language) fd.append('language', language)
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
    signal: AbortSignal.timeout(45000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json: any = await res.json()
  return json.text ?? ''
}

async function assemblyAiTranscribe(apiKey: string, wav: Buffer, language?: string): Promise<string> {
  const headers = { authorization: apiKey }
  const up = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: new Uint8Array(wav),
    signal: AbortSignal.timeout(60000)
  })
  if (!up.ok) throw new Error(`upload HTTP ${up.status}: ${(await up.text()).slice(0, 200)}`)
  const { upload_url } = (await up.json()) as { upload_url: string }

  const body: Record<string, unknown> = { audio_url: upload_url }
  if (language) body.language_code = language
  else body.language_detection = true

  const tr = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!tr.ok) throw new Error(`transcript HTTP ${tr.status}: ${(await tr.text()).slice(0, 200)}`)
  const { id } = (await tr.json()) as { id: string }

  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 700))
    const st = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers })
    if (!st.ok) throw new Error(`status HTTP ${st.status}`)
    const data: any = await st.json()
    if (data.status === 'completed') return data.text ?? ''
    if (data.status === 'error') throw new Error(data.error ?? 'processing error')
  }
  throw new Error('timed out waiting for transcript')
}

async function localWhisper(
  conf: { command: string; model: string; language: string },
  wav: Buffer
): Promise<string> {
  const cmd = conf.command?.trim()
  if (!cmd) throw new Error('no command configured')
  const tmp = path.join(os.tmpdir(), `auranotes-${Date.now()}.wav`)
  fs.writeFileSync(tmp, wav)
  try {
    const args: string[] = [tmp]
    if (conf.model) args.push('--model', conf.model)
    if (conf.language && conf.language !== 'auto') args.push('--language', conf.language)
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(cmd, args, { shell: true })
      let out = ''
      child.stdout.on('data', (d) => (out += d.toString()))
      child.stderr.on('data', (d) => (out += d.toString()))
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code !== 0 && !out) {
          reject(new Error(`command exited with code ${code}`))
          return
        }
        // Whisper CLI prints segments like: [00:00.000 --> 00:02.500]  Hello
        const lines = out.split('\n')
        const parts: string[] = []
        for (const line of lines) {
          const m = line.match(/\[[\d:.]+\s*-->\s*[\d:.]+\]\s*(.*)$/)
          if (m && m[1].trim()) parts.push(m[1].trim())
        }
        if (parts.length) resolve(parts.join(' '))
        else if (out.trim()) resolve(out.trim())
        else resolve('')
      })
      setTimeout(() => {
        if (!child.killed) child.kill()
        reject(new Error('timed out'))
      }, 120000).unref?.()
    })
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}
