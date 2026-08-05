/**
 * DOI の正規化。seed ごとに表記ゆれ（`https://doi.org/` 接頭辞・大文字・前後の空白）が
 * あるため、突合・和集合・除外リストの照合はすべてこの関数を通した値で行う。
 */

/** 剥がす接頭辞。小文字化した**後**に前方一致で比較する。 */
const DOI_PREFIXES = [
  'https://doi.org/',
  'http://doi.org/',
  'https://dx.doi.org/',
  'http://dx.doi.org/',
  'doi:',
];

/**
 * trim → 小文字 → 接頭辞剥がし。空文字・非文字列は `null` を返す。
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeDoi(raw) {
  if (typeof raw !== 'string') return null;
  let doi = raw.trim().toLowerCase();
  if (!doi) return null;

  // `doi:https://doi.org/10.x/y` のような二重接頭辞も剥がせるよう繰り返す。
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const prefix of DOI_PREFIXES) {
      if (doi.startsWith(prefix)) {
        doi = doi.slice(prefix.length).trim();
        stripped = true;
      }
    }
  }
  return doi || null;
}

/**
 * DOI らしさの緩い判定。`10.` で始まりスラッシュを含むものだけ通す。
 * seed 側に混ざる ISBN・URL を落とすために使う。
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isDoiLike(raw) {
  const doi = normalizeDoi(raw);
  return doi !== null && doi.startsWith('10.') && doi.includes('/');
}

/**
 * 正規化しつつ重複を落とす。登場順は保つ。
 * @param {Iterable<unknown>} values
 * @returns {string[]}
 */
export function uniqueDois(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const doi = normalizeDoi(value);
    if (doi === null || seen.has(doi)) continue;
    seen.add(doi);
    out.push(doi);
  }
  return out;
}
