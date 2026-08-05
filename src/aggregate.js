/**
 * seed works と OpenAlex のレスポンスを `Dataset` に畳み込む層。
 * ネットワークを触らない純関数。ここが集計仕様の正本で、
 * `tests/fixtures/dataset-snapshot.json` と 1 バイト単位で一致させる。
 */

import { normalizeDoi } from './doi.js';
import { normalizeCuration } from './curation.js';

/**
 * 小数第 n 位に丸める。`toFixed` 経由で丸めの向きを都市キーと揃える。
 * @param {number} value
 * @param {number} digits
 * @returns {number}
 */
function round(value, digits) {
  return Number(value.toFixed(digits));
}

/** 同名都市を同一とみなす距離の上限（km）。 */
export const CITY_MERGE_DISTANCE_KM = 100;

/** 地球の平均半径（km）。 */
const EARTH_RADIUS_KM = 6371;

/**
 * 2 点間の大円距離（km）。都市の同一判定にしか使わないので haversine で十分。
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number}
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * 丸め座標のバケツ名（小数第 2 位）。都市ノードの `key` とは別物。
 * @param {import('./types.js').Institution} institution
 * @returns {string}
 */
function geoBucket(institution) {
  return `${institution.lat.toFixed(2)},${institution.lng.toFixed(2)}`;
}

/**
 * 都市ノードのキー。**グループ確定後**に代表値から組み立てる。
 *
 * 国コードが取れない機関があるので `countryCode → country → '?'` の順に落とす。
 * OpenAlex は `country_code: null` の小規模機関を返すことがあり
 * （Kyoto Min-iren Asukai Hospital / Scientific Research WorkS Peer Support Group）、
 * 国コードだけで束ねると同じ都市が 2 ノードに割れる。
 *
 * @param {{countryCode: string|null, country: string|null, city: string|null, lat: number, lng: number}} group
 * @returns {string}
 */
export function cityKey(group) {
  const scope = group.countryCode ?? group.country ?? '?';
  const name = group.city ?? `@${group.lat.toFixed(2)},${group.lng.toFixed(2)}`;
  return `${scope}|${name}`;
}

/**
 * 都市名の正規化。前後空白を除き大小を無視する。
 * @param {string|null} city
 * @returns {string|null}
 */
function normalizeCityName(city) {
  if (typeof city !== 'string') return null;
  const trimmed = city.trim().toLowerCase();
  return trimmed || null;
}

/**
 * 座標を持つ機関を union-find で都市にまとめる。同一都市の条件は
 * 1. 小数第 2 位に丸めた座標が一致する
 * 2. 都市名が一致し、かつ 2 点間の大円距離が 100km 未満
 *
 * 2 が要る理由: OpenAlex は同じ都市の機関に数 km 違う座標を返すため、丸めだけだと
 * Oxford が 3 ノードに割れる。1 が要る理由: `country_code` も都市名も欠けた機関は
 * 座標でしか束ねられない。距離の上限が要る理由: 同名異都市（各国の Cambridge 等）
 * を誤って束ねないため。
 *
 * @param {import('./types.js').Institution[]} institutions 座標を持つものだけ
 * @returns {Map<string, import('./types.js').Institution[]>} 代表 ID → メンバー
 */
export function groupInstitutionsIntoCities(institutions) {
  /** @type {Map<string, string>} */
  const parent = new Map();
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    // 経路圧縮
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor);
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    // ID の小さい方を代表にして決定的にする。
    if (compareText(rootA, rootB) <= 0) parent.set(rootB, rootA);
    else parent.set(rootA, rootB);
  };

  for (const institution of institutions)
    parent.set(institution.id, institution.id);

  // 条件 1: 丸め座標が一致。
  /** @type {Map<string, string>} */
  const firstOfBucket = new Map();
  for (const institution of institutions) {
    const bucket = geoBucket(institution);
    const seen = firstOfBucket.get(bucket);
    if (seen === undefined) firstOfBucket.set(bucket, institution.id);
    else union(seen, institution.id);
  }

  // 条件 2: 都市名が一致 + 100km 未満。
  /** @type {Map<string, import('./types.js').Institution[]>} */
  const byCityName = new Map();
  for (const institution of institutions) {
    const name = normalizeCityName(institution.city);
    if (name === null) continue;
    if (!byCityName.has(name)) byCityName.set(name, []);
    byCityName.get(name).push(institution);
  }
  for (const members of byCityName.values()) {
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const distance = haversineKm(
          members[i].lat,
          members[i].lng,
          members[j].lat,
          members[j].lng,
        );
        if (distance < CITY_MERGE_DISTANCE_KM)
          union(members[i].id, members[j].id);
      }
    }
  }

  /** @type {Map<string, import('./types.js').Institution[]>} */
  const groups = new Map();
  for (const institution of institutions) {
    const root = find(institution.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(institution);
  }
  return groups;
}

