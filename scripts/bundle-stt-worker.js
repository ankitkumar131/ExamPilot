// Builds the built-in speech worker bundle (Transformers.js Whisper, WASM).
// Cross-platform (Windows/macOS/Linux). Idempotent: skips when outputs are fresh.
// Output is generated at build/dev time: ui/vendor/stt-bundle.js + ui/vendor/ort/*.wasm
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'stt-worker', 'bundle-entry.mjs');
const OUT = path.join(ROOT, 'ui', 'vendor', 'stt-bundle.js');
const ORT_DIR = path.join(ROOT, 'ui', 'vendor', 'ort');
// Only single-threaded builds: file:// pages never get COOP/COEP, so the
// threaded WASM variants (SharedArrayBuffer) can never load — skip them (~19MB).
const ORT_FILES = ['ort-wasm-simd.wasm', 'ort-wasm.wasm'];

function fresh() {
  try {
    if (!fs.existsSync(OUT)) return false;
    const t = fs.statSync(OUT).mtimeMs;
    if (fs.statSync(ENTRY).mtimeMs > t) return false;
    for (const f of ORT_FILES) {
      const p = path.join(ORT_DIR, f);
      if (!fs.existsSync(p)) return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function main() {
  if (fresh() && !process.argv.includes('--force')) {
    console.log('[stt-worker] bundle fresh, skipping');
    return;
  }
  let esbuild;
  try {
    esbuild = require('esbuild');
  } catch (_) {
    console.error('[stt-worker] esbuild missing — run `npm install`. Built-in speech stays disabled until the bundle is built.');
    process.exit(fs.existsSync(OUT) ? 0 : 1);
  }
  try {
    fs.mkdirSync(ORT_DIR, { recursive: true });
    await esbuild.build({
      entryPoints: [ENTRY],
      bundle: true,
      platform: 'browser',
      format: 'iife',
      outfile: OUT,
      logLevel: 'warning',
    });
    const ortDist = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
    for (const f of ORT_FILES) fs.copyFileSync(path.join(ortDist, f), path.join(ORT_DIR, f));
    console.log('[stt-worker] bundle built:', path.relative(ROOT, OUT));
  } catch (e) {
    console.error('[stt-worker] build failed:', e.message);
    process.exit(1);
  }
}

main();
