/**
 * world-atlas の TopoJSON を public/ にコピーする。
 *
 * バンドルに TopoJSON を焼き込まないための措置。
 * dev / build / test の前に自動実行される（package.json の predev / prebuild / pretest）。
 *
 * 2 段階の解像度を置く。110m は常に読む既定で、50m は国 / 地域にフィットしたときと
 * 大きく拡大したときだけ遅延読み込みされる（src/map/atlas.js 参照）。
 * 10m（3.5MB）は重すぎるので複製しない。
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** 複製する解像度。src/map/atlas.js が読む名前と揃える */
const ATLAS_FILES = ['countries-110m.json', 'countries-50m.json'];

for (const name of ATLAS_FILES) {
  const src = resolve(root, 'node_modules/world-atlas', name);
  const dest = resolve(root, 'public', name);

  if (!existsSync(src)) {
    console.error(`[copy-atlas] ${name} not found. Run npm install first.`);
    process.exit(1);
  }

  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`[copy-atlas] Updated public/${name}.`);
}
