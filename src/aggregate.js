/**
 * seed works と OpenAlex のレスポンスを `Dataset` に畳み込む層。
 * ネットワークを触らない純関数。ここが集計仕様の正本で、
 * `tests/fixtures/dataset-snapshot.json` と 1 バイト単位で一致させる。
 */

import { normalizeDoi } from './doi.js';
import { normalizeName } from './name.js';
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

/**
 * 既定のピン配置。`'primary'` は 1 人を主所属の 1 都市だけに置く。
 * `'all'` は旧来の挙動（所属した全都市に同じ人が現れる）で、URL の `pin=all` 用の逃げ道。
 */
export const DEFAULT_PIN_MODE = 'primary';

/**
 * `pin=` の値を正規化する。既定は `'primary'`。
 * @param {unknown} value
 * @returns {'primary'|'all'}
 */
export function normalizePinMode(value) {
  return value === 'all' ? 'all' : DEFAULT_PIN_MODE;
}

/**
 * 「人が実際に勤めている場所」らしい機関の種別（OpenAlex の `type`）。
 * 主所属を決める前に、候補をこの 2 種別へ絞り込む。
 *
 * なぜ `education` と `healthcare` の 2 つだけか:
 * 研究者が日々出勤して所属先として名乗るのは大学・研究所付属の教育機関か病院で、
 * OpenAlex の `type` でこれに当たるのがこの 2 つしかない。
 *
 * とくに落としたいのが `facility`。オーナーのデータ（145 名）では 12 名が
 * ドイツの研究コンソーシアム本部に紐づいていた:
 *   German Centre for Cardiovascular Research (Berlin)
 *   German Center for Infection Research (Braunschweig)
 *   German Center for Neurodegenerative Diseases (Bonn)
 *   German Center for Diabetes Research (Munich)
 * いずれも資金配分・連携組織の**登記上の本部**であって勤務地ではない。実際には
 * Siafis / Bighelli / Schneider-Thoma / Rodolico / Kim / Priller はミュンヘン工科大学の
 * Leucht 研の人で、地図には Braunschweig 7 名・Berlin 4 名・Bonn 1 名という
 * 実在しない集積が出ていた。
 *
 * `company` / `nonprofit` / `government` / `other` も勤務地であることはあるので
 * 一律には落とさない。この 2 種別が候補に 1 つも無い人は従来どおり全候補で決める
 * （企業研究者が不当に落ちないようにするため）。
 */
export const OCCUPATIONAL_INSTITUTION_TYPES = Object.freeze([
  'education',
  'healthcare',
]);

/**
 * `afftype=` の値を正規化する。既定は有効（`true`）。`afftype=off` だけが無効化。
 * UI には出さない逃げ道で、種別の絞り込みを切って従来の判定に戻すために使う。
 * @param {unknown} value
 * @returns {boolean}
 */
