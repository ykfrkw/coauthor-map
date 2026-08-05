/**
 * レビューモードの入口。**このファイルだけが通常のバンドルに入る**。
 *
 * 実体（mode.js とその CSS）は動的 import で別チャンクに分かれていて、
 * `?review=1` が無ければ 1 バイトも読まれない。
 * tests/review-gate.test.js が「main.js から mode.js へ静的に辿れないこと」を見張っている。
 */

/** レビューモードを起こす値。`?review=1` を正とし、いくつか別名を許す */
const TRUTHY = new Set(['1', 'true', 'on', 'yes']);

/**
 * @param {string} [search]  `?review=1` のようなクエリ文字列
 * @returns {boolean}
 */
export function wantsReview(search) {
  try {
    const value = new URLSearchParams(String(search ?? '')).get('review');
    return value !== null && TRUTHY.has(value.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * URL に `review=1` を足す（既にあれば触らない）。
 *
 * 本体は表示状態だけを URL に書き戻す仕様で、`review=` を知らない。
 * そのまま任せると 1 回目の syncUrl でパラメータが落ち、リロードで
 * レビューモードが黙って切れてしまう。mode.js がこれで書き戻す。
 *
 * @param {string} [url]   history.replaceState に渡された URL（省略可）
 * @param {string} base    相対 URL を解決する基準
 * @returns {string}       pathname + search + hash（オリジンは付けない）
 */
export function withReviewParam(url, base) {
  const next = new URL(url ?? base, base);
  if (!next.searchParams.has('review')) next.searchParams.set('review', '1');
  return `${next.pathname}${next.search}${next.hash}`;
}

/**
 * `?review=1` のときだけレビューモードを読み込んで起動する。
 *
 * @param {Object} [options]
 * @param {string} [options.search]           既定は現在の URL のクエリ
 * @param {'index'|'widget'} [options.page]   localStorage のキーを分ける単位
 * @param {() => Object} [options.getState]   書き出しに載せる表示状態
 * @param {() => Promise<Object>} [options.load]  差し替え可能なローダ（テスト用）
 * @returns {Promise<Object|null>}  起動しなかったときは null
 */
export async function startReviewIfRequested(options = {}) {
  const {
    search = globalThis.location?.search ?? '',
    page = 'index',
    getState = () => ({}),
    load = () => import('./mode.js'),
  } = options;

  if (!wantsReview(search)) return null;

  try {
    const module = await load();
    const start = module?.startReviewMode ?? module?.default;
    if (typeof start !== 'function') return null;
    return start({ page, getState });
  } catch (error) {
    // レビューモードが起きなくても本体の表示は壊さない
    console.error('Review mode could not start.', error);
    return null;
  }
}
