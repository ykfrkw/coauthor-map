/**
 * sessionStorage を使った 24 時間キャッシュ。
 *
 * seed とパラメータからキーを作る。sessionStorage が使えない環境
 * （Safari のプライベートブラウズ、埋め込み iframe の制限など）では
 * **黙って no-op** に落ちる。保存の失敗も致命エラーにしない。
 */

const CACHE_PREFIX = 'coauthor-map:cache:v1:';

/** 既定の有効期限。24 時間。 */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * sessionStorage が実際に読み書きできるか一度だけ試す。
 * @returns {Storage|null}
 */
function getSessionStorage() {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return null;
    const probe = `${CACHE_PREFIX}__probe__`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/**
 * キャッシュが使える環境か。
 * @returns {boolean}
 */
export function isCacheAvailable() {
  return getSessionStorage() !== null;
}

/**
 * seed とパラメータからキーを作る。オブジェクトはキー昇順で直列化して
 * プロパティの並び順に依存しないようにする。
 * @param {unknown} parts
 * @returns {string}
 */
export function makeCacheKey(parts) {
  return `${CACHE_PREFIX}${stableStringify(parts)}`;
}

/**
 * @param {string} key
 * @param {{ ttlMs?: number, now?: number }} [options]
 * @returns {unknown|undefined} 有効な値が無ければ undefined
 */
export function readCache(key, options = {}) {
  const { ttlMs = CACHE_TTL_MS, now = Date.now() } = options;
  const storage = getSessionStorage();
  if (!storage) return undefined;

  try {
    const raw = storage.getItem(key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.savedAt !== 'number') return undefined;
    if (now - entry.savedAt > ttlMs) {
      storage.removeItem(key);
      return undefined;
    }
    return entry.value;
  } catch {
    return undefined;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {{ now?: number }} [options]
 * @returns {boolean} 保存できたか
 */
export function writeCache(key, value, options = {}) {
  const { now = Date.now() } = options;
  const storage = getSessionStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify({ savedAt: now, value }));
    return true;
  } catch {
    // QuotaExceededError 等。キャッシュは無くても動くので握りつぶす。
    return false;
  }
}

/**
 * キャッシュ経由で loader を呼ぶ。ヒットすればネットワークを触らない。
 * @template T
 * @param {unknown} keyParts
 * @param {() => Promise<T>} loader
 * @param {{ enabled?: boolean, ttlMs?: number, now?: number }} [options]
 * @returns {Promise<T>}
 */
export async function withCache(keyParts, loader, options = {}) {
  const { enabled = true } = options;
  if (!enabled) return loader();

  const key = makeCacheKey(keyParts);
  const cached = readCache(key, options);
  if (cached !== undefined) return /** @type {T} */ (cached);

  const value = await loader();
  writeCache(key, value, options);
  return value;
}

/**
 * このアプリのキャッシュだけ消す。
 * @returns {number} 消した件数
 */
export function clearCache() {
  const storage = getSessionStorage();
  if (!storage) return 0;
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    return keys.length;
  } catch {
    return 0;
  }
}

/**
 * キー順を固定した JSON 直列化。
 * @param {unknown} value
 * @returns {string}
 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(/** @type {Record<string, unknown>} */ (value))
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}
