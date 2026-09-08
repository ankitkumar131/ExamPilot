// IPC channel names, kept in sync between main, preload and renderer.

export const IPC = {
  // invoke (renderer -> main, awaits a result)
  cfgGet: 'cfg:get',
  cfgSet: 'cfg:set',
  audioStart: 'audio:start',
  audioStop: 'audio:stop',
  screensGet: 'screens:get',
  ask: 'ask',
  providerTest: 'provider:test',
  sessionReset: 'session:reset',
  sessionGet: 'session:get',
  windowOpen: 'window:open',
  appQuit: 'app:quit',

  // fire-and-forget (renderer -> main)
  audioChunk: 'audio:chunk',
  audioSegment: 'audio:segment',
  overlayBounds: 'overlay:bounds',

  // events (main -> renderer)
  evtTranscript: 'evt:transcript',
  evtAnswerStart: 'evt:answer-start',
  evtAnswerDelta: 'evt:answer-delta',
  evtAnswerDone: 'evt:answer-done',
  evtStatus: 'evt:status',
  evtCfg: 'evt:cfg',
  evtSttMode: 'evt:stt-mode',
  evtSession: 'evt:session'
} as const

export const STT_PROVIDER_LABELS: Record<string, string> = {
  deepgram: 'Deepgram (live streaming)',
  groq: 'Groq Whisper (fast batch)',
  openai: 'OpenAI Whisper (batch)',
  assemblyai: 'AssemblyAI (batch)',
  local: 'Local Whisper CLI (offline)'
}

export const LLM_PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  gemini: 'Google Gemini',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  ollama: 'Ollama (local)',
  custom: 'Custom (OpenAI-compatible)'
}

export const LLM_PROVIDER_HINTS: Record<string, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  gemini: 'https://aistudio.google.com/apikey',
  groq: 'https://console.groq.com/keys',
  openrouter: 'https://openrouter.ai/keys',
  ollama: 'No key needed. Install from https://ollama.com and pick a model.',
  custom: 'Any OpenAI-compatible endpoint (DeepSeek, Mistral, LM Studio, vLLM...). Set a base URL like https://api.deepseek.com/v1'
}

export const STT_PROVIDER_HINTS: Record<string, string> = {
  deepgram: 'https://console.deepgram.com',
  groq: 'https://console.groq.com/keys',
  openai: 'https://platform.openai.com/api-keys',
  assemblyai: 'https://www.assemblyai.com/app/api-keys',
  local: 'E.g. pip install openai-whisper, then set the command to "whisper". Runs fully offline.'
}

export const ANSWER_LANGUAGES = [
  { value: 'auto', label: 'Auto (match the question)' },
  { value: 'English', label: 'English' },
  { value: 'Hindi', label: 'Hindi' },
  { value: 'Spanish', label: 'Spanish' },
  { value: 'French', label: 'French' },
  { value: 'German', label: 'German' },
  { value: 'Portuguese', label: 'Portuguese' },
  { value: 'Arabic', label: 'Arabic' },
  { value: 'Chinese', label: 'Chinese' },
  { value: 'Japanese', label: 'Japanese' },
  { value: 'Russian', label: 'Russian' }
]