export function normalizeAffiliationTypeMode(value) {
  if (value === false || value === 'off' || value === 'false' || value === '0')
    return false;
  return true;
}

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
 * ORCID を比較用のキーにする。`https://orcid.org/` 接頭辞と大小の揺れを吸収する。
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeOrcid(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw
    .trim()
    .toUpperCase()
    .replace(/^HTTPS?:\/\/(WWW\.)?ORCID\.ORG\//, '');
  return value || null;
}

/**
 * `mergeCoauthors` を 3 値に正規化する。既定は `true`。
 * URL クエリから来る文字列（`'off'` / `'0'` など）も受ける。
 * @param {unknown} value
 * @returns {true|'orcid'|false}
 */
export function normalizeMergeMode(value) {
  if (value === false || value === 'off' || value === 'none') return false;
  if (value === 'false' || value === '0') return false;
  if (value === 'orcid') return 'orcid';
  return true;
}

/** 統合の根拠の強さ。ORCID 一致のほうが強い。 */
const MERGE_REASON_RANK = { orcid: 2, name: 1 };

/**
 * @param {...('orcid'|'name'|null)} reasons
 * @returns {'orcid'|'name'|null}
 */
function strongestReason(...reasons) {
  let best = null;
  for (const reason of reasons) {
    if (!reason) continue;
    if (best === null || MERGE_REASON_RANK[reason] > MERGE_REASON_RANK[best])
      best = reason;
  }
  return best;
}

/**
 * OpenAlex の名寄せが分裂させた共著者レコードを union-find でまとめる。
 *
 * 統合する条件は 2 つ:
 * 1. ORCID が一致する（正規化して比較）。例外なく統合してよい
 * 2. 氏名が一致し、かつ**同一論文に同居せず**、かつ機関を 1 つ以上共有する
 *
 * 2 の「同居していないこと」を先に見るのが肝心。1 本の論文に同じ人物が 2 回出ることは
 * 無いので、同居していれば同姓同名の**別人**だと確定できる。これが唯一の確実な検定で、
 * これを外すと同姓同名を潰してしまう。機関の共有はそのうえでの補強。
 *
 * 代表レコードは論文数が最大のもの。同数なら著者 ID の昇順で最小（決定的にするため）。
 *
 * @param {import('./types.js').Coauthor[]} coauthors 登場順
 * @param {unknown} [mode] `true`（既定）/ `'orcid'` / `false`
 * @returns {{coauthors: import('./types.js').Coauthor[], members: Map<import('./types.js').Coauthor, import('./types.js').Coauthor[]>}}
 * `coauthors` は統合後（並びは代表レコードの登場順）、`members` は統合後 → 元レコード
 * （登場順・代表を含む）。除外を人物単位で効かせるために呼び手が使う。
 */
export function mergeCoauthors(coauthors, mode = true) {
  const merged = normalizeMergeMode(mode);
  if (merged === false || coauthors.length < 2) {
    /** @type {Map<import('./types.js').Coauthor, import('./types.js').Coauthor[]>} */
    const members = new Map();
    const out = coauthors.map((coauthor) => {
      const record = { ...coauthor, mergedIds: [], mergedBy: null };
      members.set(record, [coauthor]);
      return record;
    });
    return { coauthors: out, members };
  }

  const parent = coauthors.map((_, index) => index);
  /** @type {Array<'orcid'|'name'|null>} 根に集約した統合の根拠 */
  const reasons = coauthors.map(() => null);

  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    let cursor = index;
    while (parent[cursor] !== root) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const union = (a, b, why) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) {
      reasons[rootA] = strongestReason(reasons[rootA], why);
      return;
    }
    // 添字の小さい方（＝先に出てきた方）を根にして決定的にする。
    const root = Math.min(rootA, rootB);
    const other = Math.max(rootA, rootB);
    parent[other] = root;
    reasons[root] = strongestReason(reasons[root], reasons[other], why);
  };

  // 条件 1: ORCID 一致。
  /** @type {Map<string, number>} */
  const firstOfOrcid = new Map();
  for (let i = 0; i < coauthors.length; i += 1) {
    const orcid = normalizeOrcid(coauthors[i].orcid);
    if (orcid === null) continue;
    const seen = firstOfOrcid.get(orcid);
    if (seen === undefined) firstOfOrcid.set(orcid, i);
    else union(seen, i, 'orcid');
  }

  // 条件 2: 氏名一致 + 非同居 + 機関の共有。
  if (merged === true) {
    /** @type {Map<string, number[]>} */
    const byName = new Map();
    for (let i = 0; i < coauthors.length; i += 1) {
      const name = normalizeName(coauthors[i].name);
      if (!name) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(i);
    }
    for (const indices of byName.values()) {
      if (indices.length < 2) continue;
      for (let a = 0; a < indices.length; a += 1) {
        for (let b = a + 1; b < indices.length; b += 1) {
          const left = coauthors[indices[a]];
          const right = coauthors[indices[b]];
          // 同居していたら別人と確定。必ず先に落とす。
          const rightDois = new Set(right.dois);
          if (left.dois.some((doi) => rightDois.has(doi))) continue;
          const rightInstitutions = new Set(right.institutionIds);
          const sharesInstitution = left.institutionIds.some((id) =>
            rightInstitutions.has(id),
          );
          if (!sharesInstitution) continue;
          union(indices[a], indices[b], 'name');
        }
      }
    }
  }

  /** @type {Map<number, number[]>} 根 → メンバーの添字（登場順） */
  const groups = new Map();
  for (let i = 0; i < coauthors.length; i += 1) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }

  /** @type {import('./types.js').Coauthor[]} */
  const out = [];
  /** @type {Map<import('./types.js').Coauthor, import('./types.js').Coauthor[]>} */
  const memberMap = new Map();
  for (const [root, indices] of groups) {
    const members = indices.map((index) => coauthors[index]);
    if (members.length === 1) {
      const record = { ...members[0], mergedIds: [], mergedBy: null };
      memberMap.set(record, members);
      out.push(record);
      continue;
    }

    // 代表は論文数が最大のもの。同数なら著者 ID の昇順で最小。
    const anchor = members.reduce((best, candidate) => {
      if (candidate.dois.length !== best.dois.length)
        return candidate.dois.length > best.dois.length ? candidate : best;
      return compareText(candidate.id, best.id) < 0 ? candidate : best;
    });
    const others = members.filter((member) => member !== anchor);

    const dois = uniqueInOrder([
      ...anchor.dois,
      ...others.flatMap((member) => member.dois),
    ]);
    const institutionIds = uniqueInOrder([
      ...anchor.institutionIds,
      ...others.flatMap((member) => member.institutionIds),
    ]);

    const record = {
      ...anchor,
      institutionIds,
      dois,
      paperCount: dois.length,
      mergedIds: others.map((member) => member.id).filter(Boolean),
      mergedBy: reasons[root] ?? null,
    };
    memberMap.set(record, members);
    out.push(record);
  }
  return { coauthors: out, members: memberMap };
}

