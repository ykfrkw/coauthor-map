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

// widget.html のクレジット行を埋め込み時に隠す判定の根拠（widget.html 側は
// JS を待たずに消すため inline script で先に済ませてある。ここは覚え書き）:
// iframe の内側のリンクは埋め込み先ページからの被リンクにならない
// （検索エンジンは iframe 内の文書に帰属させる）ので、効くのはスニペットが
// 親ページに置くクレジット行だけ。内側に残すと同じ行が二重に見えるだけで
// 得るものが無い。単体で開いたときは唯一の表示なので出す。

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
