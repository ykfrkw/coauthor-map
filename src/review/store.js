/**
 * レビューコメントの保存。
 *
 * オーナー専用の内部ツールなのでサーバは無い。localStorage にページ単位で置く。
 * 引き継ぎ用に JSON の書き出し・取り込みも同じ形を通す。
 *
 * 連番は保存しない（削除で穴が空くため）。表示・書き出しの直前に配列の順で振る。
 */

const STORAGE_PREFIX = 'coauthor-map:review:v1:';

/** コメントの種別。既定は design */
export const TAGS = Object.freeze(['bug', 'design', 'copy', 'idea']);
export const DEFAULT_TAG = 'design';

/** キーを持つページ。index.html と widget.html で分ける */
export const PAGES = Object.freeze(['index', 'widget']);
export const DEFAULT_PAGE = 'index';

/** @param {unknown} page */
export function normalizePage(page) {
  return PAGES.includes(page) ? page : DEFAULT_PAGE;
}

/** @param {unknown} page */
export function reviewStorageKey(page) {
  return `${STORAGE_PREFIX}${normalizePage(page)}`;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value) {
  return typeof value === 'string' ? value : '';
}

/** 衝突しない程度の id。crypto が無い環境でも動く */
export function newId() {
  const uuid = globalThis.crypto?.randomUUID;
  if (typeof uuid === 'function') return globalThis.crypto.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 未知のキーを捨て、型を揃える。壊れた行は null を返す（呼び出し側が落とす）。
 * @param {unknown} raw
 * @returns {Object|null}
 */
export function normalizeComment(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = /** @type {Record<string, unknown>} */ (raw);
  const selector = str(source.selector).trim();
  const body = str(source.body);
  const pageX = num(source.pageX, 0);
  const pageY = num(source.pageY, 0);
  // セレクタも座標も本文も無い行は復元しても意味がない
  if (!selector && !body && pageX === 0 && pageY === 0) return null;
  return {
    id: str(source.id).trim() || newId(),
    tag: TAGS.includes(source.tag) ? source.tag : DEFAULT_TAG,
    body,
    selector,
    elementText: str(source.elementText),
    rx: Math.min(1, Math.max(0, num(source.rx, 0.5))),
    ry: Math.min(1, Math.max(0, num(source.ry, 0.5))),
    pageX,
    pageY,
    createdAt: str(source.createdAt) || new Date(0).toISOString(),
    updatedAt: str(source.updatedAt) || str(source.createdAt) || '',
  };
}

/**
 * 保存形（`{version, page, comments}`）でも配列でも受け、コメント配列に揃える。
 * @param {unknown} raw
 * @returns {Object[]}
 */
export function normalizeComments(raw) {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.comments)
      ? raw.comments
      : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const comment = normalizeComment(item);
    if (!comment || seen.has(comment.id)) continue;
    seen.add(comment.id);
    out.push(comment);
  }
  return out;
}

/**
 * 新しいコメントを 1 件つくる。
 * @param {{anchor: Object, tag?: string, body?: string, now?: string}} input
 */
export function createComment({ anchor, tag = DEFAULT_TAG, body = '', now }) {
  const stamp = now ?? new Date().toISOString();
  return {
    id: newId(),
    tag: TAGS.includes(tag) ? tag : DEFAULT_TAG,
    body: str(body),
    selector: str(anchor?.selector),
    elementText: str(anchor?.elementText),
    rx: num(anchor?.rx, 0.5),
    ry: num(anchor?.ry, 0.5),
    pageX: num(anchor?.pageX, 0),
    pageY: num(anchor?.pageY, 0),
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/**
 * localStorage が使えない環境（Safari のプライベート等）では null を返す。
 * @returns {Storage|null}
 */
export function getLocalStorage() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const probe = `${STORAGE_PREFIX}__probe__`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/**
 * @param {string} page
 * @param {Storage|null} [storage]
 * @returns {Object[]}
 */
export function loadComments(page, storage = getLocalStorage()) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(reviewStorageKey(page));
    if (!raw) return [];
    return normalizeComments(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * 保存に失敗しても致命エラーにしない（容量超過・プライベートモード）。
 * @returns {boolean} 保存できたか
 */
export function saveComments(page, comments, storage = getLocalStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(reviewStorageKey(page), exportJson(page, comments));
    return true;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function clearComments(page, storage = getLocalStorage()) {
  if (!storage) return false;
  try {
    storage.removeItem(reviewStorageKey(page));
    return true;
  } catch {
    return false;
  }
}

/**
 * 引き継ぎ用の JSON 文字列。そのままファイルに落とせる形。
 * @param {string} page
 * @param {unknown} comments
 * @returns {string}
 */
export function exportJson(page, comments) {
  return `${JSON.stringify(
    {
      version: 1,
      page: normalizePage(page),
      comments: normalizeComments(comments),
    },
    null,
    2,
  )}\n`;
}

/**
 * 取り込み。文字列でもオブジェクトでも受ける。形が壊れていれば Error。
 * @param {unknown} json
 * @returns {Object[]}
 */
export function importJson(json) {
  let parsed = json;
  if (typeof json === 'string') {
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new Error(
        `Could not parse the review JSON: ${/** @type {Error} */ (error).message}`,
      );
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('The review JSON must be an object or an array.');
  }
  if (!Array.isArray(parsed) && !Array.isArray(parsed.comments)) {
    throw new Error('The review JSON has no comments array.');
  }
  return normalizeComments(parsed);
}

/** 種別ごとの件数。書き出しの見出しに使う */
export function countByTag(comments) {
  const counts = Object.fromEntries(TAGS.map((tag) => [tag, 0]));
  for (const comment of comments ?? []) {
    if (Object.prototype.hasOwnProperty.call(counts, comment?.tag))
      counts[comment.tag] += 1;
  }
  return counts;
}
