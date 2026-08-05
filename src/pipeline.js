/**
 * seed → OpenAlex → 集計 の一本道。UI 側はこの `buildDataset` だけを呼ぶ。
 * **シグネチャは UI が依存しているので変えないこと。**
 */

import { fetchOrcidWorks, assertValidOrcid } from './seeds/orcid.js';
import { fetchResearchmapWorks } from './seeds/researchmap.js';
import { fetchOpenAlexAuthorWorks } from './seeds/openalex-author.js';
import {
  fetchWorksByDois,
  fetchInstitutions,
  mapWithConcurrency,
  MAX_CONCURRENCY,
} from './openalex.js';
import {
  aggregate,
  unionSeedWorks,
  filterWorksByYear,
  applyWorkCuration,
} from './aggregate.js';
import { normalizeCuration } from './curation.js';
import { withCache } from './cache.js';

/**
 * @param {import('./types.js').BuildOptions} options
 * @returns {Promise<import('./types.js').Dataset>}
 */
export async function buildDataset(options) {
  const {
    seeds = [],
    curation: rawCuration,
    yearFrom,
    yearTo,
    mailto,
    fetchImpl = fetch,
    onProgress,
    useCache = true,
    mergeCoauthors = true,
  } = options ?? {};

  const curation = normalizeCuration(rawCuration);
  const openAlexOptions = {
    fetchImpl,
    mailto,
    onProgress,
    ...pickRetryOptions(options),
  };

  /** @type {string[]} */
  const warnings = [];
  /** @type {import('./types.js').SeedWork[][]} */
  const seedWorkLists = [];

  // 1. seed アダプタ。取得は seed ごとに 24 時間キャッシュする。
  //    seed どうしは独立なので並列に流す（返りは入力順を保つ）。
  //    onProgress の第1引数は**表示用の文字列ではなく安定キー**。文言は UI 側が持つ。
  let seedsDone = 0;
  onProgress?.('seeds', seedsDone, seeds.length);
  const seedResults = await mapWithConcurrency(
    seeds,
    MAX_CONCURRENCY,
    async (seed) => {
      const result = await withCache(
        ['seed', seed.kind, seed.value],
        () =>
          fetchSeed(seed, {
            fetchImpl,
            mailto,
            onProgress,
            ...pickRetryOptions(options),
          }),
        { enabled: useCache },
      );
      seedsDone += 1;
      onProgress?.(`seeds:${seed.kind}`, seedsDone, seeds.length);
      return result;
    },
  );

  // warnings は seed の入力順で積む（完了順で揺れないように）。
  for (const result of seedResults) {
    seedWorkLists.push(result.works);
    for (const warning of result.warnings) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }
  }
  // 取得完了は専用キーを作らず `seeds` の done === total で表す。
  onProgress?.('seeds', seeds.length, seeds.length);

  // 2. DOI の和集合（小文字・正規化済み）。sources は結合される。
  //    年フィルタは**集計後ではなく seed works の段階**でかける。
  const unioned = filterWorksByYear(unionSeedWorks(seedWorkLists), {
    yearFrom,
    yearTo,
  });

  // 3. curation を先に適用しておく。取りに行く DOI を減らすため。
  const seedWorks = applyWorkCuration(unioned, curation);
  if (seedWorks.length === 0) {
    return aggregate({
      seedWorks: [],
      openAlexWorks: [],
      institutions: [],
      seedOrcid: findSeedOrcid(seeds),
      curation,
      warnings,
      mergeCoauthors,
    });
  }

  // 4. OpenAlex works。
  const dois = seedWorks.map((work) => work.doi);
  const openAlexWorks = await withCache(
    ['openalex-works', [...dois].sort()],
    () => fetchWorksByDois(dois, openAlexOptions),
    { enabled: useCache },
  );

  // 5. authorship から機関 ID を集める。curation の統合先も取りに行く。
  const institutionIds = collectInstitutionIds(openAlexWorks, curation);
  const institutions = await withCache(
    ['openalex-institutions', [...institutionIds].sort()],
    () => fetchInstitutions(institutionIds, openAlexOptions),
    { enabled: useCache },
  );

  onProgress?.('aggregate', 1, 1);
  return aggregate({
    seedWorks,
    openAlexWorks,
    institutions,
    seedOrcid: findSeedOrcid(seeds),
    curation,
    warnings,
    mergeCoauthors,
  });
}

/**
 * seed 1 件を取得する。openalex 経路だけ警告が付く。
 * @param {import('./types.js').SeedSpec} seed
 * @param {Object} options
 * @returns {Promise<{ works: import('./types.js').SeedWork[], warnings: string[] }>}
 */
async function fetchSeed(seed, options) {
  switch (seed.kind) {
    case 'orcid':
      return {
        works: await fetchOrcidWorks(seed.value, options),
        warnings: [],
      };
    case 'researchmap':
      return {
        works: await fetchResearchmapWorks(seed.value, options),
        warnings: [],
      };
    case 'openalex': {
      // ORCID も researchmap も空だった人向けのフォールバック。名寄せ精度が低い。
      const spec = seed.value?.startsWith('https://openalex.org/')
        ? { authorId: seed.value }
        : { name: seed.value };
      const { works, warning } = await fetchOpenAlexAuthorWorks(spec, options);
      return { works, warnings: warning ? [warning] : [] };
    }
    default:
      throw new Error(`Unknown seed kind: ${String(seed.kind)}`);
  }
}

/**
 * seed に ORCID があれば seed 本人の判定に使う。
 * @param {import('./types.js').SeedSpec[]} seeds
 * @returns {string|null}
 */
function findSeedOrcid(seeds) {
  for (const seed of seeds ?? []) {
    if (seed.kind !== 'orcid') continue;
    try {
      return assertValidOrcid(seed.value);
    } catch {
      // 形式が不正な seed は取得段階で落ちているのでここには来ない想定。
    }
  }
  return null;
}

/**
 * @param {any[]} openAlexWorks
 * @param {import('./types.js').Curation} curation
 * @returns {string[]}
 */
function collectInstitutionIds(openAlexWorks, curation) {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const work of openAlexWorks ?? []) {
    for (const authorship of work?.authorships ?? []) {
      for (const institution of authorship?.institutions ?? []) {
        if (institution?.id) ids.add(institution.id);
      }
    }
  }
  // 統合先の機関が authorship に一度も出てこない場合も引けるようにする。
  for (const target of Object.values(curation.mergeInstitutions))
    ids.add(target);
  return [...ids];
}

/**
 * リトライ制御はテストから差し替えたいので、来ていればそのまま渡す。
 * @param {any} options
 */
function pickRetryOptions(options) {
  const picked = {};
  if (options?.sleepImpl) picked.sleepImpl = options.sleepImpl;
  if (options?.maxRetries != null) picked.maxRetries = options.maxRetries;
  return picked;
}