/**
 * 機関名の照合キー。英数字以外を落として小文字化する。
 * ORCID の所属名（`The University of Tokyo`）と OpenAlex の表示名
 * （`University of Tokyo`）を突き合わせるための正規化。
 * @param {unknown} name
 * @returns {string}
 */
export function normalizeInstitutionName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** 部分一致で拾うには短すぎる名前の下限。`the` だけで当たるのを防ぐ。 */
const MIN_NAME_MATCH_LENGTH = 5;

/**
 * 機関名が ORCID 側の所属名のどれかと一致するか。正規化した部分一致で見る。
 * @param {string|null|undefined} institutionName
 * @param {string[]} orcidNames
 * @returns {boolean}
 */
export function matchesOrcidAffiliation(institutionName, orcidNames) {
  const target = normalizeInstitutionName(institutionName);
  if (target.length < MIN_NAME_MATCH_LENGTH) return false;
  for (const raw of orcidNames ?? []) {
    const candidate = normalizeInstitutionName(raw);
    if (candidate.length < MIN_NAME_MATCH_LENGTH) continue;
    if (target.includes(candidate) || candidate.includes(target)) return true;
  }
  return false;
}

/**
 * イベント（論文 1 本分の所属）から、その論文に印字された所属 ID を印字順で取り出す。
 * 古い呼び出し（`listedIds` を持たないイベント）は先頭 1 件だけとみなす。
 * @param {{institutionId: string, listedIds?: string[]}} event
 * @returns {string[]}
 */
function listedIdsOf(event) {
  const listed = event?.listedIds;
  if (Array.isArray(listed) && listed.length > 0) return listed;
  return event?.institutionId ? [event.institutionId] : [];
}

/**
 * 主所属の候補を「勤務先らしい種別」に絞り込む。
 *
 * 候補にその種別が 1 つも無ければ**何もしない**（`filtered: false` を返す）。
 * 絞り込むときは、論文ごとの「先頭所属」も**許容種別のうち最初に印字されたもの**に
 * 読み替える。先頭がコンソーシアム本部でも、同じ論文に大学が併記されていれば
 * そちらを先頭とみなす、という意味になる。
 *
 * @param {Object} input
 * @param {Array<{institutionId: string, year: number|null, order: number, listedIds?: string[]}>} input.events
 * @param {string[]} input.institutionIds  その人の所属機関 ID（登場順）
 * @param {Map<string, import('./types.js').Institution>} input.institutionMaster
 * @returns {{events: typeof input.events, institutionIds: string[], filtered: boolean}}
 */
function restrictToOccupationalTypes({
  events,
  institutionIds,
  institutionMaster,
}) {
  const allowed = new Set(OCCUPATIONAL_INSTITUTION_TYPES);
  const isAllowed = (id) => allowed.has(institutionMaster.get(id)?.type);

  const candidateIds = uniqueInOrder([
    ...events.flatMap(listedIdsOf),
    ...institutionIds,
  ]);
  if (!candidateIds.some(isAllowed))
    return { events, institutionIds, filtered: false };

  /** @type {typeof events} */
  const restrictedEvents = [];
  for (const event of events) {
    const first = listedIdsOf(event).find(isAllowed);
    if (first === undefined) continue;
    restrictedEvents.push({ ...event, institutionId: first });
  }
  return {
    events: restrictedEvents,
    institutionIds: institutionIds.filter(isAllowed),
    filtered: true,
  };
}