/**
 * グループの代表座標を選ぶ。**論文数では選ばない**。
 * 論文数で選ぶと年フィルタを動かすたびにピンが跳ね、d3 の join が壊れる。
 * 丸め座標を最も多くの機関が共有するバケツを採り、同数なら機関 ID 最小のものにする。
 * @param {import('./types.js').Institution[]} members
 * @returns {import('./types.js').Institution}
 */
export function pickCityAnchor(members) {
  /** @type {Map<string, import('./types.js').Institution[]>} */
  const buckets = new Map();
  for (const institution of members) {
    const bucket = geoBucket(institution);
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(institution);
  }

  let best = null;
  for (const bucketMembers of buckets.values()) {
    const smallestId = bucketMembers.reduce((a, b) =>
      compareText(a.id, b.id) <= 0 ? a : b,
    );
    if (
      best === null ||
      bucketMembers.length > best.size ||
      (bucketMembers.length === best.size &&
        compareText(smallestId.id, best.anchor.id) < 0)
    ) {
      best = { size: bucketMembers.length, anchor: smallestId };
    }
  }
  return best.anchor;
}

/**
 * seed works に年フィルタをかける。**集計後ではなく seed の段階**で使う。
 * 年が不明（`null`）の作品は、フィルタが指定されている場合だけ落とす。
 * @param {import('./types.js').SeedWork[]} works
 * @param {{ yearFrom?: number, yearTo?: number }} [range]
 * @returns {import('./types.js').SeedWork[]}
 */
export function filterWorksByYear(works, range = {}) {
  const { yearFrom, yearTo } = range;
  const hasFrom = Number.isFinite(yearFrom);
  const hasTo = Number.isFinite(yearTo);
  if (!hasFrom && !hasTo) return [...works];

  return works.filter((work) => {
    if (work.year == null) return false;
    if (hasFrom && work.year < /** @type {number} */ (yearFrom)) return false;
    if (hasTo && work.year > /** @type {number} */ (yearTo)) return false;
    return true;
  });
}

/**
 * 複数 seed の SeedWork を DOI で和集合。同じ DOI が複数 seed から来たら
 * `sources` を結合し、`year` / `title` は先に埋まっていた方を優先する。
 * 返りは DOI 昇順。
 * @param {import('./types.js').SeedWork[][]} seedWorkLists
 * @returns {import('./types.js').SeedWork[]}
 */
export function unionSeedWorks(seedWorkLists) {
  /** @type {Map<string, import('./types.js').SeedWork>} */
  const byDoi = new Map();

  for (const list of seedWorkLists) {
    for (const work of list ?? []) {
      const doi = normalizeDoi(work?.doi);
      if (doi === null) continue;

      const existing = byDoi.get(doi);
      if (!existing) {
        byDoi.set(doi, {
          doi,
          year: work.year ?? null,
          title: work.title ?? null,
          sources: [...new Set(work.sources ?? [])],
        });
        continue;
      }
      existing.year = existing.year ?? work.year ?? null;
      existing.title = existing.title ?? work.title ?? null;
      for (const source of work.sources ?? []) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
      }
    }
  }

  return [...byDoi.values()].sort((a, b) =>
    a.doi < b.doi ? -1 : a.doi > b.doi ? 1 : 0,
  );
}

/**
 * curation を seed works に適用する。順序は仕様どおり
 * `addDois` を足す → `excludeDois` を落とす。
 * @param {import('./types.js').SeedWork[]} works
 * @param {import('./types.js').Curation} curation
 * @returns {import('./types.js').SeedWork[]}
 */
