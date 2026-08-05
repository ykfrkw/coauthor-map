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

const mode = document.body.dataset.mode === 'widget' ? 'widget' : 'full';

createApp({
  mode,
  loadDataset: (options) => buildDataset(options),
});