/**
 * 各共著者に**ちょうど 1 つ**の主所属を割り当てる。決定は完全に決定的。
 *
 * まず候補を勤務先らしい種別（`OCCUPATIONAL_INSTITUTION_TYPES`）に絞り込み、
 * そのうえで次の優先順で決める:
 * 1. **論文に印字された先頭の所属**（`authorships[].institutions[0]`）。
 *    その人の論文ごとに先頭所属を取り、最も多く先頭に来た都市を採る。
 *    同数なら最も新しい論文のもの
 * 2. それでも決まらないとき、**ORCID の所属名と一致するもの**
 * 3. なお決まらなければ機関 ID の昇順で決定的に決める
 *
 * 「先頭が主所属」は学術界の慣行で、OpenAlex は論文上の所属の順序を保っている。
 *
 * @param {Object} input
 * @param {import('./types.js').Coauthor[]} input.coauthors  破壊的に書き込む
 * @param {(c: import('./types.js').Coauthor) => Array<{institutionId: string, year: number|null, order: number, listedIds?: string[]}>} input.eventsOf
 *   その人の「論文に印字された所属」の一覧（論文ごと 1 件）。`listedIds` は印字順の全所属
 * @param {Map<string, string>} input.cityKeyByInstitution  機関 ID → 都市キー
 * @param {Map<string, import('./types.js').Institution>} input.institutionMaster
 * @param {Record<string, string[]>} [input.orcidAffiliations]  ORCID → 所属名（過去を含む）
 * @param {boolean} [input.preferOccupationalTypes]  種別で候補を絞るか（既定 true。`afftype=off` で false）
 * @returns {{'first-listed': number, orcid: number, fallback: number, none: number, typeFiltered: number}}
 *   規則ごとの人数と、種別の絞り込みが実際に効いた人数
 */
export function assignPrimaryAffiliations({
  coauthors,
  eventsOf,
  cityKeyByInstitution,
  institutionMaster,
  orcidAffiliations = {},
  preferOccupationalTypes = true,
}) {
  const counts = {
    'first-listed': 0,
    orcid: 0,
    fallback: 0,
    none: 0,
    typeFiltered: 0,
  };
  // 座標が無い機関は都市に属さない。同一機関を 1 つのバケツとして扱う。
  const bucketOf = (institutionId) =>
    cityKeyByInstitution.get(institutionId) ?? `institution:${institutionId}`;

  for (const coauthor of coauthors) {
    const rawEvents = eventsOf(coauthor) ?? [];
    const rawIds = coauthor.institutionIds ?? [];
    const restricted = preferOccupationalTypes
      ? restrictToOccupationalTypes({
          events: rawEvents,
          institutionIds: rawIds,
          institutionMaster,
        })
      : { events: rawEvents, institutionIds: rawIds, filtered: false };

    const decided = decidePrimary({
      coauthor,
      events: restricted.events,
      institutionIds: restricted.institutionIds,
      bucketOf,
      institutionMaster,
      orcidAffiliations,
    });
    coauthor.primaryInstitutionId = decided.institutionId;
    coauthor.primaryBy = decided.by;

    // 「絞り込みが効いた」= 絞らなければ**別の機関**になっていた、と定義する。
    // 候補が減っただけで結論が同じ人まで数えると、施策の効き目が読めなくなる。
    // 絞り込みが起きた人だけ、絞らない場合の結論も出して突き合わせる。
    coauthor.primaryTypeFiltered =
      restricted.filtered &&
      decidePrimary({
        coauthor,
        events: rawEvents,
        institutionIds: rawIds,
        bucketOf,
        institutionMaster,
        orcidAffiliations,
      }).institutionId !== decided.institutionId;

    if (coauthor.primaryTypeFiltered) counts.typeFiltered += 1;
    counts[decided.by ?? 'none'] += 1;
  }
  return counts;
}

/**
 * 1 人分の主所属を決める。`assignPrimaryAffiliations` の本体。
 * 候補（`events` / `institutionIds`）は呼び手が絞り込み済みで渡す。
 * @param {Object} input
 * @returns {{institutionId: string|null, by: 'first-listed'|'orcid'|'fallback'|null}}
 */
