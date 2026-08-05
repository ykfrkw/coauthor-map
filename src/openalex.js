/**
 * OpenAlex API クライアント。
 *
 * 方針:
 * - リクエストは**直列**。同時多発させると polite pool でも 429 を踏む
 * - すべてのリクエストに `mailto` を付ける
 * - 429 / 5xx は指数バックオフで最大 3 回リトライ。それ以外の 4xx は即エラー
 * - `filter` の `|` は**エンコードしない**。DOI 個々は `encodeURIComponent` で包む
 */

const OPENALEX_BASE = 'https://api.openalex.org';

/** DOI フィルタの 1 リクエストあたり件数。URL 長と件数のバランスで 25。 */
export const WORKS_BATCH_SIZE = 25;

/** 機関 ID フィルタの 1 リクエストあたり件数。per-page の上限と揃えて 50。 */
export const INSTITUTIONS_BATCH_SIZE = 50;

/** works で取る列。authorships まで取ると 1 件が重いので必要な列だけ絞る。 */
const WORKS_SELECT =
  'id,doi,display_name,title,publication_year,publication_date,authorships';

/** institutions で取る列。`ror` は表示・名寄せの手がかりに使う。 */
const INSTITUTIONS_SELECT = 'id,display_name,country_code,type,geo,ror';

const DEFAULT_MAILTO = 'coauthor-map@example.org';

/**
 * 既定の待機。テストからは `sleepImpl` を差し替えて実時間を消費させない。
 * @param {number} ms
 * @returns {Promise<void>}
 */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @typedef {Object} OpenAlexOptions
 * @property {typeof fetch} [fetchImpl]
 * @property {string} [mailto]
 * @property {(msg: string, done: number, total: number) => void} [onProgress]
 * @property {(ms: number) => Promise<void>} [sleepImpl]
 * @property {number} [maxRetries]
 */

/**
 * 配列を size ごとに切る。
 * @template T
 * @param {T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * `https://openalex.org/I62916508` → `I62916508`。既に短縮形ならそのまま。
 * @param {string} id
 * @returns {string}
 */
export function shortOpenAlexId(id) {
  const raw = String(id ?? '').trim();
  const segment = raw.split('/').filter(Boolean).pop() ?? '';
  return segment;
}

/**
 * `filter` 値を組み立てる。`|` は区切り記号なのでエンコードしない。
 * @param {string[]} values
 * @returns {string}
 */
export function joinFilterValues(values) {
  return values.map((value) => encodeURIComponent(value)).join('|');
}

/**
 * 1 リクエスト。429 / 5xx のみ指数バックオフでリトライする。
 * @param {string} url
 * @param {OpenAlexOptions} [options]
 * @returns {Promise<any>}
 */
export async function requestOpenAlex(url, options = {}) {
  const {
    fetchImpl = fetch,
    sleepImpl = defaultSleep,
    maxRetries = 3,
  } = options;

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      // 500ms → 1s → 2s
      await sleepImpl(500 * 2 ** (attempt - 1));
    }

    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
    });
    if (response.ok) return response.json();

    const status = response.status;
    const retriable = status === 429 || status >= 500;
    if (!retriable) {
      throw new Error(
        `OpenAlex がエラーを返しました（HTTP ${status}）: ${url}`,
      );
    }
    lastError = new Error(
      `OpenAlex がエラーを返しました（HTTP ${status}）: ${url}`,
    );
  }
  throw lastError ?? new Error(`OpenAlex の取得に失敗しました: ${url}`);
}

/**
 * DOI から works を引く。DOI は正規化済み・小文字を渡すこと。
 * 重複を落として昇順に並べてからバッチに切るので、呼び出し順に依存しない。
 * @param {string[]} dois
 * @param {OpenAlexOptions} [options]
 * @returns {Promise<any[]>} OpenAlex work の生オブジェクト配列
 */
export async function fetchWorksByDois(dois, options = {}) {
  const { mailto = DEFAULT_MAILTO, onProgress } = options;
  const targets = [...new Set((dois ?? []).filter(Boolean))].sort();
  if (targets.length === 0) return [];

  const batches = chunk(targets, WORKS_BATCH_SIZE);
  /** @type {any[]} */
  const results = [];

  for (const [index, batch] of batches.entries()) {
    onProgress?.('OpenAlex から論文情報を取得中', index, batches.length);
    const url =
      `${OPENALEX_BASE}/works?per-page=50` +
      `&select=${WORKS_SELECT}` +
      `&mailto=${encodeURIComponent(mailto)}` +
      `&filter=doi:${joinFilterValues(batch)}`;
    const payload = await requestOpenAlex(url, options);
    results.push(...(payload?.results ?? []));
  }
  onProgress?.('OpenAlex から論文情報を取得中', batches.length, batches.length);
  return results;
}

/**
 * 機関 ID から institutions を引く。ID は URL 末尾のセグメントに落として使う。
 * @param {string[]} ids OpenAlex 機関 ID（URL 形式・短縮形どちらでも可）
 * @param {OpenAlexOptions} [options]
 * @returns {Promise<any[]>} OpenAlex institution の生オブジェクト配列
 */
export async function fetchInstitutions(ids, options = {}) {
  const { mailto = DEFAULT_MAILTO, onProgress } = options;
  const targets = [
    ...new Set((ids ?? []).map(shortOpenAlexId).filter(Boolean)),
  ].sort();
  if (targets.length === 0) return [];

  const batches = chunk(targets, INSTITUTIONS_BATCH_SIZE);
  /** @type {any[]} */
  const results = [];

  for (const [index, batch] of batches.entries()) {
    onProgress?.('OpenAlex から機関情報を取得中', index, batches.length);
    const url =
      `${OPENALEX_BASE}/institutions?per-page=50` +
      `&select=${INSTITUTIONS_SELECT}` +
      `&mailto=${encodeURIComponent(mailto)}` +
      `&filter=ids.openalex:${joinFilterValues(batch)}`;
    const payload = await requestOpenAlex(url, options);
    results.push(...(payload?.results ?? []));
  }
  onProgress?.('OpenAlex から機関情報を取得中', batches.length, batches.length);
  return results;
}

export { OPENALEX_BASE, DEFAULT_MAILTO, WORKS_SELECT, INSTITUTIONS_SELECT };
