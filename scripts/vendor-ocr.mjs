/*
 * Split reads receipt photos on the device with Tesseract (WebAssembly). Its worker, engine and
 * English model are served from this app — never a third-party CDN — so reading a receipt talks
 * to nobody else. They're copied out of node_modules before every build and dev start (they're
 * build output, not source: public/vendor/ocr is ignored by git).
 */
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = (name) => dirname(require.resolve(`${name}/package.json`));
const out = join(process.cwd(), 'public/vendor/ocr');
mkdirSync(out, { recursive: true });

const files = [
  [join(root('tesseract.js'), 'dist/worker.min.js'), 'worker.min.js'],
  // LSTM-only engines: plain, SIMD and relaxed SIMD (the worker picks what the device supports).
  [join(root('tesseract.js-core'), 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [
    join(root('tesseract.js-core'), 'tesseract-core-simd-lstm.wasm.js'),
    'tesseract-core-simd-lstm.wasm.js',
  ],
  [
    join(root('tesseract.js-core'), 'tesseract-core-relaxedsimd-lstm.wasm.js'),
    'tesseract-core-relaxedsimd-lstm.wasm.js',
  ],
  // The fast integer English model (about 3 MB), matching the LSTM engine.
  [join(root('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
];

for (const [from, to] of files) {
  const target = join(out, to);
  try {
    if (statSync(target).size === statSync(from).size) continue;
  } catch {}
  copyFileSync(from, target);
}
