// Copies the text reader for /tools/image-to-text/ (tesseract.js worker, wasm core, English data)
// from node_modules into public/ocr/, so the site serves it itself and no CDN is needed.
// Runs before `astro dev` and `astro build`. public/ocr/ is not committed.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'ocr');
const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // The worker picks one of these three, depending on what the browser's WebAssembly supports.
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];
mkdirSync(out, { recursive: true });
for (const [from, to] of files) copyFileSync(join(nm, from), join(out, to));
console.log(`copy-ocr: ${files.length} files -> public/ocr/`);
