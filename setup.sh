#!/usr/bin/env bash
# ExamPilot setup: install deps, sanity checks, optional Whisper check, launch.
set -e
cd "$(dirname "$0")"

NO_RUN=0
USE_CI=0
for arg in "$@"; do
  case "$arg" in
    --no-run) NO_RUN=1 ;;
    --ci) USE_CI=1 ;;
    --help|-h) echo "Usage: ./setup.sh [--no-run] [--ci]"; exit 0 ;;
  esac
done

echo "== ExamPilot setup =="

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 18+ is required. Install from https://nodejs.org/ then re-run."
  exit 1
fi
echo "node: $(node --version)  npm: $(npm --version)"

if [ "$USE_CI" = "1" ] && [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo "--- smoke test ---"
npm run smoke

# Optional: local Whisper CLI for offline transcription
if command -v whisper >/dev/null 2>&1; then
  echo "whisper: found ($(whisper --version 2>/dev/null | head -n1))"
elif python3 -m whisper --help >/dev/null 2>&1; then
  echo "whisper: found via python3 -m whisper"
else
  echo "whisper: not found (optional). Offline STT will be skipped unless installed:"
  echo "  pip install openai-whisper   # plus ffmpeg on PATH"
fi

if [ ! -f .env ] && [ -f env.example ]; then
  echo "tip: copy env.example to .env to pre-seed API keys (optional; Settings UI is primary)."
fi

if [ "$NO_RUN" = "1" ]; then
  echo "Setup complete (not launching)."
  exit 0
fi

echo "Launching ExamPilot..."
npm start