function decidePrimary({
  coauthor,
  events,
  institutionIds,
  bucketOf,
  institutionMaster,
  orcidAffiliations,
}) {
  // --- 規則 1: 先頭に印字された所属 ---
  /** @type {Map<string, {count: number, newestYear: number, events: typeof events}>} */
  const buckets = new Map();
  for (const event of events) {
    const key = bucketOf(event.institutionId);
    if (!buckets.has(key))
      buckets.set(key, { count: 0, newestYear: -Infinity, events: [] });
    const bucket = buckets.get(key);
    bucket.count += 1;
    bucket.events.push(event);
    if (Number.isFinite(event.year) && event.year > bucket.newestYear)
      bucket.newestYear = event.year;
  }

  const chosen = pickBucket([...buckets.values()]);
  if (chosen)
    return {
      institutionId: pickInstitution(chosen.events),
      by: 'first-listed',
    };

  // --- 規則 2: ORCID の所属名と突合 ---
  const orcidNames = orcidAffiliations[normalizeOrcid(coauthor.orcid)] ?? [];
  if (orcidNames.length > 0) {
    // OpenAlex 側の所属が 1 つも無い人は、機関マスタ全体から名前で引く。
    const candidateIds =
      events.length > 0
        ? uniqueInOrder(events.map((event) => event.institutionId))
        : institutionIds.length > 0
          ? [...institutionIds]
          : [...institutionMaster.keys()];
    const matched = candidateIds.filter((id) =>
      matchesOrcidAffiliation(institutionMaster.get(id)?.name, orcidNames),
    );
    const matchedBuckets = new Set(matched.map(bucketOf));
    if (matchedBuckets.size === 1) {
      const matchedEvents = events.filter((event) =>
        matched.includes(event.institutionId),
      );
      const institutionId =
        matchedEvents.length > 0
          ? pickInstitution(matchedEvents)
          : [...matched].sort(compareText)[0];
      return { institutionId, by: 'orcid' };
    }
  }

  // --- 規則 3: 機関 ID の昇順 ---
  const fallbackIds =
    events.length > 0
      ? uniqueInOrder(events.map((event) => event.institutionId))
      : [...institutionIds];
  if (fallbackIds.length === 0) return { institutionId: null, by: null };
  return {
    institutionId: [...fallbackIds].sort(compareText)[0],
    by: 'fallback',
  };
}

/**
 * 先頭所属のバケツ（= 都市）を 1 つ選ぶ。件数が最大のもの、同数なら最も新しい論文を
 * 含むもの。どちらでも割れなければ `null`（規則 2 に譲る）。
 * @param {Array<{count: number, newestYear: number, events: Array<{institutionId: string, year: number|null, order: number}>}>} buckets
 */
function pickBucket(buckets) {
  if (buckets.length === 0) return null;
  if (buckets.length === 1) return buckets[0];

  const maxCount = Math.max(...buckets.map((bucket) => bucket.count));
  const top = buckets.filter((bucket) => bucket.count === maxCount);
  if (top.length === 1) return top[0];

  const newest = Math.max(...top.map((bucket) => bucket.newestYear));
  if (!Number.isFinite(newest)) return null;
  const newestTop = top.filter((bucket) => bucket.newestYear === newest);
  return newestTop.length === 1 ? newestTop[0] : null;
}

/**
 * バケツの中から機関を 1 つ選ぶ。先頭に来た回数 → 最新の論文 → 機関 ID 昇順。
 * @param {Array<{institutionId: string, year: number|null, order: number}>} events
 * @returns {string}
 */
function pickInstitution(events) {
  /** @type {Map<string, {count: number, newestYear: number}>} */
  const byId = new Map();
  for (const event of events) {
    if (!byId.has(event.institutionId))
      byId.set(event.institutionId, { count: 0, newestYear: -Infinity });
    const entry = byId.get(event.institutionId);
    entry.count += 1;
    if (Number.isFinite(event.year) && event.year > entry.newestYear)
      entry.newestYear = event.year;
  }
  let best = null;
  for (const [id, entry] of byId) {
    if (
      best === null ||
      entry.count > best.entry.count ||
      (entry.count === best.entry.count &&
        entry.newestYear > best.entry.newestYear) ||
      (entry.count === best.entry.count &&
        entry.newestYear === best.entry.newestYear &&
        compareText(id, best.id) < 0)
    ) {
      best = { id, entry };
    }
  }
  return best.id;
}

/**
 * 重複を落として登場順を保つ。
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueInOrder(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * @param {Object} input
 * @param {import('./types.js').SeedWork[]} input.seedWorks
 * @param {any[]} input.openAlexWorks   OpenAlex works の生オブジェクト
 * @param {any[]} input.institutions    OpenAlex institutions の生オブジェクト
 * @param {string|null} [input.seedOrcid]
 * @param {import('./types.js').Curation} [input.curation]
 * @param {string[]} [input.warnings]
 * @param {true|'orcid'|false} [input.mergeCoauthors] 分裂した著者レコードの統合（既定 true）
 * @param {'primary'|'all'} [input.pinMode] 主所属の 1 都市だけに置くか（既定 `'primary'`）
 * @param {Record<string, string[]>} [input.orcidAffiliations] ORCID → 所属名。主所属の判定に使う
 * @param {boolean} [input.preferOccupationalTypes] 主所属の候補を勤務先らしい種別に絞るか（既定 true）
 * @returns {import('./types.js').Dataset & { seedAuthorIds: string[] }}
 */
