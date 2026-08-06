/**
 * どのページにどのパネルを出すかの唯一の判断表。
 *
 * app.js は `if (panels.table)` の形でしかパネルを組まない。**分岐をここ 1 か所に
 * 集める**ことで、DOM を立てずにページ構成をテストで凍結できる（この repo は
 * jsdom を入れていないので、実 DOM で「出た / 出ない」を見る手段が無い）。
 *
 * widget.html は既定では表示専用のまま。`?controls=on` のときだけ、
 * 読者が自分の ID を入れて自分の地図を作れるだけの操作 UI を足す。
 * **埋め込みコード生成もそこに含める。** 自分の地図を作った読者が、それを
 * 自分のサイトに貼るコードを得るためだけにフルツールへ飛ばされるのを避ける
 * （折りたたみで置くので、閉じているあいだは地図とコントロールを押し下げない）。
 * 補正パネル・集計テーブル・ダウンロードは `?controls=on` でも出さない
 * （記事本文が担うか、埋め込みには重い）。
 */

/** index.html が出す操作パネルの中身 */
export const FULL_VIEW_FIELDS = Object.freeze([
  'years',
  'grain',
  'size',
  'labels',
  'proj',
  'scope',
  'center',
  'theme',
  'grainHint',
]);

/**
 * `?controls=on` の widget が出す操作パネルの中身。
 *
 * 読者が自分の地図を作るのに要る最小限だけ。City labels / Extent / 長い注記は
 * 落とす（記事に埋める枠の高さは本文のリズムを壊さない範囲に留めたい）。
 */
export const WIDGET_VIEW_FIELDS = Object.freeze([
  'years',
  'grain',
  'size',
  'proj',
  'center',
  'theme',
]);

/**
 * ページ構成を決める。
 *
 * @param {'full'|'widget'} mode
 * @param {{controls?: boolean}} [state]  URL から読んだ状態（`controls` だけ見る）
 * @returns {{controls: boolean, viewFields: readonly string[], mapActions: boolean,
 *   authors: boolean, table: boolean, curation: boolean, download: boolean,
 *   embed: boolean, stats: boolean, openFullTool: boolean}}
 */
export function resolvePanels(mode, state = {}) {
  if (mode !== 'widget') {
    return {
      controls: true,
      viewFields: FULL_VIEW_FIELDS,
      mapActions: true,
      authors: true,
      table: true,
      curation: true,
      download: true,
      embed: true,
      stats: true,
      openFullTool: false,
    };
  }

  const withControls = state.controls === true;
  return {
    controls: withControls,
    viewFields: withControls ? WIDGET_VIEW_FIELDS : [],
    // 地図の下の「Reset map view」は出さない。ドラッグで動かした状態は
    // 上の操作パネルのどれかを触れば描き直されるので、行を 1 本増やす価値が無い
    mapActions: false,
    authors: false,
    table: false,
    curation: false,
    download: false,
    // 折りたたみに入れて出す。読者が枠の中で組んだ地図をそのまま配れるようにする
    embed: withControls,
    stats: false,
    // 出さないものへの導線は 1 本だけ。いまの表示状態を引き継いで飛ばす
    openFullTool: withControls,
  };
}
