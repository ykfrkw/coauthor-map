/**
 * 表示のための派生計算。
 *
 * 年フィルタはここで完結させる（データ層に取り直しに行かない）。
 * スライダーを動かすたびに OpenAlex を叩くのは論外なので、
 * 全期間の Dataset を一度だけ取り、以降はクライアント側で切り出す。
 *
 * 機関の年フィルタについて: 著者×論文×機関の行は Dataset に残っていないので、
 * 「その年に生き残った共著者の所属」から機関を逆算する。都市に紐づく機関一覧
 * （ツールチップ表示）は年で削らない。削ると seed 本人の所属が消えるため。
 */

/**
 * dev の snapshot は Map が配列に落ちているので、Dataset の形にそろえる。
 * すでに Map ならそのまま返す。
 */
export function normalizeDataset(raw) {
  const toMap = (value) => {
    if (value instanceof Map) return value;
    if (Array.isArray(value)) return new Map(value.map((v) => [v.id, v]));
    if (value && typeof value === 'object')
      return new Map(Object.entries(value));
    return new Map();
  };
  return {
    works: raw.works ?? [],
    coauthors: toMap(raw.coauthors),
    institutions: toMap(raw.institutions),
    cities: raw.cities ?? [],
    stats: raw.stats ?? {},
    warnings: raw.warnings ?? [],
  };
}

/**
 * Curation を、すでに手元にある Dataset へその場で適用する。
 *
 * 除外と統合はローカルで完結するので、データ層に取り直しに行かずに即反映できる。
 * `addDois` だけは新しく論文を取ってくる必要があるので、ここでは扱わない
 * （UI 側が「取り直しが要る」と判断してデータ層を呼ぶ）。
 *
 * @param {Object} dataset  normalizeDataset 済み
 * @param {Object} curation Curation 型
 */
export function applyCuration(dataset, curation) {
  if (!curation) return dataset;
  const dropDoi = new Set(curation.excludeDois ?? []);
  const dropAuthor = new Set(curation.excludeAuthorIds ?? []);
  const dropInstitution = new Set(curation.excludeInstitutionIds ?? []);
  const merges = new Map(Object.entries(curation.mergeInstitutions ?? {}));
  if (
    !dropDoi.size &&
    !dropAuthor.size &&
    !dropInstitution.size &&
    !merges.size
  )
    return dataset;

  /** 統合先をたどる。循環しても止まるように上限を切る */
  const resolveInstitutionId = (id) => {
    let current = id;
    for (let i = 0; i < 8 && merges.has(current); i += 1)
      current = merges.get(current);
    return current;
  };

  const works = dataset.works.filter((w) => !dropDoi.has(w.doi));
  const keptDois = new Set(works.map((w) => w.doi));
  const cities = [];

  for (const city of dataset.cities) {
    const dois = city.dois.filter(
      (d) => !dropDoi.has(d) && (keptDois.has(d) || !dropDoi.size),
    );
    if (!dois.length) continue;
    const cityDois = new Set(dois);

    const coauthors = city.coauthors
      .filter((c) => !dropAuthor.has(c.id))
      .map((c) => ({
        ...c,
        institutionIds: [
          ...new Set(c.institutionIds.map(resolveInstitutionId)),
        ].filter((id) => !dropInstitution.has(id)),
        dois: c.dois.filter((d) => !dropDoi.has(d)),
      }))
      .filter((c) => c.dois.some((d) => cityDois.has(d)));

    const seen = new Set();
    const institutions = [];
    for (const inst of city.institutions) {
      const id = resolveInstitutionId(inst.id);
      if (dropInstitution.has(id) || seen.has(id)) continue;
      seen.add(id);
      institutions.push(
        id === inst.id
          ? inst
          : (dataset.institutions.get(id) ?? { ...inst, id }),
      );
    }

    cities.push({
      ...city,
      dois,
      coauthors,
      institutions,
      paperCount: dois.length,
      coauthorCount: coauthors.length,
    });
  }

  cities.sort(
    (a, b) =>
      b.paperCount - a.paperCount || String(a.key).localeCompare(String(b.key)),
  );

  return { ...dataset, works, cities };
}

/** DOI → 出版年 */
export function buildYearIndex(works) {
  const index = new Map();
  for (const w of works) index.set(w.doi, w.year);
  return index;
}

/**
 * 年で切り出した表示用データを作る。
 *
 * @param {Object} dataset  normalizeDataset 済み
 * @param {{from: number, to: number}} range
 */