export function aggregate(input) {
  const {
    seedWorks = [],
    openAlexWorks = [],
    institutions: rawInstitutions = [],
    seedOrcid = null,
    warnings = [],
    mergeCoauthors: mergeMode = true,
    pinMode = DEFAULT_PIN_MODE,
    orcidAffiliations = {},
    preferOccupationalTypes = true,
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
  /** @type {Map<import('./types.js').Coauthor, string>} レコード → 除外照合用のキー */
  const keyByCoauthor = new Map();
  /**
   * レコード → 「論文に印字された先頭の所属」の一覧（論文ごと 1 件）。
   * 主所属の判定に使う。Coauthor 自体には載せない（Dataset を膨らませないため）。
   * @type {Map<import('./types.js').Coauthor, Array<{institutionId: string, year: number|null, order: number}>>}
   */
  const firstListedByRecord = new Map();
  let authorshipRows = 0;
  let authorshipsWithoutInstitution = 0;

  for (const [workIndex, work] of works.entries()) {
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
      // 除外はここでは効かせない。統合したあとに**人物単位**で落とす
      // （代表 ID を除外したのに吸収されたレコードが別人として残るのを防ぐ）。

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
        keyByCoauthor.set(coauthor, mapKey);
      }
      if (coauthor.orcid == null && author?.orcid)
        coauthor.orcid = author.orcid;
      if (!coauthor.dois.includes(work.doi)) coauthor.dois.push(work.doi);

      // 統合と除外を当てたうえで、論文に印字された順序を保つ。
      const listedIds = uniqueInOrder(
        rawInstitutionIds
          .map((rawId) => mergeMap[rawId] ?? rawId)
          .filter((id) => !excludedInstitutionIds.has(id)),
      );
      for (const id of listedIds) {
        if (!coauthor.institutionIds.includes(id))
          coauthor.institutionIds.push(id);
      }
      if (listedIds.length > 0) {
        if (!firstListedByRecord.has(coauthor))
          firstListedByRecord.set(coauthor, []);
        firstListedByRecord.get(coauthor).push({
          institutionId: listedIds[0],
          // 印字順の全所属。種別で候補を絞るとき「許容種別のうち最初のもの」を
          // 取り直せるように持っておく（絞らないときは使わない）。
          listedIds,
          year: work.year ?? null,
          order: workIndex,
        });
      }
    }
  }

  for (const coauthor of coauthorMap.values()) {
    coauthor.paperCount = coauthor.dois.length;
  }

  // 5.5. OpenAlex の名寄せが分裂させたレコードをまとめる。**論文・機関・都市は
  //      1 つも増減しない**（和集合を取るだけ）。変わるのは共著者の同一性だけ。
  const allRecords = [...coauthorMap.values()];
  const { coauthors: allMerged, members: membersOf } = mergeCoauthors(
    allRecords,
    mergeMode,
  );

  // 除外は統合後の人物単位で効かせる。メンバーのどれか 1 つでも除外されていたら
  // その人物ごと落とす（誤統合を見つけた利用者が代表 1 つ消せば済むように）。
  /** @type {Set<import('./types.js').Coauthor>} */
  const keptRecords = new Set();
  /** @type {import('./types.js').Coauthor[]} */
  const mergedCoauthors = [];
  for (const merged of allMerged) {
    const group = membersOf.get(merged) ?? [];
    if (
      group.some((record) => excludedAuthorIds.has(keyByCoauthor.get(record)))
    )
      continue;
    mergedCoauthors.push(merged);
    for (const record of group) keptRecords.add(record);
  }
  const rawCoauthorList = allRecords.filter((record) =>
    keptRecords.has(record),
  );
  const coauthorsMerged = rawCoauthorList.length - mergedCoauthors.length;

  // 6. 共著者から実際に参照された機関だけを Dataset に載せる。
  //    （seed 本人しか属していない機関は地図に出さない）
  /** @type {Map<string, import('./types.js').Institution>} */
  const institutions = new Map();
  /** @type {Set<string>} */
  const referenced = new Set();
  for (const coauthor of mergedCoauthors) {
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

  const sortedCoauthors = [...mergedCoauthors].sort(
    compareByPaperCountThenName,
  );

  // 6.5. 主所属。**地図の主役は機関ではなく人**なので、1 人につき 1 機関＝1 都市に決める。
  //      都市のまとまりは機関マスタ全体（座標があるもの）から先に作る。
  const { groups: cityGroups, cityKeyByInstitution } =
    buildCityGroups(institutionMaster);
  const primaryCounts = assignPrimaryAffiliations({
    coauthors: sortedCoauthors,
    eventsOf: (coauthor) =>
      (membersOf.get(coauthor) ?? []).flatMap(
        (record) => firstListedByRecord.get(record) ?? [],
      ),
    cityKeyByInstitution,
    institutionMaster,
    orcidAffiliations,
    preferOccupationalTypes,
  });

  // 6.6. ORCID の所属名から引き当てた主所属は、まだ「参照された機関」に入っていない
  //      （OpenAlex 側の所属が 1 つも無い人の分）。ここで拾って地図と表に載せる。
  for (const coauthor of sortedCoauthors) {
    const id = coauthor.primaryInstitutionId;
    if (!id) continue;
    if (!coauthor.institutionIds.includes(id)) coauthor.institutionIds.push(id);
    if (!institutions.has(id) && institutionMaster.has(id))
      institutions.set(id, institutionMaster.get(id));
  }

  // 7. 都市ノード。緯度経度が無い機関は都市に入れない（stats には数える）。
  const mode = normalizePinMode(pinMode);
  const cities =
    mode === 'all'
      ? buildCitiesByAffiliation({
          groups: cityGroups,
          cityKeyByInstitution,
          institutions,
          coauthors: sortedCoauthors,
          records: rawCoauthorList,
          works,
        })
      : buildCitiesByPrimary({
          groups: cityGroups,
          cityKeyByInstitution,
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
    coauthorsMerged,
    institutions: institutions.size,
    geoResolved: [...institutions.values()].filter(
      (i) => i.lat != null && i.lng != null,
    ).length,
    cities: cities.length,
    countries: countries.size,
    authorshipRows,
    authorshipsWithoutInstitution,
    coauthorsWithoutInstitution: sortedCoauthors.filter(
      (c) => c.primaryInstitutionId === null,
    ).length,
    // 主所属をどの規則で決めたかの内訳。集計の質をそのまま出す。
    primaryBy: {
      firstListed: primaryCounts['first-listed'],
      orcid: primaryCounts.orcid,
      fallback: primaryCounts.fallback,
      none: primaryCounts.none,
    },
    // 勤務先らしい種別（education / healthcare）への絞り込みが実際に効いた人数。
    // `afftype=off` なら常に 0。
    primaryTypeFiltered: primaryCounts.typeFiltered,
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
 * 機関を都市にまとめる。**ここは幾何だけ**で、共著者も論文も見ない。
 * 緯度経度が無い機関は地図に置けないので都市に入れない（stats には数える）。
 * @param {Map<string, import('./types.js').Institution>} master fetch できた全機関
 * @returns {{groups: Map<string, Object>, cityKeyByInstitution: Map<string, string>}}
 */
function buildCityGroups(master) {
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
      throw new Error(`Duplicate city node key: ${group.key}`);
    }
    groups.set(group.key, group);
    for (const institution of members)
      cityKeyByInstitution.set(institution.id, group.key);
  }
  return { groups, cityKeyByInstitution };
}

/**
 * 主所属で都市ノードを組む（既定）。**1 人は 1 都市にしか現れない。**
 *
 * `coauthors` はその都市を主所属とする人だけ、`dois` はその人たちの DOI の和集合、
 * `institutions` はその人たちの主所属機関だけ。誰の主所属でもない都市は消える。
 *
 * @param {Object} input
 * @param {Map<string, Object>} input.groups
 * @param {Map<string, string>} input.cityKeyByInstitution
 * @param {Map<string, import('./types.js').Institution>} input.institutions 参照された機関だけ
 * @param {import('./types.js').Coauthor[]} input.coauthors 統合後。既に paperCount 降順
 * @param {import('./types.js').SeedWork[]} input.works DOI 昇順
 * @returns {import('./types.js').CityNode[]}
 */
function buildCitiesByPrimary({
  groups,
  cityKeyByInstitution,
  institutions,
  coauthors,
  works,
}) {
  /** @type {Map<string, import('./types.js').Coauthor[]>} */
  const coauthorsByCity = new Map();
  /** @type {Map<string, Set<string>>} */
  const doisByInstitution = new Map();

  for (const coauthor of coauthors) {
    const institutionId = coauthor.primaryInstitutionId;
    if (!institutionId) continue;
    const key = cityKeyByInstitution.get(institutionId);
    if (!key) continue; // 座標が無い機関は地図に置けない
    if (!coauthorsByCity.has(key)) coauthorsByCity.set(key, []);
    // coauthors は既に paperCount 降順 → 名前昇順なので順序を引き継げる。
    coauthorsByCity.get(key).push(coauthor);

    if (!doisByInstitution.has(institutionId))
      doisByInstitution.set(institutionId, new Set());
    const bucket = doisByInstitution.get(institutionId);
    for (const doi of coauthor.dois) bucket.add(doi);
  }

  const doiOrder = new Map(works.map((work, index) => [work.doi, index]));
  const cities = [];

  for (const group of groups.values()) {
    const cityCoauthors = coauthorsByCity.get(group.key) ?? [];
    // 誰の主所属でもない都市は地図に出さない。
    if (cityCoauthors.length === 0) continue;

    const doiSet = new Set();
    for (const coauthor of cityCoauthors) {
      for (const doi of coauthor.dois) doiSet.add(doi);
    }
    // 和集合の並びは works（DOI 昇順）に合わせる。
    const dois = [...doiSet].sort(
      (a, b) => (doiOrder.get(a) ?? 0) - (doiOrder.get(b) ?? 0),
    );

    const cityInstitutions = uniqueInOrder(
      cityCoauthors.map((coauthor) => coauthor.primaryInstitutionId),
    )
      .map((id) => institutions.get(id))
      .filter(Boolean)
      .sort((a, b) => {
        const countA = doisByInstitution.get(a.id)?.size ?? 0;
        const countB = doisByInstitution.get(b.id)?.size ?? 0;
        if (countB !== countA) return countB - countA;
        return compareText(a.name, b.name);
      });

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

  return sortCities(cities);
}

/**
 * 旧来の都市ノード（`pin=all`）。1 人が所属した全都市に現れる。
 * 主所属の規則を入れる前の挙動をそのまま残してある。
 * @param {Object} input
 * @param {Map<string, Object>} input.groups
 * @param {Map<string, string>} input.cityKeyByInstitution
 * @param {Map<string, import('./types.js').Institution>} input.institutions 参照された機関だけ
 * @param {import('./types.js').Coauthor[]} input.coauthors  統合後。既に paperCount 降順
 * @param {import('./types.js').Coauthor[]} input.records    統合前のレコード（登場順）
 * @param {import('./types.js').SeedWork[]} input.works      DOI 昇順
 * @returns {import('./types.js').CityNode[]}
 */
function buildCitiesByAffiliation({
  groups,
  cityKeyByInstitution,
  institutions,
  coauthors,
  records,
  works,
}) {
  // 機関 → 相異なる DOI 集合、都市 → 相異なる DOI 集合。
  // **統合前のレコード**で数える。統合すると 1 人が複数都市の DOI を持つので、
  // 統合後のレコードで数えると「その都市に居ない論文」が都市に混ざる。
  /** @type {Map<string, Set<string>>} */
  const doisByInstitution = new Map();
  /** @type {Map<string, Set<string>>} */
  const doisByCity = new Map();

  for (const record of records) {
    /** @type {Set<string>} */
    const cityKeys = new Set();
    for (const institutionId of record.institutionIds) {
      if (!doisByInstitution.has(institutionId))
        doisByInstitution.set(institutionId, new Set());
      const bucket = doisByInstitution.get(institutionId);
      for (const doi of record.dois) bucket.add(doi);

      const key = cityKeyByInstitution.get(institutionId);
      if (key) cityKeys.add(key);
    }
    for (const key of cityKeys) {
      if (!doisByCity.has(key)) doisByCity.set(key, new Set());
      const bucket = doisByCity.get(key);
      for (const doi of record.dois) bucket.add(doi);
    }
  }

  // 都市 → 共著者は**統合後**で持つ。同じ人物を 2 回並べないため。
  /** @type {Map<string, import('./types.js').Coauthor[]>} */
  const coauthorsByCity = new Map();
  for (const coauthor of coauthors) {
    /** @type {Set<string>} */
    const cityKeys = new Set();
    for (const institutionId of coauthor.institutionIds) {
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

    const doiSet = doisByCity.get(group.key) ?? new Set();
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

  return sortCities(cities);
}

/**
 * 都市ノードの並び。paperCount 降順 → coauthorCount 降順 → key 昇順。
 * @param {import('./types.js').CityNode[]} cities
 * @returns {import('./types.js').CityNode[]}
 */
function sortCities(cities) {
  cities.sort((a, b) => {
    if (b.paperCount !== a.paperCount) return b.paperCount - a.paperCount;
    if (b.coauthorCount !== a.coauthorCount)
      return b.coauthorCount - a.coauthorCount;
    return compareText(a.key, b.key);
  });
  return cities;
}