export function applyWorkCuration(works, curation) {
  const added = works.map((work) => ({ ...work, sources: [...work.sources] }));
  const known = new Set(added.map((work) => work.doi));

  for (const doi of curation.addDois) {
    if (known.has(doi)) {
      // 既にある DOI なら sources に `manual` を足すだけ。
      const target = added.find((work) => work.doi === doi);
      if (target && !target.sources.includes('manual'))
        target.sources.push('manual');
      continue;
    }
    known.add(doi);
    added.push({ doi, year: null, title: null, sources: ['manual'] });
  }

  const excluded = new Set(curation.excludeDois);
  return added
    .filter((work) => !excluded.has(work.doi))
    .sort((a, b) => (a.doi < b.doi ? -1 : a.doi > b.doi ? 1 : 0));
}

/**
 * OpenAlex の institution 生オブジェクト → `Institution`。
 * @param {any} raw
 * @returns {import('./types.js').Institution}
 */
export function toInstitution(raw) {
  const geo = raw?.geo ?? {};
  const lat = typeof geo.latitude === 'number' ? geo.latitude : null;
  const lng = typeof geo.longitude === 'number' ? geo.longitude : null;
  return {
    id: raw?.id,
    name: raw?.display_name ?? null,
    countryCode: raw?.country_code ?? geo.country_code ?? null,
    type: raw?.type ?? null,
    lat,
    lng,
    city: geo.city ?? null,
    country: geo.country ?? null,
    // ROR は表示・名寄せの手がかり。古い fixture には無いので欠けても壊さない。
    ror: raw?.ror ?? null,
  };
}

/**
 * seed 本人の OpenAlex 著者 ID を決める。
 * ORCID が分かるならそれで一致判定。分からなければ
 * 「最も多くの論文に登場した著者 ID」を seed とみなす（researchmap 単独など）。
 * @param {any[]} matchedWorks OpenAlex work の生オブジェクト
 * @param {string|null} seedOrcid
 * @returns {string[]}
 */
export function detectSeedAuthorIds(matchedWorks, seedOrcid) {
  if (seedOrcid) {
    const target = `https://orcid.org/${String(seedOrcid).trim().toUpperCase()}`;
    /** @type {Set<string>} */
    const ids = new Set();
    for (const work of matchedWorks) {
      for (const authorship of work?.authorships ?? []) {
        const orcid = authorship?.author?.orcid;
        if (
          typeof orcid === 'string' &&
          orcid.toUpperCase() === target.toUpperCase()
        ) {
          if (authorship.author?.id) ids.add(authorship.author.id);
        }
      }
    }
    if (ids.size > 0) return [...ids];
  }

  // フォールバック: 出現論文数が最大の著者。
  /** @type {Map<string, Set<string>>} */
  const worksByAuthor = new Map();
  for (const work of matchedWorks) {
    for (const authorship of work?.authorships ?? []) {
      const id = authorship?.author?.id;
      if (!id) continue;
      if (!worksByAuthor.has(id)) worksByAuthor.set(id, new Set());
      worksByAuthor.get(id).add(work.id ?? work.doi);
    }
  }
  let best = null;
  let bestCount = 0;
  for (const [id, works] of worksByAuthor) {
    if (works.size > bestCount) {
      best = id;
      bestCount = works.size;
    }
  }
  return best ? [best] : [];
}

/**
 * @param {Object} input
 * @param {import('./types.js').SeedWork[]} input.seedWorks
 * @param {any[]} input.openAlexWorks   OpenAlex works の生オブジェクト
 * @param {any[]} input.institutions    OpenAlex institutions の生オブジェクト
 * @param {string|null} [input.seedOrcid]
 * @param {import('./types.js').Curation} [input.curation]
 * @param {string[]} [input.warnings]
 * @returns {import('./types.js').Dataset & { seedAuthorIds: string[] }}
 */
