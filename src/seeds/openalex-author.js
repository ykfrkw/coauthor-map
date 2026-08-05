/**
 * OpenAlex 著者からの seed 取得。**フォールバック専用**。
 *
 * ORCID も researchmap も空だった人向けの経路だが、名寄せ精度が低い。
 * 実測: ORCID `0000-0003-1317-0220` に OpenAlex 著者レコードが 2 件ぶら下がり、
 * 片方は 1920 年・1972 年の論文まで含む別人が混ざっていた（67 件中およそ 25 件）。
 * そのため返り値は `{ works, warning }` の形にし、警告を必ず添える。
 */

import { normalizeDoi } from '../doi.js';
import {
  requestOpenAlex,
  DEFAULT_MAILTO,
  joinFilterValues,
} from '../openalex.js';
import { normalizeOrcid } from './orcid.js';

const OPENALEX_BASE = 'https://api.openalex.org';

const WORKS_SELECT =
  'id,doi,display_name,title,publication_year,publication_date';

const AUTHORS_SELECT =
  'id,display_name,orcid,works_count,last_known_institutions';

/** UI にそのまま出せる警告文。UI は US 英語 1 言語なので英語で持つ。 */
export const LOW_PRECISION_WARNING =
  'Author search in OpenAlex is imprecise: papers by other people with the same name ' +
  'can be mixed in. Check the list and exclude anything that is not yours.';

/**
 * 候補著者を返す。UI 側で本人を選ばせるために使う。
 * @param {string} name
 * @param {import('../openalex.js').OpenAlexOptions & { perPage?: number }} [options]
 * @returns {Promise<Array<{id:string, display_name:string, orcid:string|null, works_count:number, institutions:string[]}>>}
 */
export async function searchOpenAlexAuthors(name, options = {}) {
  const { mailto = DEFAULT_MAILTO, perPage = 25 } = options;
  const query = String(name ?? '').trim();
  if (!query) return [];

  const url =
    `${OPENALEX_BASE}/authors?per-page=${perPage}` +
    `&select=${AUTHORS_SELECT}` +
    `&mailto=${encodeURIComponent(mailto)}` +
    `&search=${encodeURIComponent(query)}`;
  const payload = await requestOpenAlex(url, options);

  return (payload?.results ?? []).map((raw) => ({
    id: raw?.id,
    display_name: raw?.display_name ?? null,
    orcid: raw?.orcid ?? null,
    works_count: raw?.works_count ?? 0,
    institutions: (raw?.last_known_institutions ?? [])
      .map((institution) => institution?.display_name)
      .filter(Boolean),
  }));
}

/**
 * ORCID から OpenAlex 著者レコードを引く。**複数返ることがある**（重複レコード）。
 * @param {string} orcid
 * @param {import('../openalex.js').OpenAlexOptions} [options]
 * @returns {Promise<any[]>}
 */
export async function findOpenAlexAuthorsByOrcid(orcid, options = {}) {
  const { mailto = DEFAULT_MAILTO } = options;
  const id = normalizeOrcid(orcid);
  if (!id) return [];

  const url =
    `${OPENALEX_BASE}/authors?per-page=50` +
    `&select=${AUTHORS_SELECT}` +
    `&mailto=${encodeURIComponent(mailto)}` +
    `&filter=orcid:${encodeURIComponent(`https://orcid.org/${id}`)}`;
  const payload = await requestOpenAlex(url, options);
  return payload?.results ?? [];
}

/**
 * @param {{ authorId?: string, orcid?: string, name?: string }} spec
 * @param {import('../openalex.js').OpenAlexOptions} [options]
 * @returns {Promise<{ works: import('../types.js').SeedWork[], warning: string, authorIds: string[] }>}
 */
export async function fetchOpenAlexAuthorWorks(spec, options = {}) {
  const { authorId, orcid, name } = spec ?? {};
  const { mailto = DEFAULT_MAILTO, onProgress } = options;

  /** @type {string[]} */
  let authorIds = [];
  if (authorId) {
    authorIds = [authorId];
  } else if (orcid) {
    authorIds = (await findOpenAlexAuthorsByOrcid(orcid, options))
      .map((a) => a.id)
      .filter(Boolean);
  } else if (name) {
    const candidates = await searchOpenAlexAuthors(name, options);
    // 候補が複数ある場合は works_count が最大のものを採る。
    const best = candidates
      .slice()
      .sort((a, b) => b.works_count - a.works_count)[0];
    authorIds = best ? [best.id] : [];
  }

  if (authorIds.length === 0) {
    return { works: [], warning: LOW_PRECISION_WARNING, authorIds: [] };
  }

  /** @type {import('../types.js').SeedWork[]} */
  const works = [];
  const seen = new Set();
  let cursor = '*';
  let page = 0;

  // cursor ページング。安全弁として 20 ページで打ち切る。
  while (cursor && page < 20) {
    const url =
      `${OPENALEX_BASE}/works?per-page=200` +
      `&select=${WORKS_SELECT}` +
      `&mailto=${encodeURIComponent(mailto)}` +
      `&cursor=${encodeURIComponent(cursor)}` +
      `&filter=author.id:${joinFilterValues(authorIds)}`;
    const payload = await requestOpenAlex(url, options);

    for (const raw of payload?.results ?? []) {
      const doi = normalizeDoi(raw?.doi);
      if (doi === null || seen.has(doi)) continue;
      seen.add(doi);
      works.push({
        doi,
        year: Number.isFinite(raw?.publication_year)
          ? raw.publication_year
          : null,
        title: raw?.display_name ?? raw?.title ?? null,
        sources: ['openalex'],
      });
    }

    page += 1;
    onProgress?.(
      'seeds:openalex',
      works.length,
      payload?.meta?.count ?? works.length,
    );
    cursor = payload?.meta?.next_cursor ?? null;
    if (!payload?.results?.length) break;
  }

  return { works, warning: LOW_PRECISION_WARNING, authorIds };
}
