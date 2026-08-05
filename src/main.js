/**
 * index.html / widget.html のエントリ。
 *
 * データ層との接点はこの import 1 点だけ。
 * `buildDataset(options: BuildOptions) => Promise<Dataset>`
 */
import './css/tokens.css';
import './css/style.css';
import { createApp } from './app.js';
import { buildDataset } from './pipeline.js';
import { startReviewIfRequested } from './review/gate.js';

const mode = document.body.dataset.mode === 'widget' ? 'widget' : 'full';

const app = createApp({
  mode,
  loadDataset: (options) => buildDataset(options),
});

// オーナー専用のレビューモード。?review=1 のときだけ別チャンクを動的 import する。
// 付いていなければ import() 自体が起きないので、通常の訪問者には何も届かない。
startReviewIfRequested({
  page: mode === 'widget' ? 'widget' : 'index',
  getState: () => app.state,
});