export function aggregate(input) {
  const {
    seedWorks = [],
    openAlexWorks = [],
    institutions: rawInstitutions = [],
    seedOrcid = null,
    warnings = [],
  } = input;
  const curation = normalizeCuration(input.curation);

  // 1. curation を適用した seed works（DOI 昇順）。
  const works = applyWorkCuration(unionSeedWorks([seedWorks]), curation);

  // 2. DOI → OpenAlex work。
  /** @type {Map<string, any>} */
  const worksByDoi = new Map();
  for (const raw of openAlexWorks) {
    const doi = normalizeDoi(raw?.doi);
    if (doi === null || worksByDoi.has(doi)) continue;
    worksByDoi.set(doi, raw);
  }

  const matchedWorks = [];
  const unmatchedDois = [];
  for (const work of works) {
    const raw = worksByDoi.get(work.doi);
    if (raw) {
      matchedWorks.push(raw);
      // 手入力 DOI は year / title が空なので OpenAlex 側で埋める。
      if (work.year == null && Number.isFinite(raw.publication_year)) {
        work.year = raw.publication_year;
      }
      if (work.title == null)
        work.title = raw.display_name ?? raw.title ?? null;
    } else {
      unmatchedDois.push(work.doi);
    }
  }

  // 3. seed 本人の著者 ID。
  const seedAuthorIds = detectSeedAuthorIds(matchedWorks, seedOrcid);
  const seedAuthorIdSet = new Set(seedAuthorIds);
  const seedOrcidUrl = seedOrcid
    ? `https://orcid.org/${String(seedOrcid).trim()}`.toUpperCase()
    : null;

  // 4. 機関マスタ。fetch した順（= ID 昇順）を保つ。
  //    OpenAlex はページ内の並びを保証しないので、ID 昇順に固定して決定的にする。
  /** @type {Map<string, import('./types.js').Institution>} */
  const institutionMaster = new Map();
  const sortedRawInstitutions = [...rawInstitutions]
    .map(toInstitution)
    .filter((institution) => Boolean(institution.id))
    .sort((a, b) => compareText(a.id, b.id));
  for (const institution of sortedRawInstitutions) {
    if (institutionMaster.has(institution.id)) continue;
    institutionMaster.set(institution.id, institution);
  }

  const mergeMap = curation.mergeInstitutions;
  const excludedInstitutionIds = new Set(curation.excludeInstitutionIds);
  const excludedAuthorIds = new Set(curation.excludeAuthorIds);

  // 5. authorship を走査して共著者を積む。works は DOI 昇順なので
  //    `dois` / `institutionIds` の「登場順」も決定的になる。
  /** @type {Map<string, import('./types.js').Coauthor>} */
  const coauthorMap = new Map();
  let authorshipRows = 0;
  let authorshipsWithoutInstitution = 0;

  for (const work of works) {
    const raw = worksByDoi.get(work.doi);
    if (!raw) continue;

    for (const authorship of raw.authorships ?? []) {
      authorshipRows += 1;
      // 「所属が付いていない行」は OpenAlex の生データ基準で数える（curation で
      // 消した分は含めない）。データ品質の指標として UI に出す。
      const rawInstitutionIds = (authorship?.institutions ?? [])
        .map((entry) => entry?.id)
        .filter(Boolean);
      if (rawInstitutionIds.length === 0) authorshipsWithoutInstitution += 1;

      const author = authorship?.author;
      // OpenAlex には `author.id` が null の行がある（ORCID と表示名だけの行）。
      // 落とすと共著者を取りこぼすので、ORCID → 表示名の順でキーを代用する。
      const authorId = author?.id ?? null;
      const mapKey =
        authorId ??
        author?.orcid ??
        (author?.display_name ? `name:${author.display_name}` : null);
      if (mapKey === null) continue;
      // seed 本人は共著者に数えない。ID が無い行は ORCID で照合する。
      if (authorId && seedAuthorIdSet.has(authorId)) continue;
      if (
        seedOrcidUrl &&
        author?.orcid &&
        author.orcid.toUpperCase() === seedOrcidUrl
      )
        continue;
      if (excludedAuthorIds.has(mapKey)) continue;

      let coauthor = coauthorMap.get(mapKey);
      if (!coauthor) {
        coauthor = {
          id: authorId,
          name: author?.display_name ?? null,
          orcid: author?.orcid ?? null,
          institutionIds: [],
          dois: [],
          paperCount: 0,
        };
        coauthorMap.set(mapKey, coauthor);
      }
      if (coauthor.orcid == null && author?.orcid)
        coauthor.orcid = author.orcid;
      if (!coauthor.dois.includes(work.doi)) coauthor.dois.push(work.doi);

      for (const rawId of rawInstitutionIds) {
        const mergedId = mergeMap[rawId] ?? rawId;
        if (excludedInstitutionIds.has(mergedId)) continue;
        if (!coauthor.institutionIds.includes(mergedId))
          coauthor.institutionIds.push(mergedId);
      }
    }
  }

  for (const coauthor of coauthorMap.values()) {
    coauthor.paperCount = coauthor.dois.length;
  }

  // 6. 共著者から実際に参照された機関だけを Dataset に載せる。
  //    （seed 本人しか属していない機関は地図に出さない）
  /** @type {Map<string, import('./types.js').Institution>} */
  const institutions = new Map();
  /** @type {Set<string>} */
  const referenced = new Set();
  for (const coauthor of coauthorMap.values()) {
    for (const id of coauthor.institutionIds) referenced.add(id);
  }
  for (const [id, institution] of institutionMaster) {
    if (referenced.has(id)) institutions.set(id, institution);
  }
  // fetch できなかった機関 ID も欠落させない（名前・座標は不明のまま持つ）。
  for (const id of referenced) {
    if (institutions.has(id)) continue;
    institutions.set(id, {
      id,
      name: null,
      countryCode: null,
      type: null,
      lat: null,
      lng: null,
      city: null,
      country: null,
      ror: null,
    });
  }

  const sortedCoauthors = [...coauthorMap.values()].sort(
    compareByPaperCountThenName,
  );

  // 7. 都市ノード。緯度経度が無い機関は都市に入れない（stats には数える）。
  const cities = buildCities({
    master: institutionMaster,
    institutions,
    coauthors: sortedCoauthors,
    works,
  });

  // 8. 統計。
  const years = works
    .map((work) => work.year)
    .filter((year) => Number.isFinite(year));
  const countries = new Set(
    cities.map((city) => city.countryCode).filter((code) => code != null),
  );

  /** @type {import('./types.js').DatasetStats} */
  const stats = {
    seedWorks: works.length,
    matchedWorks: matchedWorks.length,
    unmatchedDois,
    coauthors: sortedCoauthors.length,
    institutions: institutions.size,
    geoResolved: [...institutions.values()].filter(
      (i) => i.lat != null && i.lng != null,
    ).length,
    cities: cities.length,
    countries: countries.size,
    authorshipRows,
    authorshipsWithoutInstitution,
    coauthorsWithoutInstitution: sortedCoauthors.filter(
      (c) => c.institutionIds.length === 0,
    ).length,
    yearMin: years.length ? Math.min(...years) : 0,
    yearMax: years.length ? Math.max(...years) : 0,
  };

  /** @type {Map<string, import('./types.js').Coauthor>} */
  const coauthors = new Map(
    sortedCoauthors.map((coauthor) => [coauthor.id, coauthor]),
  );

  return {
    works,
    coauthors,
    institutions,
    cities,
    stats,
    warnings: [...warnings],
    seedAuthorIds,
  };
}

