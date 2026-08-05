/**
 * 開発用エントリ。**本番ビルドには含めない**（vite.config.js の input に無い）。
 *
 * データ層（pipeline.js）が未完成でも描画の実装と目視確認ができるように、
 * tests/fixtures/dataset-snapshot.json をそのまま食わせる。
 * snapshot は Dataset の Map が配列に落ちた形なので、derive.js が矯正する。
 */
import './css/tokens.css';
import './css/style.css';
import { createApp } from './app.js';

const SNAPSHOT_URL = './tests/fixtures/dataset-snapshot.json';

createApp({
  mode: 'full',
  loadDataset: async ({ onProgress }) => {
    // onProgress は本番と同じ安定キーの契約に乗せる（文言は app.js が引く）
    onProgress?.('seeds', 0, 1);
    const res = await fetch(SNAPSHOT_URL);
    if (!res.ok) throw new Error(`${SNAPSHOT_URL}: HTTP ${res.status}`);
    const snapshot = await res.json();
    onProgress?.('aggregate', 1, 1);
    return snapshot;
  },
});
