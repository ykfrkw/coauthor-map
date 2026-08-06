/**
 * 地図の下に出す状態表示の文言。
 *
 * 「Showing 26 of 138 co-authors」だけでは、**何で絞った結果なのか**も
 * **丸の大きさが何に比例するのか**も伝わらない。ウィジェットからは凡例を外したので、
 * 丸の基準を知る手掛かりが画面から消えていた。実際に「丸の大きさ = 人数」と
 * 誤読されている（3 名・14 本の都市が 2 番目に大きい丸になり、25 名・13 本の都市より
 * 大きく見えた）。基準はこの 1 行で補う。
 *
 * 描画には触らない純粋関数にしてある。状態ごとの文面は
 * tests/status-line.test.js が固定しているので、文言を変えるとテストが落ちる。
 */

/** 丸の基準の文言キー。uniform は基準そのものが無いので出さない */
const BASIS_KEYS = {
  papers: 'shown.basisPapers',
  coauthors: 'shown.basisCoauthors',
};

/** 1 以上の整数に丸める。URL 由来の壊れた値をそのまま画面に出さないため */
function toCount(value, min = 0) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > min ? n : min;
}

/**
 * 状態表示の 1 行を組む。
 *
 * 出す順は「丸の基準 → 何で絞ったか + 表示中 / 全体 → 手で隠した人数 → 年」。
 * どの状態でも「表示中 / 全体」の関係は必ず残す。
 *
 * @param {Object} opts
 * @param {number} opts.shown              いま地図に出ている共著者数
 * @param {number} opts.total              絞り込み前の共著者総数
 * @param {number} [opts.minPapers]        共著論文数の下限（1 = 絞っていない）
 * @param {number} [opts.hiddenCount]      手で外した共著者の数
 * @param {'papers'|'coauthors'|'uniform'} [opts.sizeMode]  丸の大きさの基準
 * @param {boolean} [opts.includeSizeBasis] 基準を文中に含めるか（凡例があるページでは false）
 * @param {{from: number, to: number}|null} [opts.years]    年を添えるときだけ渡す
 * @param {(k: string, p?: Object) => string} t
 * @returns {string}
 */
export function shownStatusText(opts, t) {
  const {
    shown = 0,
    total = 0,
    minPapers = 1,
    hiddenCount = 0,
    sizeMode = 'papers',
    includeSizeBasis = false,
    years = null,
  } = opts ?? {};

  const parts = [];

  const basisKey = BASIS_KEYS[sizeMode];
  if (includeSizeBasis && basisKey) parts.push(t(basisKey));

  const min = toCount(minPapers, 1);
  const counts = { shown: toCount(shown), total: toCount(total) };
  parts.push(
    min > 1 ? t('shown.min', { n: min, ...counts }) : t('shown.all', counts),
  );

  const hidden = toCount(hiddenCount);
  if (hidden > 0) {
    parts.push(
      hidden === 1 ? t('shown.hiddenOne') : t('shown.hidden', { n: hidden }),
    );
  }

  // `Number(null)` は 0 で通ってしまうので、null / undefined を先に落とす
  const hasYears =
    years?.from != null &&
    years?.to != null &&
    Number.isFinite(Number(years.from)) &&
    Number.isFinite(Number(years.to));
  if (hasYears)
    parts.push(t('shown.years', { from: years.from, to: years.to }));

  return parts.join(' ');
}

export { BASIS_KEYS };