export function filterDataset(dataset, range) {
  const yearIndex = buildYearIndex(dataset.works);
  const { from, to } = range;
  // 年が取れていない論文は落とさない（年の欠測で地図から消えるほうが害が大きい）
  const inRange = (doi) => {
    const y = yearIndex.get(doi);
    return y == null || (y >= from && y <= to);
  };

  const works = dataset.works.filter((w) => inRange(w.doi));
  const cities = [];
  const coauthorIds = new Set();
  const institutionIds = new Set();
  const doiSet = new Set();

  for (const city of dataset.cities) {
    const dois = city.dois.filter(inRange);
    if (!dois.length) continue;
    const cityDois = new Set(dois);
    const coauthors = city.coauthors.filter((c) =>
      c.dois.some((d) => cityDois.has(d)),
    );

    // 機関も年で絞る。その期間に生き残った共著者が所属している機関だけ残す。
    // 共著者の地図なので「共著者が誰も紐づかない機関」を数える意味はない
    const liveInstitutionIds = new Set(
      coauthors.flatMap((c) => c.institutionIds),
    );
    const institutions = city.institutions.filter((i) =>
      liveInstitutionIds.has(i.id),
    );

    for (const d of dois) doiSet.add(d);
    for (const c of coauthors) coauthorIds.add(c.id);
    for (const i of institutions) institutionIds.add(i.id);

    cities.push({
      ...city,
      dois,
      coauthors,
      institutions,
      paperCount: dois.length,
      coauthorCount: coauthors.length,
    });
  }

  cities.sort(
    (a, b) =>
      b.paperCount - a.paperCount || String(a.key).localeCompare(String(b.key)),
  );

  const countries = new Set(
    cities.map((c) => c.countryCode || c.country || '—'),
  );

  return {
    range: { from, to },
    works,
    cities,
    yearIndex,
    summary: {
      papers: doiSet.size,
      coauthors: coauthorIds.size,
      institutions: institutionIds.size,
      cities: cities.length,
      countries: countries.size,
    },
  };
}

/** 国別の集計。DOI と著者は必ず和集合で数える */
export function countrySummary(cities) {
  const groups = new Map();
  for (const city of cities) {
    const key = city.country || city.countryCode || '—';
    if (!groups.has(key)) {
      groups.set(key, {
        country: key,
        countryCode: city.countryCode ?? null,
        cities: 0,
        institutions: new Set(),
        coauthors: new Set(),
        dois: new Set(),
      });
    }
    const g = groups.get(key);
    g.cities += 1;
    for (const i of city.institutions) g.institutions.add(i.id);
    for (const c of city.coauthors) g.coauthors.add(c.id);
    for (const d of city.dois) g.dois.add(d);
  }
  return [...groups.values()]
    .map((g) => ({
      country: g.country,
      cities: g.cities,
      institutions: g.institutions.size,
      coauthors: g.coauthors.size,
      papers: g.dois.size,
    }))
    .sort((a, b) => b.papers - a.papers || a.country.localeCompare(b.country));
}

/** 機関別の集計 */
export function institutionSummary(cities) {
  const rows = new Map();
  for (const city of cities) {
    const cityDois = new Set(city.dois);
    for (const inst of city.institutions) {
      if (!rows.has(inst.id)) {
        rows.set(inst.id, {
          institution: inst.name,
          city: city.city ?? '—',
          country: city.country ?? city.countryCode ?? '—',
          coauthors: new Set(),
          dois: new Set(),
        });
      }
      const row = rows.get(inst.id);
      for (const c of city.coauthors) {
        if (!c.institutionIds.includes(inst.id)) continue;
        row.coauthors.add(c.id);
        for (const d of c.dois) if (cityDois.has(d)) row.dois.add(d);
      }
    }
  }
  return [...rows.values()]
    .map((r) => ({
      institution: r.institution,
      city: r.city,
      country: r.country,
      coauthors: r.coauthors.size,
      papers: r.dois.size,
    }))
    .filter((r) => r.coauthors > 0 || r.papers > 0)
    .sort((a, b) => b.papers - a.papers || b.coauthors - a.coauthors);
}

/**
 * 期間別の集計。
 * 新規共著者数 = その年に初めて共著した人の数（選択期間の中での「初めて」）。
 */
export function yearSummary(view) {
  const { works, cities, yearIndex, range } = view;
  const years = [];
  for (let y = range.from; y <= range.to; y += 1) years.push(y);

  const doisByYear = new Map(years.map((y) => [y, new Set()]));
  for (const w of works) {
    if (w.year == null || !doisByYear.has(w.year)) continue;
    doisByYear.get(w.year).add(w.doi);
  }

  // 共著者ごとの初出年
  const firstYear = new Map();
  const seenCoauthor = new Set();
  for (const city of cities) {
    for (const c of city.coauthors) {
      if (seenCoauthor.has(c.id)) continue;
      seenCoauthor.add(c.id);
      let min = null;
      for (const d of c.dois) {
        const y = yearIndex.get(d);
        if (y == null || y < range.from || y > range.to) continue;
        if (min == null || y < min) min = y;
      }
      if (min != null) firstYear.set(c.id, min);
    }
  }

  const newCoauthors = new Map(years.map((y) => [y, 0]));
  for (const y of firstYear.values()) {
    if (newCoauthors.has(y)) newCoauthors.set(y, newCoauthors.get(y) + 1);
  }

  return years
    .map((year) => {
      const dois = doisByYear.get(year);
      const hit = cities.filter((c) => c.dois.some((d) => dois.has(d)));
      const countries = new Set(
        hit.map((c) => c.country || c.countryCode || '—'),
      );
      return {
        year,
        newCoauthors: newCoauthors.get(year) ?? 0,
        countries: countries.size,
        cities: hit.length,
        papers: dois.size,
      };
    })
    .filter((r) => r.papers > 0 || r.cities > 0);
}