/**
 * paperCount 降順 → 名前昇順。
 * @param {{paperCount:number,name:string|null}} a
 * @param {{paperCount:number,name:string|null}} b
 */
function compareByPaperCountThenName(a, b) {
  if (b.paperCount !== a.paperCount) return b.paperCount - a.paperCount;
  return compareText(a.name, b.name);
}

/**
 * @param {string|null} a
 * @param {string|null} b
 */
function compareText(a, b) {
  const left = a ?? '';
  const right = b ?? '';
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * グループ内で最初に見つかる非 null の値。
 * @param {import('./types.js').Institution[]} members
 * @param {'city'|'countryCode'|'country'} field
 * @returns {string|null}
 */
function firstNonNull(members, field) {
  for (const member of members) {
    if (member[field] != null) return member[field];
  }
  return null;
}

/**
 * 機関を都市にまとめて `CityNode[]` にする。
 * グループ分けは fetch できた機関全体（`master`）で行い、ノードに載せる `institutions`
 * だけを「共著者から参照されたもの」に絞る。
 * @param {Object} input
 * @param {Map<string, import('./types.js').Institution>} input.master       fetch できた全機関
 * @param {Map<string, import('./types.js').Institution>} input.institutions 参照された機関だけ
 * @param {import('./types.js').Coauthor[]} input.coauthors  既に paperCount 降順
 * @param {import('./types.js').SeedWork[]} input.works      DOI 昇順
 * @returns {import('./types.js').CityNode[]}
 */
function buildCities({ master, institutions, coauthors, works }) {
  // 緯度経度が無い機関は地図に置けないので都市ノードに入れない（stats には数える）。
  const located = [...master.values()].filter(
    (institution) => institution.lat != null && institution.lng != null,
  );

  /** @type {Map<string, {key:string, lat:number, lng:number, city:string|null, countryCode:string|null, country:string|null, institutionIds:Set<string>}>} */
  const groups = new Map();
  /** @type {Map<string, string>} */
  const cityKeyByInstitution = new Map();

  for (const members of groupInstitutionsIntoCities(located).values()) {
    const anchor = pickCityAnchor(members);
    // 国コード・国名・都市名はグループ内で最初に見つかる非 null の値を採る
    // （`country_code: null` の機関が混ざっても都市が割れないようにするため）。
    const group = {
      key: '',
      lat: round(anchor.lat, 5),
      lng: round(anchor.lng, 5),
      city: firstNonNull(members, 'city'),
      countryCode: firstNonNull(members, 'countryCode'),
      country: firstNonNull(members, 'country'),
      institutionIds: new Set(members.map((institution) => institution.id)),
    };
    group.key = cityKey(group);
    if (groups.has(group.key)) {
      throw new Error(`都市ノードのキーが衝突しました: ${group.key}`);
    }
    groups.set(group.key, group);
    for (const institution of members)
      cityKeyByInstitution.set(institution.id, group.key);
  }

  // 機関 → 相異なる DOI 集合、都市 → 共著者。
  /** @type {Map<string, Set<string>>} */
  const doisByInstitution = new Map();
  /** @type {Map<string, import('./types.js').Coauthor[]>} */
  const coauthorsByCity = new Map();

  for (const coauthor of coauthors) {
    /** @type {Set<string>} */
    const cityKeys = new Set();
    for (const institutionId of coauthor.institutionIds) {
      if (!doisByInstitution.has(institutionId))
        doisByInstitution.set(institutionId, new Set());
      const bucket = doisByInstitution.get(institutionId);
      for (const doi of coauthor.dois) bucket.add(doi);

      const key = cityKeyByInstitution.get(institutionId);
      if (key) cityKeys.add(key);
    }
    for (const key of cityKeys) {
      if (!coauthorsByCity.has(key)) coauthorsByCity.set(key, []);
      // coauthors は既に paperCount 降順 → 名前昇順なので順序を引き継げる。
      coauthorsByCity.get(key).push(coauthor);
    }
  }

  const doiOrder = new Map(works.map((work, index) => [work.doi, index]));

  const cities = [];
  for (const group of groups.values()) {
    const cityCoauthors = coauthorsByCity.get(group.key) ?? [];

    /** @type {Set<string>} */
    const doiSet = new Set();
    for (const coauthor of cityCoauthors) {
      for (const doi of coauthor.dois) doiSet.add(doi);
    }
    // 和集合の並びは works（DOI 昇順）に合わせる。
    const dois = [...doiSet].sort(
      (a, b) => (doiOrder.get(a) ?? 0) - (doiOrder.get(b) ?? 0),
    );

    const cityInstitutions = [...group.institutionIds]
      .map((id) => institutions.get(id))
      .filter(Boolean)
      .sort((a, b) => {
        const countA = doisByInstitution.get(a.id)?.size ?? 0;
        const countB = doisByInstitution.get(b.id)?.size ?? 0;
        if (countB !== countA) return countB - countA;
        return compareText(a.name, b.name);
      });

    // 一度も共著者から参照されなかった都市は地図に出さない。
    if (cityInstitutions.length === 0) continue;

    cities.push({
      key: group.key,
      lat: group.lat,
      lng: group.lng,
      city: group.city,
      countryCode: group.countryCode,
      country: group.country,
      institutions: cityInstitutions,
      coauthors: cityCoauthors,
      dois,
      paperCount: dois.length,
      coauthorCount: cityCoauthors.length,
    });
  }

  cities.sort((a, b) => {
    if (b.paperCount !== a.paperCount) return b.paperCount - a.paperCount;
    if (b.coauthorCount !== a.coauthorCount)
      return b.coauthorCount - a.coauthorCount;
    return compareText(a.key, b.key);
  });
  return cities;
}
