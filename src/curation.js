/**
 * `Curation`（手動の除外・追加・統合）の読み書き。
 *
 * 3 つの供給元がある:
 * - `public/curation/<orcid>.json`  … リポジトリに commit した確定版
 * - localStorage                     … 本人がブラウザで編集中の下書き
 * - JSON 取り込み                    … 書き出したファイルを読み戻したもの
 *
 * どれも同じ形に正規化してから `mergeCurations` で重ねる。
 */

import { normalizeDoi } from './doi.js';

const STORAGE_PREFIX = 'coauthor-map:curation:v1:';

/** `Curation` の全キー。取り込み時はこれ以外を捨てる。 */
const ARRAY_KEYS = [
  'excludeDois',
  'excludeAuthorIds',
  'excludeInstitutionIds',
  'addDois',
];

/**
 * @returns {import('./types.js').Curation}
 */
export function emptyCuration() {
  return {
    excludeDois: [],
    excludeAuthorIds: [],
    excludeInstitutionIds: [],
    addDois: [],
    mergeInstitutions: {},
  };
}

/**
 * 未知のキーを捨て、型を揃える。DOI は正規化する。
 * @param {unknown} raw
 * @returns {import('./types.js').Curation}
 */
export function normalizeCuration(raw) {
  const curation = emptyCuration();
  if (!raw || typeof raw !== 'object') return curation;
  const source = /** @type {Record<string, unknown>} */ (raw);

  for (const key of ARRAY_KEYS) {
    const values = source[key];
    if (!Array.isArray(values)) continue;
    const isDoiKey = key === 'excludeDois' || key === 'addDois';
    const seen = new Set();
    for (const value of values) {
      const normalized = isDoiKey ? normalizeDoi(value) : normalizeId(value);
      if (normalized === null || seen.has(normalized)) continue;
      seen.add(normalized);
      curation[key].push(normalized);
    }
  }

  const merge = source.mergeInstitutions;
  if (merge && typeof merge === 'object' && !Array.isArray(merge)) {
    for (const [from, to] of Object.entries(
      /** @type {Record<string, unknown>} */ (merge),
    )) {
      const fromId = normalizeId(from);
      const toId = normalizeId(to);
      if (fromId === null || toId === null || fromId === toId) continue;
      curation.mergeInstitutions[fromId] = toId;
    }
  }
  return curation;
}

/**
 * 複数の `Curation` を重ねる。配列は登場順で結合して重複を落とし、
 * `mergeInstitutions` は後勝ち。
 * @param {...unknown} curations
 * @returns {import('./types.js').Curation}
 */
export function mergeCurations(...curations) {
  const merged = emptyCuration();
  for (const raw of curations) {
    const curation = normalizeCuration(raw);
    for (const key of ARRAY_KEYS) {
      for (const value of curation[key]) {
        if (!merged[key].includes(value)) merged[key].push(value);
      }
    }
    Object.assign(merged.mergeInstitutions, curation.mergeInstitutions);
  }
  return merged;
}

/**
 * リポジトリに commit 済みの確定版を読む。**404 は空の Curation**（エラーにしない）。
 * @param {string} orcid
 * @param {{ fetchImpl?: typeof fetch, baseUrl?: string }} [options]
 * @returns {Promise<import('./types.js').Curation>}
 */
export async function loadCommittedCuration(orcid, options = {}) {
  const { fetchImpl = fetch, baseUrl = './curation/' } = options;
  const id = String(orcid ?? '').trim();
  if (!id) return emptyCuration();

  const url = `${baseUrl}${encodeURIComponent(id)}.json`;
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return emptyCuration();
    return normalizeCuration(await response.json());
  } catch {
    // 静的ホスティングでは 404 がネットワークエラーとして飛んでくることがある。
    return emptyCuration();
  }
}

/**
 * localStorage のキー。seed 単位で分ける。
 * @param {string} seedKey  例 `orcid:0000-0003-1317-0220`
 * @returns {string}
 */
export function curationStorageKey(seedKey) {
  return `${STORAGE_PREFIX}${seedKey}`;
}

/**
 * @param {string} seedKey
 * @returns {import('./types.js').Curation}
 */
export function loadLocalCuration(seedKey) {
  const storage = getLocalStorage();
  if (!storage) return emptyCuration();
  try {
    const raw = storage.getItem(curationStorageKey(seedKey));
    if (!raw) return emptyCuration();
    return normalizeCuration(JSON.parse(raw));
  } catch {
    return emptyCuration();
  }
}

/**
 * 保存に失敗しても致命エラーにしない（プライベートモード・容量超過）。
 * @param {string} seedKey
 * @param {unknown} curation
 * @returns {boolean} 保存できたか
 */
export function saveLocalCuration(seedKey, curation) {
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    storage.setItem(
      curationStorageKey(seedKey),
      JSON.stringify(normalizeCuration(curation)),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} seedKey
 * @returns {boolean}
 */
export function clearLocalCuration(seedKey) {
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    storage.removeItem(curationStorageKey(seedKey));
    return true;
  } catch {
    return false;
  }
}

/**
 * 書き出し。整形済み JSON 文字列を返す（そのままファイル保存できる形）。
 * @param {unknown} curation
 * @returns {string}
 */
export function exportCuration(curation) {
  return `${JSON.stringify(normalizeCuration(curation), null, 2)}\n`;
}

/**
 * 取り込み。文字列でもオブジェクトでも受ける。形が壊れていれば Error。
 * @param {unknown} json
 * @returns {import('./types.js').Curation}
 */
export function importCuration(json) {
  let parsed = json;
  if (typeof json === 'string') {
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new Error(
        `curation JSON を解釈できません: ${/** @type {Error} */ (error).message}`,
      );
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('curation JSON はオブジェクトである必要があります');
  }
  return normalizeCuration(parsed);
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * localStorage が使えない環境（Safari のプライベート等）では null を返す。
 * @returns {Storage|null}
 */
function getLocalStorage() {
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
