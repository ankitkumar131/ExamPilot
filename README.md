# ExamPilot — invisible real-time interview copilot

**One app, every interview.** ExamPilot listens to your mic **and** call audio, watches your
screen, and streams answers from **your own AI providers** with **automatic fallback** — on an
overlay that screen-sharing can't see, in an app that never appears in your taskbar, dock, or tray.

> **Download:** [Latest release (.exe / .deb)](https://github.com/ankitkumar131/exam/releases/latest)
> · Windows: `ExamPilot-Setup-*.exe` · Linux: `ExamPilot-*.deb` (or portable `.AppImage`)

> ⚠️ **Use responsibly.** Only use live assistance where it's allowed (practice, consensual calls,
> or interviews that permit AI tools). You're responsible for each employer's / platform's policies.

---

## Table of contents

- [What makes it different](#what-makes-it-different)
- [Features](#features)
- [The fallback system](#the-fallback-system)
- [AI providers](#ai-providers)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Install from releases](#install-from-releases)
- [Run from source](#run-from-source)
- [Audio setup](#audio-setup)
- [Invisibility: taskbar, dock, tray](#invisibility-taskbar-dock-tray)
- [Settings reference](#settings-reference)
- [Configuration files](#configuration-files)
- [Build installers yourself](#build-installers-yourself)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [License](#license)

---

## What makes it different

| | **ExamPilot** | Cluely | OpenCluely | Parakeet AI |
|---|---|---|---|---|
| Open source (MIT) | ✅ | ❌ | ✅ | ❌ |
| Price | **Free forever** | $20/mo | Free | ~$50–150/mo |
| Your own API keys (BYOK) | ✅ 11 providers | ❌ locked-in | ⚠️ Gemini only | ❌ locked-in |
| **Multiple keys per provider + rotation** | ✅ | ❌ | ❌ | ❌ |
| Provider fallback chain | ✅ ordered, visible | ❌ | ⚠️ model-only | ✅ (theirs) |
| Speech-engine fallback | ✅ 5 engines | — | ⚠️ 2 engines | ✅ (theirs) |
| Offline option (Ollama + local Whisper) | ✅ | ❌ | ⚠️ Whisper only | ❌ |
| Interview modes | ✅ 12 modes | ⚠️ few | ⚠️ DSA/coding | ✅ |
| Sessions + AI notes + transcripts | ✅ | ⚠️ | ❌ | ✅ |
| Mock interviews | ✅ built-in | ❌ | ❌ | ✅ paid |
| Resume/JD context + PDF parsing | ✅ built-in | ⚠️ | ❌ | ✅ |
| Invisible on screen-share | ✅ toggleable | ✅ | ✅ | ✅ |
| Hidden from taskbar/dock/tray | ✅ **always** | ❌ | ⚠️ partial | ❌ |
| No account, no telemetry | ✅ | ❌ | ✅ | ❌ |
| Windows `.exe` + Linux `.deb` | ✅ | ⚠️ Win/Mac | ✅ | ⚠️ Win/Mac |

**In short:** Parakeet-style calling features + OpenCluely-style stealth, with *your* keys,
*your* fallback order, and *zero* subscription — for every kind of interview, not just DSA.

---

## Features

### 🎧 Listens to everything
- Captures **microphone (you)** + **system/call audio (interviewer)** simultaneously.
- Energy-based voice detection splits speech into utterances — no fixed timers cutting sentences.
- **Live transcript** with speaker labels streams in the overlay; full history per session.
- No drivers needed: capture runs on WebAudio inside the overlay window.

### ✦ Auto Answer
- **Auto mode:** every piece of interviewer speech is transcribed and answered continuously
  (~1s after a pause) — answers appear while the call is still going.
- **Specific modes** (DSA, Coding…): only clear questions trigger answers.
- Anything you type in **Chat** is always answered, in any mode.
- Toggle with the `Auto` button or keep it manual with the `Answer` button / shortcut.

### ◧ One-click screenshots
- One press captures the **full screen automatically** — no region selection.
- Sent straight to a vision-capable provider: DSA problems, code, stack traces, diagrams,
  error dialogs. The last screenshot also stays as context for follow-up answers (~2 min).

### 🧠 12 interview modes + 12 languages
Modes: **Auto-detect**, DSA/LeetCode, General Coding, Frontend, Backend/APIs, System Design,
Behavioral/HR, DevOps/SRE, Data/ML, Product/PM, General/Sales calls, Custom (your instructions).
Languages: Python, JavaScript, TypeScript, C++, C, Java, Go, Rust, C#, Kotlin, Swift, SQL.

Every **code answer** includes: optimal approach → clean code → time/space complexity →
**Keyword notes** (one-line explanation of each important keyword/syntax used).

### 🗂 Sessions, transcripts, AI notes
Parakeet-style dashboard: create live sessions (company, role, mode, resume, JD), search/filter,
re-open transcripts, and on **End** get auto-generated **AI notes** —
Summary / Questions Asked / Next Steps.

### 🎭 Mock interviews
Chat → **Mock interview: ON** turns the AI into an interviewer for your target role:
one question at a time, verdict after each answer, rising difficulty.

### 📝 Resume + JD context with built-in PDF parser
Paste text or **upload Resume/JD PDFs** (parsed in-app, up to 15 MB) — per session or as
defaults. Every answer is grounded in your background, and **personal questions are answered
strictly from your resume** (the AI is instructed to never invent employers, dates, or numbers).

### 🥷 Stealth
- **Always hidden** from taskbar, dock, Alt+Tab, and system tray — no icon *anywhere*.
  Only visible in Task Manager / System Monitor (like any process).
- **Toggleable share-protection:** hidden from Meet/Zoom/Teams/Discord screen-shares
  (content protection), disguised process name, hidden dock icon.
- **Panic key** (`Ctrl+Shift+H`) hides every window instantly; press again to restore.

---

## The fallback system

ExamPilot never depends on a single key, model, or cloud. Three nested safety nets:

```
Answer request
  └─ for each PROVIDER in your order (Settings → Fallback)
       └─ for each API KEY of that provider (key 1, 2, 3…)
            └─ try (1 + retries)
                 ├─ 401/403 or 429/quota  → next KEY  (rotation)
                 ├─ 5xx / timeout / network → next PROVIDER
                 └─ success → stream answer
  All failed → one clear error listing every attempted hop
```

1. **Key rotation (inside a provider).** Add several keys per provider; a rate-limited or
   dead key is skipped automatically, mid-stream failures restart on the next key.
2. **Provider chain (across providers).** Your ordered list (default:
   Groq → Gemini → OpenAI → Anthropic → …) with per-key retries, timeouts, and a visible
   hop trail (`groq·k2✗ → gemini✓`) in the answer window.
3. **Speech chain (transcription).** Each utterance tries your STT order:
   **local Whisper (offline)** → OpenAI Whisper → Deepgram → AssemblyAI → Azure.
   Silence is detected without burning the chain.
4. **Vision-aware routing.** Screenshot questions automatically skip providers/models
   without vision support.

Everything is configurable: order (drag with ↑↓), models, base URLs, timeouts, retries,
temperature, max tokens — per provider, in Settings. Keys are encrypted on-device
(OS keychain where available) and sent only to the provider you enabled.

---

## AI providers

| Provider | Key | Cost to start | Vision | Notes |
|---|---|---|---|---|
| Groq | [console.groq.com](https://console.groq.com/keys) | Free tier ☁️ | ✅ | Fast; great default #1 |
| Google Gemini | [aistudio.google.com](https://aistudio.google.com/) | Free tier ☁️ | ✅ | Great default #2 |
| OpenAI | [platform.openai.com](https://platform.openai.com/api-keys) | Pay-as-you-go | ✅ | `gpt-4o-mini` is cheap |
| Anthropic | [console.anthropic.com](https://console.anthropic.com/) | Pay-as-you-go | ✅ | Strong reasoning |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com/) | Cheap | ❌ | Text answers only |
| Mistral | [console.mistral.ai](https://console.mistral.ai/) | Free tier ☁️ | ✅ | EU option |
| Together AI | [api.together.xyz](https://api.together.xyz/) | Free credits ☁️ | ✅ | 100+ open models |
| OpenRouter | [openrouter.ai](https://openrouter.ai/keys) | Varies | ✅ | One key, many models |
| Azure OpenAI | [portal.azure.com](https://portal.azure.com/) | Enterprise | ✅ | Resource + deployment |
| Ollama (local) | — | **Free / offline** | ✅* | `ollama serve` + pull a model |
| Custom endpoint | — | Varies | ✅* | Any OpenAI-compatible API (LM Studio, vLLM…) |

\* Vision depends on the model you load (e.g. `llava`, `llama3.2-vision`).

**Recommended starter:** Groq + Gemini (both free) → add OpenAI/Anthropic as backup.

---

## Keyboard shortcuts

All global (work while any app is focused) and remappable in Settings → Shortcuts.

| Action | Default |
|---|---|
| Screenshot + analyze (fullscreen, automatic) | `Ctrl+Shift+S` |
| Panic: hide / restore all windows | `Ctrl+Shift+H` |
| Toggle click-through (interact vs ignore mouse) | `Ctrl+Shift+I` |
| Start / stop listening | `Alt+R` |
| Force answer from transcript | `Ctrl+Shift+A` |
| Open chat | `Ctrl+Shift+C` |
| Open sessions dashboard | `Ctrl+Shift+D` |
| Open settings | `Ctrl+,` |
| Clear session memory | `Ctrl+Shift+Backspace` |
| Move overlay | `Ctrl+Arrows` |
| Quit app | `Ctrl+Shift+Q` |

Quit methods (since there's no tray icon): `Ctrl+Shift+Q`, Task Manager / System Monitor,
or the Hide/close buttons + then quit via shortcut.

---

## Install from releases

**Windows** — download `ExamPilot-Setup-<ver>.exe` from
[Releases](https://github.com/ankitkumar131/exam/releases/latest), run it, launch
*ExamPilot* from the Start Menu. (Portable `.exe` also available — no install.)
Windows SmartScreen may warn on first run (the build is unsigned) → *More info → Run anyway*.

**Linux** — download `ExamPilot-<ver>.deb`:
```bash
sudo dpkg -i ExamPilot-*.deb   # or double-click in your file manager
exampilot                      # or launch from the app menu
```
Portable `.AppImage` also available: `chmod +x ExamPilot-*.AppImage && ./ExamPilot-*.AppImage`.

**macOS** — no signed build (Gatekeeper would block it). Run from source instead —
see below. System-audio loopback is limited on macOS; mic capture works fully.

First launch opens the **onboarding wizard**: pick a provider, paste a key, Test, Finish.

---

## Run from source

```bash
git clone https://github.com/ankitkumar131/exam.git
cd exam
npm install
npm run smoke     # self-test: 12 checks, no keys needed
npm start         # launch (dev: npm run dev)
```

- Linux/macOS one-liner: `./setup.sh` (installs, tests, launches).
- Windows: use the commands above in CMD/PowerShell. If npm blocks Electron's install
  script: `npm install-scripts approve electron && npm rebuild electron`.
- Ignore `deprecated`/vulnerability warnings from electron-builder deps; never run
  `npm audit fix --force`.

---

## Audio setup

| OS | Microphone | System/call audio |
|---|---|---|
| Windows | ✅ automatic | ✅ automatic (desktop loopback) |
| Linux | ✅ automatic | ⚠️ set a PulseAudio monitor source in Settings → Audio (`pactl list sources \| grep monitor`) |
| macOS | ✅ automatic | ⚠️ limited by the OS; mic-only is reliable |

Tips: keep call volume up and mic sensitivity moderate; in Auto mode the interviewer's
speech answers itself, otherwise press `Answer` or ask in Chat.

---

## Invisibility: taskbar, dock, tray

| Surface | Visible? |
|---|---|
| Windows taskbar / Alt+Tab | **Never** (`skipTaskbar` on every window) |
| Ubuntu/GNOME/KDE dock & taskbar | **Never** |
| macOS dock | **Never** (dock icon hidden at launch) |
| System tray / hidden icons | **Never** (no tray icon is created, ever) |
| Screen-share (Meet/Zoom/Teams/Discord) | Hidden when share-protection is ON (default) |
| Task Manager / System Monitor / `ps` | **Visible** (impossible & unsafe to hide; process name disguised when stealth is on) |
| Start Menu / app launcher | Launcher shortcut only (needed to start the app) |

Bring windows back with `Ctrl+Shift+H`. Force always-on-top repair:
`Ctrl+Shift+T` (macOS level reset: `Ctrl+Shift+Alt+T`).

---

## Settings reference

- **Providers** — enable + keys (multiple per provider), model, base URL, per-key **Test**.
- **Fallback & Models** — provider order ↑↓, STT order ↑↓, timeout, max tokens,
  temperature, retries.
- **Audio & Speech** — mic/system sources, language, auto-answer, VAD tuning, local
  Whisper + cloud STT keys, Linux monitor source.
- **Stealth** — screen-share protection toggle, disguised process name.
  (Taskbar/dock/tray hiding is permanent.)
- **Shortcuts** — remap every global hotkey.
- **Session & Context** — default mode/language/company/role, resume + JD (text or PDF).
- **About** — version, responsible-use note.

---

## Configuration files

| What | Where |
|---|---|
| Settings (keys encrypted) | `<userData>/settings.json` |
| Sessions + transcripts | `<userData>/sessions.json` |
| Logs | `<userData>/logs/` |
| Optional `.env` key fallback | `<userData>/.env` (see `env.example`) |

`<userData>` = `%APPDATA%/ExamPilot` (Win) · `~/.config/ExamPilot` (Linux) ·
`~/Library/Application Support/ExamPilot` (mac). Override with `EXAMPILOT_DATA_DIR`.

---

## Build installers yourself

```bash
npm run build:win     # → dist/*.exe (NSIS installer + portable)
npm run build:linux   # → dist/*.deb + .AppImage
npm run build:mac     # unsigned dmg/zip (Gatekeeper will block; run from source instead)
```

Releases are built automatically: push a `v*` tag and GitHub Actions builds + attaches
both installers to the release (see `.github/workflows/build.yml`).

---

## Project layout

```
main.js / preload.js            Electron main + context-isolated IPC bridge (45 calls, 15 events)
src/core/                       config, encrypted multi-key store, logger, first-run
src/services/llm/               11 providers (REST + streaming, no SDKs) + fallback router
src/services/stt.js             5 speech engines + STT fallback router
src/services/audio.service.js   VAD audio hub (mic + loopback PCM → utterances)
src/services/capture.service.js fullscreen screenshots (desktopCapturer)
src/services/transcript.service.js rolling transcript + auto-answer triggers
src/services/session.service.js sessions + persistence
src/services/notes.service.js   post-call AI notes
src/prompts/templates.js        12 interview modes + mock interviewer
src/managers/                   stealth windows + global shortcuts
ui/                             overlay, response, chat, sessions, settings, onboarding
scripts/smoke.js                12-check self-test (works with zero deps installed)
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm run dev` → `'env' is not recognized` | Old version — `git pull`; scripts are cross-platform now |
| npm blocks `electron postinstall` | `npm install-scripts approve electron && npm rebuild electron` |
| No system audio (Linux) | Set PulseAudio monitor source in Settings → Audio |
| No system audio (macOS) | OS limitation — use mic, or play call on speakers |
| `All AI providers failed` | Settings → Providers: enable ≥1, Test keys; check order in Fallback tab |
| Whisper CLI not found | `pip install openai-whisper` (+ffmpeg), or use a cloud STT engine |
| Overlay lost / behind windows | `Ctrl+Shift+T` re-pins always-on-top; `Ctrl+Shift+H` toggles visibility |
| Blank/transparent window on Linux | App already forces software rendering; update GPU drivers if it persists |

---

## Roadmap

- [x] `.exe` / `.deb` releases
- [ ] Document library (PDF/DOCX briefs referenced live mid-call)
- [ ] Question bank (company-wise, frequency-ranked)
- [ ] Per-task provider routing UI (separate vision/notes chains)
- [ ] 50+ transcript languages
- [ ] Auto-update (electron-updater)

---

## License

MIT — see [LICENSE](LICENSE). No telemetry, no accounts, your keys never leave your machine
except to the providers you enable.
