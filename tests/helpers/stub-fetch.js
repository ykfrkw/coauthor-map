/**
 * テスト用の `fetchImpl` スタブ。**ネットワークは一切使わない。**
 * fixture を URL のパターンで振り分けて返すだけ。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixtureDir = fileURLToPath(new URL('../fixtures/', import.meta.url));

/**
 * @param {string} name
 * @returns {any}
 */
export function loadFixture(name) {
  return JSON.parse(readFileSync(`${fixtureDir}${name}`, 'utf8'));
}

/**
 * 200 OK の Response もどき。`ok` / `status` / `json()` だけ実装する。
 * @param {unknown} body
 * @param {number} [status]
 */
export function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/**
 * ORCID + researchmap + OpenAlex をまとめて捌くスタブ。
 *
 * OpenAlex はバッチごとに fixture のページを順に返す（fixture のページ順は
 * DOI 昇順・機関 ID 昇順のバッチと一致している）。
 *
 * @param {Object} [overrides]
 * @param {any} [overrides.orcid]
 * @param {any} [overrides.researchmap]
 * @param {any[]} [overrides.works]
 * @param {any[]} [overrides.institutions]
 * @param {any[]} [overrides.orcidAffiliations]  expanded-search の応答。全ページを
 *   1 つの索引に畳んでから、**実際に問い合わせられた ORCID の分だけ**返す
 *   （本物の API と同じ挙動。呼ぶ側がバッチの切り方を変えても答えが動かない）
 * @returns {{ fetchImpl: typeof fetch, calls: string[] }}
 */
export function createFixtureFetch(overrides = {}) {
  const orcid = overrides.orcid ?? loadFixture('orcid-works.json');
  const researchmap =
    overrides.researchmap ?? loadFixture('researchmap-published-papers.json');
  const workPages = overrides.works ?? loadFixture('openalex-works-pages.json');
  const institutionPages =
    overrides.institutions ?? loadFixture('openalex-institutions-pages.json');
  const affiliationPages =
    overrides.orcidAffiliations ??
    loadFixture('orcid-expanded-search-pages.json');

  // ORCID → expanded-result の 1 件。ページの切れ目は畳んで持つ。
  /** @type {Map<string, any>} */
  const affiliationIndex = new Map();
  for (const page of affiliationPages) {
    for (const entry of page?.['expanded-result'] ?? []) {
      const id = String(entry?.['orcid-id'] ?? '').toUpperCase();
      if (id) affiliationIndex.set(id, entry);
    }
  }

  /** @type {string[]} */
  const calls = [];
  let workPageIndex = 0;
  let institutionPageIndex = 0;

  const fetchImpl = async (url) => {
    const target = String(url);
    calls.push(target);

    // 所属の一括検索は works より先に振り分ける（同じホストなので順序が効く）。
    if (target.startsWith('https://pub.orcid.org/v3.0/expanded-search')) {
      // `q=orcid:(A OR B ...)` から問い合わせ対象を取り出し、その分だけ返す。
      const query = new URL(target).searchParams.get('q') ?? '';
      const requested = query
        .replace(/^orcid:\(|\)$/g, '')
        .split(' OR ')
        .map((id) => id.trim().toUpperCase())
        .filter(Boolean);
      const results = requested
        .map((id) => affiliationIndex.get(id))
        .filter(Boolean);
      return jsonResponse({
        'expanded-result': results,
        'num-found': results.length,
      });
    }
    if (target.startsWith('https://pub.orcid.org/')) {
      return jsonResponse(orcid);
    }
    if (target.startsWith('https://api.researchmap.jp/')) {
      return jsonResponse(researchmap);
    }
    if (target.includes('api.openalex.org/works')) {
      const page = workPages[workPageIndex] ?? { results: [] };
      workPageIndex += 1;
      return jsonResponse(page);
    }
    if (target.includes('api.openalex.org/institutions')) {
      const page = institutionPages[institutionPageIndex] ?? { results: [] };
      institutionPageIndex += 1;
      return jsonResponse(page);
    }
    return jsonResponse({ error: 'unexpected url' }, 404);
  };

  return { fetchImpl: /** @type {any} */ (fetchImpl), calls };
}

/**
 * `Dataset` を snapshot（JSON）と比べられる形に落とす。
 * `Map` は値の配列に開く。
 * @param {any} dataset
 * @returns {any}
 */
export function serializeDataset(dataset) {
  return JSON.parse(
    JSON.stringify({
      works: dataset.works,
      coauthors: [...dataset.coauthors.values()],
      institutions: [...dataset.institutions.values()],
      cities: dataset.cities,
      stats: dataset.stats,
      warnings: dataset.warnings,
    }),
  );
}

/**
 * fixture が `ror` 列を持たない世代なので、比較の前に落とす。
 * （`select` には `ror` を入れてあるが fixture の再取得は親が別途行う）
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function stripRor(value) {
  if (Array.isArray(value)) return /** @type {any} */ (value.map(stripRor));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'ror') continue;
      out[key] = stripRor(entry);
    }
    return /** @type {any} */ (out);
  }
  return value;
}
