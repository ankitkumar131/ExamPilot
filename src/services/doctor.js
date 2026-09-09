// First-run Setup Doctor: fast (<2s), parallel, fully offline checks.
// Every check: { id, label, ok, detail, fix, hint?, skipped? }
// fix: null | 'download-model' | 'open-settings:providers' | 'open-settings:audio'
async function runDoctor({ store, routerStatus, worker, spawnCheck, mic } = {}) {
  const checks = [];
  const noSpawn = async () => ({ ok: false, error: 'check unavailable' });
  const spawn = spawnCheck || noSpawn;

  // 1. AI providers — the one thing the app cannot auto-install (keys need
  // a free account signup). Doctor points at free tiers instead.
  const st = routerStatus || {};
  const ready = Object.entries(st)
    .filter(([, p]) => p && p.enabled && p.configured)
    .map(([id]) => id);
  checks.push(ready.length
    ? { id: 'providers', label: 'AI providers', ok: true, detail: `${ready.length} ready (${ready.slice(0, 4).join(', ')})`, fix: null }
    : {
      id: 'providers', label: 'AI providers', ok: false,
      detail: 'No AI provider configured — answers cannot work yet.',
      fix: 'open-settings:providers',
      hint: 'Free to start: Groq + Gemini (signup links are in Settings → Providers).',
    });

  // 2. Built-in offline speech (the auto-installable engine).
  const bcfg = (store && store.getSttConfig('whisper-builtin')) || { enabled: true, model: 'tiny.en' };
  const w = worker || {};
  if (bcfg.enabled === false) {
    checks.push({ id: 'stt-builtin', label: 'Built-in speech (offline)', ok: true, skipped: true, detail: 'Disabled — using other engines.', fix: null });
  } else if (!w.bundleExists) {
    checks.push({ id: 'stt-builtin', label: 'Built-in speech (offline)', ok: false, detail: 'Speech bundle not built (source run: npm run bundle:worker).', fix: null });
  } else if (w.loadError) {
    checks.push({ id: 'stt-builtin', label: 'Built-in speech (offline)', ok: false, detail: `Worker error: ${w.loadError}`, fix: 'download-model' });
  } else if (w.loaded) {
    checks.push({ id: 'stt-builtin', label: 'Built-in speech (offline)', ok: true, detail: `Model ${w.model || bcfg.model} loaded — fully offline.`, fix: null });
  } else if (w.cached) {
    checks.push({ id: 'stt-builtin', label: 'Built-in speech (offline)', ok: true, detail: `Model ${w.model || bcfg.model} downloaded — loads on first Listen.`, fix: null });
  } else {
    checks.push({
      id: 'stt-builtin', label: 'Built-in speech (offline)', ok: false,
      detail: `Model ${bcfg.model || 'tiny.en'} not downloaded yet (one-time, free).`,
      fix: 'download-model',
    });
  }

  // 3+4. CLI alternatives (optional now that built-in exists; informational only).
  const [cli, ff] = await Promise.all([
    spawn('whisper', ['--help'], 8000).catch(() => ({ ok: false })),
    spawn('ffmpeg', ['-version'], 5000).catch(() => ({ ok: false })),
  ]);
  const cliBackup = !!(cli.ok && ff.ok);
  checks.push({
    id: 'stt-cli', label: 'Whisper CLI (backup)', ok: true, skipped: !cliBackup,
    detail: cliBackup ? 'Installed — works as a backup engine.' : 'Not installed (optional — built-in engine covers you).',
    fix: null,
  });

  // 5. Cloud engines (optional; informational).
  let cloudCount = 0;
  try {
    cloudCount = ['openai-whisper', 'deepgram', 'assemblyai', 'azure'].filter((id) => {
      const c = store.getSttConfig(id);
      return c.enabled && (c.apiKey || c.key);
    }).length;
  } catch (_) {}
  checks.push({
    id: 'stt-cloud', label: 'Cloud speech (backup)', ok: true, skipped: !cloudCount,
    detail: cloudCount ? `${cloudCount} cloud engine(s) ready.` : 'None configured (optional — built-in engine covers you).',
    fix: null,
  });

  // 6. Overall speech gate — the critical one.
  const builtinCheck = checks.find((c) => c.id === 'stt-builtin');
  const builtinReady = builtinCheck.ok && !builtinCheck.skipped;
  if (builtinReady || cliBackup || cloudCount > 0) {
    const via = builtinReady ? 'built-in offline engine' : (cliBackup ? 'Whisper CLI' : 'cloud engines');
    checks.push({ id: 'stt-overall', label: 'Speech-to-text', ok: true, detail: `Ready via ${via}.`, fix: null });
  } else {
    checks.push({
      id: 'stt-overall', label: 'Speech-to-text', ok: false,
      detail: 'No working speech engine — transcription cannot work yet.',
      fix: 'download-model',
      hint: 'One click: download the free offline model. No Python, no keys needed.',
    });
  }

  // 7. Microphone (reported by the overlay; browsers only reveal after a prompt).
  const mstate = mic && mic.state;
  if (mstate === 'granted') {
    checks.push({ id: 'mic', label: 'Microphone', ok: true, detail: 'Permission granted.', fix: null });
  } else if (mstate === 'denied') {
    checks.push({ id: 'mic', label: 'Microphone', ok: false, detail: 'Blocked — allow mic access in OS/browser settings, then restart the app.', fix: null });
  } else {
    checks.push({ id: 'mic', label: 'Microphone', ok: true, skipped: true, detail: 'Will request access on first Listen.', fix: null });
  }

  return { ok: checks.every((c) => c.ok), checks };
}

module.exports = { runDoctor };
