# ExamPilot — invisible real-time interview copilot

**One app, every interview.** ExamPilot listens to your mic **and** call audio (Google Meet / Zoom / Teams…),
watches screenshots, and streams answers from **your own AI providers** with **automatic fallback** —
on an overlay that screen-sharing can't see.

Inspired by [OpenCluely](https://github.com/TechyCSR/OpenCluely) (stealth overlay + screenshots + Whisper)
and [Parakeet AI](https://www.parakeet-ai.com/) (sessions, auto-answer, AI notes, mock interviews) —
merged into one open, provider-agnostic desktop app.

> ⚠️ **Use responsibly.** Only use live assistance where it's allowed (practice, consensual calls, or
> interviews that permit AI tools). You're responsible for each employer's / platform's policies.

---

## Features

| Area | What you get |
|---|---|
| 🎧 **Listens to everything** | Mic (you) + system loopback (interviewer) captured together, VAD utterance detection, live transcript with speaker labels |
| ✦ **Auto Answer** | Auto mode answers the live transcript continuously; specific modes answer detected questions (toggleable) |
| ◧ **Screenshots** | One-click fullscreen capture → vision analysis (DSA, code, diagrams, error messages) |
| 🧠 **All interview types** | Auto-detect, DSA, Coding, Frontend, Backend, System Design, Behavioral/HR, DevOps, Data/ML, PM, General, Custom + 12 languages; code answers include keyword explanations |
| 🔑 **All AI providers** | OpenAI, Anthropic, Gemini, Groq, Mistral, DeepSeek, Together, OpenRouter, Azure OpenAI, Ollama (local), Custom — **multiple keys per provider** with auto-rotation, encrypted on-device |
| 🔁 **Fallback chains** | Key rotation inside each provider + ordered provider chain per answer; STT chain (local Whisper → OpenAI → Deepgram → AssemblyAI → Azure); visible hop trail |
| 🗂 **Sessions** | Parakeet-style dashboard: live/ended calls, search, transcripts, one-click **AI notes** (summary / questions / next steps) |
| 🎭 **Mock interviews** | Practice against an AI interviewer in Chat |
| 🥷 **Stealth (toggleable)** | Content-protected overlay (hidden from Meet/Zoom/Teams share), hidden taskbar/dock, disguised process name, panic key |
| 📝 **Context-aware** | Resume + JD per session (paste text or **upload PDF** — built-in parser); personal questions answered strictly from your resume |

## Quick start (code first — packaging later)

```bash
git clone <this-repo> && cd exam
./setup.sh            # installs deps, runs smoke tests, launches the app
```

Manual equivalent:

```bash
npm install
npm run smoke         # zero-dependency self-test
npm start             # launch (dev: npm run dev)
```

> **Windows users:** skip `setup.sh` (it's bash — needs Git Bash) and just run the three
> commands above in CMD/PowerShell. If your npm version blocks install scripts with
> `install-scripts ... electron@... (postinstall: node install.js)`, allow + rebuild once:
>
> ```bat
> npm install-scripts approve electron
> npm rebuild electron
> npx electron --version
> ```
>
> The `deprecated` / `vulnerabilities` warnings during install come from electron-builder's
> dependency tree — they're harmless. Do **not** run `npm audit fix --force` (it breaks the build).

On first launch the onboarding wizard asks for **one** API key (free: Gemini / Groq),
tests it, and you're live. Add more providers anytime in **Settings → Providers**.

## Windows

| Window | Shortcut | Purpose |
|---|---|---|
| Overlay toolbar | — | Listen, Answer, Shot, Chat, Sessions, mode/language, live transcript |
| AI Response | auto-shows | Streaming answers, code blocks, fallback trail |
| Chat | `Ctrl+Shift+C` | Follow-ups + mock interviews |
| Sessions | `Ctrl+Shift+D` | Dashboard, transcripts, AI notes |
| Settings | `Ctrl+,` | Providers, fallback, audio/speech, stealth, shortcuts, context |

Full shortcut list (all remappable in Settings):

| Action | Default |
|---|---|
| Screenshot + analyze | `Ctrl+Shift+S` |
| Panic hide / show | `Ctrl+Shift+H` |
| Click-through toggle | `Ctrl+Shift+I` |
| Start / stop listening | `Alt+R` |
| Force answer | `Ctrl+Shift+A` |
| Clear session memory | `Ctrl+Shift+Backspace` |
| Move overlay | `Ctrl+Arrows` |
| Quit | `Ctrl+Shift+Q` |

## Audio setup notes

- **Windows**: mic + system loopback both work out of the box (desktop audio capture).
- **Linux**: mic works; system audio needs a PulseAudio monitor source — set it in
  Settings → Audio (`pactl list sources | grep monitor` to find yours).
- **macOS**: mic works; system-audio loopback is limited by the OS (mic-only is reliable).
- No SoX/drivers needed — capture runs on WebAudio in the overlay window.

## Configuration

- Primary: in-app **Settings** (persisted to OS user-data dir as `settings.json`, keys encrypted).
- Fallback: env vars / `.env` next to user-data (see `env.example`).
- Sessions: `<userData>/sessions.json`. Logs: `<userData>/logs/`.
- Override data dir (e.g. tests): `EXAMPILOT_DATA_DIR=/tmp/x npm start`.

## Packaging (.exe / .deb) — later step

Code is the focus for now, but `electron-builder` is pre-configured:

```bash
npm run build:win     # → dist/*.exe (NSIS + portable)
npm run build:linux   # → dist/*.deb + AppImage
```

CI (`.github/workflows/build.yml`) builds both on version tags. macOS: run from source
(`./setup.sh`) — the build is unsigned, so Gatekeeper blocks downloaded binaries.

## Project layout

```
main.js / preload.js          Electron main + IPC bridge
src/core/                     config, encrypted settings store, logger, first-run
src/services/llm/             11 providers (REST+streaming) + fallback router
src/services/stt.js           5 speech engines + STT fallback router
src/services/audio.service.js VAD audio hub (mic + loopback PCM)
src/services/capture.service.js desktopCapturer screenshots
src/services/transcript.service.js rolling transcript + question detection
src/services/session.service.js sessions + persistence
src/services/notes.service.js post-call AI notes
src/prompts/templates.js      12 interview modes + mock interviewer
src/managers/                 stealth windows + global shortcuts
ui/                           overlay, response, chat, sessions, settings, onboarding, picker
scripts/smoke.js              self-test suite (no deps)
```

## Roadmap

- [ ] `.exe` / `.deb` release builds + auto-update
- [ ] Document upload (PDF/DOCX briefs referenced live)
- [ ] Question bank (company-wise, frequency-ranked)
- [ ] Per-task provider routing UI (vision vs notes chains)
- [ ] Multi-language transcript (50+ via Deepgram/Azure)

## License

MIT — see `LICENSE`.
