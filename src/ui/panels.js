/**
 * どのページにどのパネルを出すかの唯一の判断表。
 *
 * app.js は `if (panels.table)` の形でしかパネルを組まない。**分岐をここ 1 か所に
 * 集める**ことで、DOM を立てずにページ構成をテストで凍結できる（この repo は
 * jsdom を入れていないので、実 DOM で「出た / 出ない」を見る手段が無い）。
 *
 * widget.html は既定では表示専用のまま。`?controls=on` のときだけ、
 * **フルツールと同じことが枠の中で全部できるだけの UI を足す。**
 * 操作パネル（地図の上）と、折りたたみ 3 つ（補正・集計テーブル・埋め込みコード生成）。
 * 折りたたみは既定で閉じているので、閉じているあいだは summary の 1 行しか占めず、
 * 地図とコントロールを押し下げない。
 *
 * **外へ出る導線は持たない。** 以前は「補正と集計テーブルはフルツールで」という
 * リンクを末尾に置いていたが、その 2 つが枠の中に入った時点で、記事を読んでいる
 * 読者を別ページへ飛ばす理由が無くなった。
 *
 * 画像のダウンロードだけは出さない（`#export` の器を widget.html に持たない）。
 * 地図の SVG/PNG は記事本文が担う領域で、枠の中で配る類のものではない。
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
 *   embed: boolean, stats: boolean}}
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
    };
  }

  const withControls = state.controls === true;
  return {
    controls: withControls,
    viewFields: withControls ? WIDGET_VIEW_FIELDS : [],
    // 地図の下の「Reset map view」は出さない。ドラッグで動かした状態は
    // 上の操作パネルのどれかを触れば描き直されるので、行を 1 本増やす価値が無い
    mapActions: false,
    // 以下 3 つはすべて折りたたみの中。閉じているあいだは 1 行しか占めない
    authors: withControls,
    curation: withControls,
    table: withControls,
    // 画像のダウンロードだけは器を持たない（widget.html に #export が無い）
    download: false,
    embed: withControls,
    // 統計の並びは出さない。同じ数字は地図の下の 1 行（#shown）が持っている
    stats: false,
  };
}
