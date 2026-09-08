// ---------------------------------------------------------------------------
// Shared types used by the Electron main process, the preload bridge and the
// renderer windows (overlay + settings).
// ---------------------------------------------------------------------------

export type AudioSource = 'system' | 'mic'

export type SttProviderId = 'deepgram' | 'groq' | 'openai' | 'assemblyai' | 'local'
export type LlmProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'openrouter'
  | 'ollama'
  | 'custom'

export type AnswerStyle = 'concise' | 'bullets' | 'detailed' | 'star'

// --------------------------------------------------------------------------
// Config
// --------------------------------------------------------------------------

export interface SttCloudProviderConfig {
  apiKey: string
  model: string
}

export interface SttLocalProviderConfig {
  /** Full CLI command that runs whisper, e.g. "whisper" or "/path/to/whisper". */
  command: string
  model: string
  /** ISO code or "auto". */
  language: string
}

export interface VadConfig {
  /** RMS energy threshold (0..1). Lower = more sensitive. */
  threshold: number
  /** Silence duration that closes a speech segment (ms). */
  silenceMs: number
  /** Minimum speech length to be considered a segment (ms). */
  minSpeechMs: number
  /** Discard segments shorter than this many ms entirely. */
  minSegmentMs: number
}

export interface SttConfig {
  /** Ordered fallback chain. The first configured provider is used; on failure
   *  the next one is tried. */
  chain: SttProviderId[]
  deepgram: SttCloudProviderConfig
  groq: SttCloudProviderConfig
  openai: SttCloudProviderConfig
  assemblyai: SttCloudProviderConfig
  local: SttLocalProviderConfig
  /** "auto" or an ISO language code passed to the provider. */
  language: string
  /** Prefer live streaming transcription (Deepgram) when available. */
  streaming: boolean
  sources: { system: boolean; mic: boolean }
  /** Which audio sources can trigger automatic answers. */
  questionSources: AudioSource[]
  /** Automatically generate an answer when a question is detected. */
  autoAnswer: boolean
  questionDetection: { minWords: number }
  vad: VadConfig
}

export interface LlmProviderConfig {
  apiKey: string
  /** Overrides the default endpoint base URL (works for proxies / Gateways). */
  baseUrl: string
  model: string
}

export interface LlmConfig {
  chain: LlmProviderId[]
  providers: Record<LlmProviderId, LlmProviderConfig>
  maxTokens: number
  temperature: number
  /** Timeout for the first token of a provider attempt. */
  firstTokenTimeoutMs: number
}

export interface ContextConfig {
  role: string
  company: string
  jobDescription: string
  resume: string
  /** "auto" = answer in the language of the question. */
  language: string
  style: AnswerStyle
  /** Extra custom instructions appended to the system prompt. */
  customInstructions: string
}

export interface HotkeysConfig {
  /** Solve the last question / current input. */
  ask: string
  /** Capture the screen and solve what is on it. */
  screenshot: string
  /** Start / stop listening. */
  listening: string
  /** Instantly hide / show every app window. */
  panic: string
  /** Toggle click-through on the overlay. */
  clickThrough: string
}

export interface OverlayConfig {
  opacity: number
  fontSize: number
  width: number
  height: number
  x: number | null
  y: number | null
  mode: 'compact' | 'expanded'
}

export interface StealthConfig {
  /** Exclude app windows from screen capture (Windows / macOS). */
  contentProtection: boolean
  /** Hide windows while a screenshot is being captured by the app itself. */
  hideOnSelfCapture: boolean
}

export interface AppConfig {
  stt: SttConfig
  llm: LlmConfig
  context: ContextConfig
  hotkeys: HotkeysConfig
  overlay: OverlayConfig
  stealth: StealthConfig
  firstRunDone: boolean
}

// --------------------------------------------------------------------------
// Runtime events
// --------------------------------------------------------------------------

export interface TranscriptEvent {
  id: string
  source: AudioSource
  text: string
  isFinal: boolean
  ts: number
  provider?: string
}

export type AskKind = 'question' | 'screenshot' | 'notes'

export interface AskRequest {
  kind: AskKind
  text?: string
  /** Base64 PNG (no data-url prefix) for screenshot requests. */
  image?: { data: string; mime: string }
}

export interface ProviderFailure {
  id: string
  error: string
}

export interface AnswerStartEvent {
  requestId: string
  kind: AskKind
  question: string
  ts: number
}

export interface AnswerDeltaEvent {
  requestId: string
  provider: string
  delta: string
}

export interface AnswerDoneEvent {
  requestId: string
  provider: string | null
  ok: boolean
  error?: string
  failures: ProviderFailure[]
  ms: number
}

export type SttMode = 'streaming' | 'segments'

export interface AppStatus {
  listeningSystem: boolean
  listeningMic: boolean
  sttMode: SttMode
  activeStt: string | null
  clickThrough: boolean
  hidden: boolean
}

export interface ProviderTestResult {
  ok: boolean
  ms: number
  error?: string
  detail?: string
}

export interface ScreenSourceInfo {
  id: string
  name: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  text: string
  image?: { data: string; mime: string }
}

export interface SessionTurn {
  question: string
  answer: string
  provider: string | null
  ts: number
}
