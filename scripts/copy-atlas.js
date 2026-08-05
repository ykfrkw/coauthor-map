/**
 * world-atlas の countries-110m.json を public/ にコピーする。
 *
 * バンドルに 110KB の TopoJSON を焼き込まないための措置。
 * dev / build の前に自動実行される（package.json の predev / prebuild）。
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const src = resolve(root, 'node_modules/world-atlas/countries-110m.json');
const dest = resolve(root, 'public/countries-110m.json');

if (!existsSync(src)) {
  console.error(
    '[copy-atlas] world-atlas が見つからない。npm install を先に実行する。',
  );
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log('[copy-atlas] public/countries-110m.json を更新した。');
