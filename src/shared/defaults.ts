import type { AppConfig } from './types'

export const DEFAULT_CONFIG: AppConfig = {
  stt: {
    chain: ['deepgram', 'groq', 'openai', 'assemblyai', 'local'],
    deepgram: { apiKey: '', model: 'nova-2' },
    groq: { apiKey: '', model: 'whisper-large-v3-turbo' },
    openai: { apiKey: '', model: 'whisper-1' },
    assemblyai: { apiKey: '', model: 'best' },
    local: { command: '', model: 'small', language: 'auto' },
    language: 'auto',
    streaming: true,
    sources: { system: true, mic: false },
    questionSources: ['system', 'mic'],
    autoAnswer: true,
    questionDetection: { minWords: 3 },
    vad: {
      threshold: 0.012,
      silenceMs: 1100,
      minSpeechMs: 250,
      minSegmentMs: 600
    }
  },
  llm: {
    chain: ['openai', 'anthropic', 'gemini', 'groq', 'openrouter', 'ollama', 'custom'],
    providers: {
      openai: { apiKey: '', baseUrl: '', model: 'gpt-4o' },
      anthropic: { apiKey: '', baseUrl: '', model: 'claude-sonnet-4-20250514' },
      gemini: { apiKey: '', baseUrl: '', model: 'gemini-2.5-flash' },
      groq: { apiKey: '', baseUrl: '', model: 'llama-3.3-70b-versatile' },
      openrouter: { apiKey: '', baseUrl: '', model: 'openai/gpt-4o-mini' },
      ollama: { apiKey: '', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' },
      custom: { apiKey: '', baseUrl: '', model: '' }
    },
    maxTokens: 1024,
    temperature: 0.4,
    firstTokenTimeoutMs: 25000
  },
  context: {
    role: '',
    company: '',
    jobDescription: '',
    resume: '',
    language: 'auto',
    style: 'concise',
    customInstructions: ''
  },
  hotkeys: {
    ask: 'CommandOrControl+Shift+Space',
    screenshot: 'CommandOrControl+Shift+S',
    listening: 'CommandOrControl+Shift+L',
    panic: 'CommandOrControl+Shift+X',
    clickThrough: 'CommandOrControl+Shift+K'
  },
  overlay: {
    opacity: 0.96,
    fontSize: 13,
    width: 480,
    height: 380,
    x: null,
    y: null,
    mode: 'compact'
  },
  stealth: {
    contentProtection: true,
    hideOnSelfCapture: true
  },
  firstRunDone: false
}

export const APP_NAME = 'AuraNotes'
export const APP_VERSION = '0.1.0'
