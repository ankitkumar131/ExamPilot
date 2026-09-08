# AuraNotes

An open-source, cross-platform **AI interview copilot** — a real-time meeting assistant inspired by
[OpenCluely](https://github.com/TechyCSR/OpenCluely) and [Parakeet AI](https://www.parakeet-ai.com/).

It sits on your screen as a **screen-share-invisible overlay**, listens to your interview
(system audio and/or microphone), transcribes questions in real time, and streams AI-generated
answers — with **pluggable AI providers and automatic fallback** so it keeps working when one
provider is down, rate-limited, or unconfigured.

> **Status: work in progress.** Core architecture and the STT engine are in place; the LLM chain,
> renderer UI, and packaging are landing on this branch incrementally. See the roadmap below.

## Feature goals

| Area | What it does |
| --- | --- |
| 🫥 Stealth overlay | Frameless, transparent, always-on-top window. Excluded from screen capture (Windows/macOS content protection) so Zoom / Google Meet / Teams / OBS don't record it. Panic-hide hotkey. |
| 🎧 Real-time listening | Captures **system audio** (the interviewer) and/or the **microphone** with voice-activity detection. |
| 🗣️ Speech-to-text + fallback | Live streaming via **Deepgram**, with a fallback chain: **Groq Whisper → OpenAI Whisper → AssemblyAI → local Whisper CLI** (fully offline option). |
| 🧠 LLM answers + fallback | Ordered chain across **OpenAI, Anthropic, Google Gemini, Groq, OpenRouter, Ollama (local), and any custom OpenAI-compatible endpoint** — all user-configured. |
| 📸 Screenshot solving | Hotkey captures the screen (coding questions) and sends it to a vision-capable model. |
| 🧵 Session memory | Follow-up questions keep context; full session history and notes. |
| 🌍 Language aware | Answers in any configured language, regardless of the question's language. |
| ⚙️ Fully configurable | API keys, models, fallback order, VAD sensitivity, hotkeys, overlay style, interview context (role, company, resume). |
| 📦 Packaging | Windows `.exe` (NSIS) and Linux `.deb` / AppImage via electron-builder + GitHub Actions. |

## Architecture

```
Electron main process
├── config.ts          JSON config store (userData), atomic writes, change events
├── windows.ts         Overlay (stealth) + Settings windows
├── audio/stt-service  STT chain: Deepgram live WS + batch fallbacks (Groq/OpenAI/AssemblyAI/local)
├── ai/llm-service     LLM chain: OpenAI-compatible + Anthropic + Gemini adapters, SSE streaming (WIP)
├── session.ts         Interview engine: transcripts, question detection, answer orchestration (WIP)
└── ipc.ts             Typed bridge renderer <-> main (WIP)

Renderer (Vite + React)
├── overlay            Transcript ticker, live answers, ask box (WIP)
└── settings           Providers, fallback order, context, hotkeys, overlay style (WIP)
```

## Development

```bash
npm install
npm run dev          # Vite dev server + Electron
npm run typecheck    # tsc for main/preload + renderer
npm run build        # compile main (tsc) + renderer (vite)
npm run dist:win     # Windows .exe (NSIS)
npm run dist:linux   # Linux .deb + AppImage
```

## Roadmap

- [x] Project scaffold, shared types, config store, logging
- [x] Overlay + Settings window management (stealth flags, geometry persistence)
- [x] Tray, global hotkeys, panic-hide, click-through
- [x] STT engine: Deepgram streaming + fallback chain (Groq / OpenAI / AssemblyAI / local Whisper)
- [ ] LLM provider chain (OpenAI / Anthropic / Gemini / Groq / OpenRouter / Ollama / custom) with streaming + failover
- [ ] Interview session engine (question detection, auto-answer, session memory, notes)
- [ ] Audio capture pipeline in the overlay (mic + system loopback + VAD)
- [ ] Overlay UI (live transcript, streaming answers, markdown + code blocks)
- [ ] Settings UI (providers, fallback order, context, hotkeys, overlay style)
- [ ] Screenshot → vision model solving
- [ ] Preload IPC bridge
- [ ] electron-builder packaging (.exe / .deb / AppImage) + release workflow

## Responsible use

This tool is intended for **interview practice, mock interviews, accessibility, and personal
research**. Using it to deceive an interviewer may violate the policies of employers and
platforms and can have serious consequences. You are responsible for how you use it.

## License

MIT
