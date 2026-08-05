/**
 * ORCID public API の seed アダプタ。
 * `GET https://pub.orcid.org/v3.0/{orcid}/works` は認証不要・CORS 全開。
 */

import { normalizeDoi } from '../doi.js';

const ORCID_BASE = 'https://pub.orcid.org/v3.0';

/** `0000-0000-0000-000X`。末尾のみ数字または X。 */
const ORCID_PATTERN = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

/**
 * URL 形式（`https://orcid.org/0000-...`）で渡された場合も ID 部分に寄せる。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeOrcid(value) {
  const raw = String(value ?? '').trim();
  const withoutHost = raw.replace(/^https?:\/\/(www\.)?orcid\.org\//i, '');
  return withoutHost.toUpperCase();
}

/**
 * 形式が不正なら明示的に投げる。UI が握って表示できるよう Error のまま返す。
 * @param {unknown} value
 * @returns {string} 正規化済み ORCID
 */
export function assertValidOrcid(value) {
  const orcid = normalizeOrcid(value);
  if (!ORCID_PATTERN.test(orcid)) {
    throw new Error(
      `That is not a valid ORCID iD: "${String(value ?? '')}" (expected 0000-0000-0000-000X).`,
    );
  }
  return orcid;
}

/**
 * @param {string} orcid
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<import('../types.js').SeedWork[]>}
 */
export async function fetchOrcidWorks(orcid, options = {}) {
  const { fetchImpl = fetch } = options;
  const id = assertValidOrcid(orcid);

  const response = await fetchImpl(`${ORCID_BASE}/${id}/works`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(
      `Could not fetch from ORCID (HTTP ${response.status}): ${id}`,
    );
  }
  const payload = await response.json();
  return parseOrcidWorks(payload);
}

/**
 * レスポンス本体 → SeedWork[]。ネットワークを触らないのでテストから直接呼べる。
 * @param {any} payload
 * @returns {import('../types.js').SeedWork[]}
 */
export function parseOrcidWorks(payload) {
  const groups = Array.isArray(payload?.group) ? payload.group : [];
  const works = [];
  const seen = new Set();

  for (const group of groups) {
    const summary = group?.['work-summary']?.[0];
    if (!summary) continue;

    // group 直下の external-ids が空の版もあるので work-summary 側も見る。
    const doi =
      pickDoi(group?.['external-ids']?.['external-id']) ??
      pickDoi(summary?.['external-ids']?.['external-id']);
    if (doi === null || seen.has(doi)) continue;
    seen.add(doi);

    const rawYear = summary?.['publication-date']?.year?.value;
    const year = rawYear == null ? null : Number.parseInt(String(rawYear), 10);

    works.push({
      doi,
      year: Number.isFinite(year) ? year : null,
      title: summary?.title?.title?.value ?? null,
      sources: ['orcid'],
    });
  }
  return works;
}

/**
 * `external-id[]` から `external-id-type === 'doi'` の最初の値を取る。
 * @param {any} externalIds
 * @returns {string|null}
 */
function pickDoi(externalIds) {
  if (!Array.isArray(externalIds)) return null;
  for (const entry of externalIds) {
    if (entry?.['external-id-type'] !== 'doi') continue;
    const doi = normalizeDoi(
      entry?.['external-id-normalized']?.value ?? entry?.['external-id-value'],
    );
    if (doi !== null) return doi;
  }
  return null;
}
