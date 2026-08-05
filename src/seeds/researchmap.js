/**
 * researchmap API の seed アダプタ。
 * `GET https://api.researchmap.jp/{permalink}/published_papers` は認証不要・CORS 全開。
 *
 * 注意: `limit` を省くと既定 25 件で黙って打ち切られる。必ず明示する。
 */

import { normalizeDoi } from '../doi.js';

const RESEARCHMAP_BASE = 'https://api.researchmap.jp';

/** 1 リクエストあたりの取得件数。API 側の上限に合わせる。 */
export const RESEARCHMAP_PAGE_SIZE = 200;

/**
 * @param {string} permalink researchmap の permalink（`yk_frkw`）
 * @param {{ fetchImpl?: typeof fetch, pageSize?: number, maxPages?: number }} [options]
 * @returns {Promise<import('../types.js').SeedWork[]>}
 */
export async function fetchResearchmapWorks(permalink, options = {}) {
  const {
    fetchImpl = fetch,
    pageSize = RESEARCHMAP_PAGE_SIZE,
    maxPages = 20,
  } = options;
  const id = assertValidPermalink(permalink);

  /** @type {any[]} */
  const items = [];
  let start = 1;
  let totalItems = null;

  for (let page = 0; page < maxPages; page += 1) {
    const url = `${RESEARCHMAP_BASE}/${encodeURIComponent(id)}/published_papers?limit=${pageSize}&start=${start}`;
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(
        `Could not fetch from researchmap (HTTP ${response.status}): ${id}`,
      );
    }
    const payload = await response.json();
    const pageItems = Array.isArray(payload?.items) ? payload.items : [];
    items.push(...pageItems);

    const reported = Number.parseInt(String(payload?.total_items ?? ''), 10);
    if (Number.isFinite(reported)) totalItems = reported;

    // 空ページで打ち切り（total_items が信用できない場合の保険）。
    if (pageItems.length === 0) break;
    if (totalItems !== null && items.length >= totalItems) break;
    start += pageItems.length;
  }

  return parseResearchmapItems(items);
}

/**
 * @param {any[]} items
 * @returns {import('../types.js').SeedWork[]}
 */
export function parseResearchmapItems(items) {
  const works = [];
  const seen = new Set();

  for (const item of items ?? []) {
    // identifiers.doi は**配列**。最初の有効な DOI を採る。
    const doi = pickFirstDoi(item?.identifiers?.doi);
    if (doi === null || seen.has(doi)) continue;
    seen.add(doi);

    works.push({
      doi,
      year: parsePublicationYear(item?.publication_date),
      title: pickLocalizedText(item?.paper_title),
      sources: ['researchmap'],
    });
  }
  return works;
}

/**
 * `YYYY` / `YYYY-MM` / `YYYY-MM-DD` のいずれか。先頭 4 桁だけを見る。
 * @param {unknown} value
 * @returns {number|null}
 */
export function parsePublicationYear(value) {
  const match = String(value ?? '').match(/^(\d{4})/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  return Number.isFinite(year) ? year : null;
}

/**
 * `{en?, ja?}` の多言語オブジェクト。en を優先し、無ければ ja、最後に任意の値。
 * 文字列がそのまま来る版にも耐える。
 * @param {unknown} value
 * @returns {string|null}
 */
export function pickLocalizedText(value) {
  if (typeof value === 'string') return value || null;
  if (!value || typeof value !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  const candidates = [record.en, record.ja, ...Object.values(record)];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function pickFirstDoi(value) {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  for (const entry of list) {
    const doi = normalizeDoi(entry);
    if (doi !== null) return doi;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function assertValidPermalink(value) {
  const permalink = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(permalink)) {
    throw new Error(
      `That is not a valid researchmap permalink: "${String(value ?? '')}"`,
    );
  }
  return permalink;
}
