import { describe, expect, it } from 'vitest';

import {
  aggregate,
  applyWorkCuration,
  assignPrimaryAffiliations,
  cityKey,
  detectSeedAuthorIds,
  filterWorksByYear,
  groupInstitutionsIntoCities,
  haversineKm,
  matchesOrcidAffiliation,
  normalizeInstitutionName,
  normalizePinMode,
  pickCityAnchor,
  toInstitution,
  unionSeedWorks,
} from '../src/aggregate.js';
import { normalizeCuration } from '../src/curation.js';
import { loadFixture } from './helpers/stub-fetch.js';

const openAlexWorks = loadFixture('openalex-works-pages.json').flatMap(
  (page) => page.results,
);
const rawInstitutions = loadFixture('openalex-institutions-pages.json').flatMap(
  (page) => page.results,
);
const seedWorks = loadFixture('dataset-snapshot.json').works;

const SEED_ORCID = '0000-0003-1317-0220';

describe('filterWorksByYear', () => {
  const works = [
    { doi: '10.1/a', year: 2018, title: null, sources: ['orcid'] },
    { doi: '10.1/b', year: 2021, title: null, sources: ['orcid'] },
    { doi: '10.1/c', year: 2026, title: null, sources: ['orcid'] },
    { doi: '10.1/d', year: null, title: null, sources: ['manual'] },
  ];

  it('指定が無ければ全件通す（年不明も残す）', () => {
    expect(filterWorksByYear(works)).toHaveLength(4);
  });

  it('yearFrom / yearTo で挟む', () => {
    expect(
      filterWorksByYear(works, { yearFrom: 2020 }).map((w) => w.doi),
    ).toEqual(['10.1/b', '10.1/c']);
    expect(
      filterWorksByYear(works, { yearTo: 2021 }).map((w) => w.doi),
    ).toEqual(['10.1/a', '10.1/b']);
    expect(
      filterWorksByYear(works, { yearFrom: 2020, yearTo: 2021 }).map(
        (w) => w.doi,
      ),
    ).toEqual(['10.1/b']);
  });

  it('フィルタ指定時は年不明を落とす', () => {
    expect(
      filterWorksByYear(works, { yearFrom: 2000 }).map((w) => w.doi),
    ).not.toContain('10.1/d');
  });

  it('元配列を壊さない', () => {
    filterWorksByYear(works, { yearFrom: 2020 });
    expect(works).toHaveLength(4);
  });
});

describe('unionSeedWorks', () => {
  it('DOI で束ね、sources を結合し、year / title は先に埋まった方を残す', () => {
    const union = unionSeedWorks([
      [
        {
          doi: 'https://doi.org/10.1/A',
          year: 2020,
          title: 'from orcid',
          sources: ['orcid'],
        },
      ],
      [
        {
          doi: '10.1/a',
          year: null,
          title: 'from researchmap',
          sources: ['researchmap'],
        },
      ],
      [{ doi: '10.0/z', year: 2019, title: null, sources: ['researchmap'] }],
    ]);
    expect(union).toEqual([
      { doi: '10.0/z', year: 2019, title: null, sources: ['researchmap'] },
      {
        doi: '10.1/a',
        year: 2020,
        title: 'from orcid',
        sources: ['orcid', 'researchmap'],
      },
    ]);
  });
});

describe('applyWorkCuration', () => {
  it('addDois を足してから excludeDois を落とす', () => {
    const base = [
      { doi: '10.1/a', year: 2020, title: 'a', sources: ['orcid'] },
    ];
    const curated = applyWorkCuration(
      base,
      normalizeCuration({
        addDois: ['10.2/b', '10.1/a'],
        excludeDois: ['10.2/b'],
      }),
    );
    // 追加してから同じものを除外 → 残らない。
    expect(curated.map((work) => work.doi)).toEqual(['10.1/a']);
    // 既存 DOI への addDois は sources に manual が足されるだけ。
    expect(curated[0].sources).toEqual(['orcid', 'manual']);
  });
});

describe('detectSeedAuthorIds', () => {
  it('ORCID 一致で seed 本人の著者 ID を拾う（重複レコードも両方）', () => {
    const ids = detectSeedAuthorIds(openAlexWorks, SEED_ORCID);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    for (const id of ids)
      expect(id.startsWith('https://openalex.org/A')).toBe(true);
  });

  it('ORCID が分からなければ最多登場の著者 ID を seed とみなす', () => {
    const fallback = detectSeedAuthorIds(openAlexWorks, null);
    expect(fallback).toHaveLength(1);
    // ORCID 経由で得た ID 群に含まれるはず（本人が最多登場）。
    expect(detectSeedAuthorIds(openAlexWorks, SEED_ORCID)).toContain(
      fallback[0],
    );
  });
});

describe('cityKey', () => {
  it('国コード + 都市名', () => {
    expect(
      cityKey({
        countryCode: 'GB',
        country: 'United Kingdom',
        city: 'Oxford',
        lat: 51.75,
        lng: -1.25,
      }),
    ).toBe('GB|Oxford');
  });

  it('国コードが無ければ国名、それも無ければ ? に落ちる', () => {
    expect(
      cityKey({
        countryCode: null,
        country: 'Japan',
        city: 'Kyoto',
        lat: 35,
        lng: 135,
      }),
    ).toBe('Japan|Kyoto');
    expect(
      cityKey({
        countryCode: null,
        country: null,
        city: 'Kyoto',
        lat: 35,
        lng: 135,
      }),
    ).toBe('?|Kyoto');
  });

  it('都市名が無ければ座標にフォールバックする', () => {
    expect(
      cityKey({
        countryCode: 'JP',
        country: 'Japan',
        city: null,
        lat: 34.69379,
        lng: 135.50107,
      }),
    ).toBe('JP|@34.69,135.50');
  });
});

describe('haversineKm', () => {
  it('同一点は 0', () => {
    expect(haversineKm(35.0, 135.0, 35.0, 135.0)).toBe(0);
  });

  it('Oxford 市内の 2 点は 100km 未満、東京〜京都は 100km 超', () => {
    expect(haversineKm(51.75222, -1.25596, 51.72745, -1.19257)).toBeLessThan(
      100,
    );
    expect(
      haversineKm(35.6895, 139.69171, 35.02107, 135.75385),
    ).toBeGreaterThan(100);
  });
});

/**
 * 座標つきの Institution を組み立てるヘルパ。
 */
function institutionAt(id, city, countryCode, lat, lng) {
  return {
    id: `https://openalex.org/${id}`,
    name: id,
    city,
    countryCode,
    country: 'Japan',
    type: null,
    lat,
    lng,
    ror: null,
  };
}

describe('groupInstitutionsIntoCities', () => {
  it('丸め座標が一致すれば都市名が無くても束ねる', () => {
    const groups = groupInstitutionsIntoCities([
      institutionAt('I1', 'Kyoto', 'JP', 35.02107, 135.75385),
      institutionAt('I2', null, null, 35.021, 135.7538),
    ]);
    expect(groups.size).toBe(1);
  });

  it('都市名が同じで 100km 未満なら束ねる（座標が数 km ずれても同一都市）', () => {
    const groups = groupInstitutionsIntoCities([
      institutionAt('I1', 'Oxford', 'GB', 51.75222, -1.25596),
      institutionAt('I2', 'Oxford', 'GB', 51.72745, -1.19257),
    ]);
    expect(groups.size).toBe(1);
  });

  it('都市名が同じでも 100km 以上離れていれば束ねない（同名異都市）', () => {
    const groups = groupInstitutionsIntoCities([
      institutionAt('I1', 'Cambridge', 'GB', 52.2053, 0.1218),
      institutionAt('I2', 'Cambridge', 'US', 42.3751, -71.10561),
    ]);
    expect(groups.size).toBe(2);
  });

  it('都市名の大小・前後空白の違いは無視する', () => {
    const groups = groupInstitutionsIntoCities([
      institutionAt('I1', 'Oxford', 'GB', 51.75222, -1.25596),
      institutionAt('I2', '  oxford ', 'GB', 51.72745, -1.19257),
    ]);
    expect(groups.size).toBe(1);
  });
});

describe('pickCityAnchor', () => {
  it('最も多くの機関が共有する丸め座標を代表にする', () => {
    const anchor = pickCityAnchor([
      institutionAt('I3', 'Oxford', 'GB', 51.72745, -1.19257),
      institutionAt('I1', 'Oxford', 'GB', 51.75222, -1.25596),
      institutionAt('I2', 'Oxford', 'GB', 51.75223, -1.25597),
    ]);
    expect(anchor.lat).toBe(51.75222);
  });

  it('同数なら機関 ID 最小のバケツを採る', () => {
    const anchor = pickCityAnchor([
      institutionAt('I2', 'X', 'JP', 10.0, 20.0),
      institutionAt('I1', 'X', 'JP', 30.0, 40.0),
    ]);
    expect(anchor.id).toBe('https://openalex.org/I1');
  });
});

describe('toInstitution', () => {
  it('geo から座標・都市・国を取り、ror が無くても壊れない', () => {
    expect(
      toInstitution({
        id: 'https://openalex.org/I1',
        display_name: 'Somewhere',
        country_code: 'JP',
        type: 'education',
        geo: {
          city: 'Tokyo',
          country: 'Japan',
          latitude: 35.1,
          longitude: 139.1,
        },
      }),
    ).toEqual({
      id: 'https://openalex.org/I1',
      name: 'Somewhere',
      countryCode: 'JP',
      type: 'education',
      lat: 35.1,
      lng: 139.1,
      city: 'Tokyo',
      country: 'Japan',
      ror: null,
    });
  });

  it('geo が無ければ座標は null', () => {
    const institution = toInstitution({
      id: 'https://openalex.org/I2',
      display_name: 'No geo',
    });
    expect(institution.lat).toBeNull();
    expect(institution.lng).toBeNull();
  });
});

describe('aggregate', () => {
  it('seed 本人は共著者から除外される', () => {
    const dataset = aggregate({
      seedWorks,
      openAlexWorks,
      institutions: rawInstitutions,
      seedOrcid: SEED_ORCID,
    });
    expect(dataset.seedAuthorIds.length).toBeGreaterThan(0);
    for (const id of dataset.seedAuthorIds)
      expect(dataset.coauthors.has(id)).toBe(false);
    for (const coauthor of dataset.coauthors.values()) {
      expect(coauthor.orcid).not.toBe(`https://orcid.org/${SEED_ORCID}`);
    }
    // 本人を含む authorship 行は stats には残る。
    expect(dataset.stats.authorshipRows).toBe(315);
  });

  it('ORCID を渡さなくても最多登場の著者を seed として除外する', () => {
    const withOrcid = aggregate({
      seedWorks,
      openAlexWorks,
      institutions: rawInstitutions,
      seedOrcid: SEED_ORCID,
    });
    const withoutOrcid = aggregate({
      seedWorks,
      openAlexWorks,
      institutions: rawInstitutions,
      seedOrcid: null,
    });
    expect(withoutOrcid.seedAuthorIds).toHaveLength(1);
    expect(withOrcid.seedAuthorIds).toContain(withoutOrcid.seedAuthorIds[0]);
    // 重複著者レコードの分だけ共著者が 1 人増える。
    expect(withoutOrcid.stats.coauthors).toBeGreaterThanOrEqual(
      withOrcid.stats.coauthors,
    );
  });

  it('座標が無い機関は都市ノードに入らないが stats には数える', () => {
    const stripped = rawInstitutions.map((institution) =>
      institution.id === 'https://openalex.org/I74801974'
        ? {
            ...institution,
            geo: { ...institution.geo, latitude: null, longitude: null },
          }
        : institution,
    );
    const base = aggregate({
      seedWorks,
      openAlexWorks,
      institutions: rawInstitutions,
      seedOrcid: SEED_ORCID,
    });
    const dataset = aggregate({
      seedWorks,
      openAlexWorks,
      institutions: stripped,
      seedOrcid: SEED_ORCID,
    });

    // 機関数は変わらず、geoResolved だけ減る。
    expect(dataset.stats.institutions).toBe(base.stats.institutions);
    expect(dataset.stats.geoResolved).toBe(base.stats.geoResolved - 1);
    // Dataset から辿れる。
    expect(
      dataset.institutions.get('https://openalex.org/I74801974').lat,
    ).toBeNull();
    // 都市ノードには入らない。
    const tokyo = dataset.cities.find((city) => city.key === 'JP|Tokyo');
    expect(tokyo.institutions.map((i) => i.id)).not.toContain(
      'https://openalex.org/I74801974',
    );
    // 都市に載るのは「そこを主所属とする人の主所属機関」だけなので 9 → 8。
    expect(
      base.cities.find((city) => city.key === 'JP|Tokyo').institutions,
    ).toHaveLength(9);
    expect(tokyo.institutions).toHaveLength(8);
  });

  it('paperCount は authorship の行数ではなく相異なる DOI 数', () => {
    const dataset = aggregate({
      seedWorks,
      openAlexWorks,
      institutions: rawInstitutions,
      seedOrcid: SEED_ORCID,
    });
    for (const coauthor of dataset.coauthors.values()) {
      expect(coauthor.paperCount).toBe(coauthor.dois.length);
      expect(new Set(coauthor.dois).size).toBe(coauthor.dois.length);
      expect(new Set(coauthor.institutionIds).size).toBe(
        coauthor.institutionIds.length,
      );
    }
    for (const city of dataset.cities) {
      expect(city.paperCount).toBe(city.dois.length);
      expect(new Set(city.dois).size).toBe(city.dois.length);
    }
  });

  it('countries は都市ノードの国コードの相異なる数（null は数えない）', () => {
    const dataset = aggregate({
      seedWorks,
      openAlexWorks,
      institutions: rawInstitutions,
      seedOrcid: SEED_ORCID,
    });
    const codes = new Set(
      dataset.cities
        .map((city) => city.countryCode)
        .filter((code) => code != null),
    );
    expect(dataset.stats.countries).toBe(codes.size);
    // 主所属で置くようになって 15 → 14（誰の主所属でもない国が消える）。
    expect(dataset.stats.countries).toBe(14);
    // country_code が null の機関はグループ内の他機関から国コードを引き継ぐので、
    // 都市ノード側に null は残らない。
    expect(dataset.cities.every((city) => city.countryCode !== null)).toBe(
      true,
    );
  });

  it('突合できなかった DOI は unmatchedDois に出る', () => {
    const dataset = aggregate({
      seedWorks: [
        ...seedWorks,
        { doi: '10.9999/ghost', year: 2030, title: null, sources: ['manual'] },
      ],
      openAlexWorks,
      institutions: rawInstitutions,
      seedOrcid: SEED_ORCID,
    });
    expect(dataset.stats.seedWorks).toBe(35);
    expect(dataset.stats.matchedWorks).toBe(34);
    expect(dataset.stats.unmatchedDois).toEqual(['10.9999/ghost']);
  });

  it('1 人はちょうど 1 つの主所属を持ち、2 つ以上の都市に現れない', () => {
    const dataset = aggregate({
      seedWorks,
      openAlexWorks,
      institutions: rawInstitutions,
      seedOrcid: SEED_ORCID,
    });

    /** 著者 ID → 現れた都市キー */
    const citiesOf = new Map();
    for (const city of dataset.cities) {
      for (const coauthor of city.coauthors) {
        if (!citiesOf.has(coauthor.id)) citiesOf.set(coauthor.id, new Set());
        citiesOf.get(coauthor.id).add(city.key);
      }
    }
    for (const [id, keys] of citiesOf) {
      expect(`${id}: ${[...keys].join(', ')}`).toBe(`${id}: ${[...keys][0]}`);
      expect(keys.size).toBe(1);
    }

    // 主所属が決まった人は必ずどこかの都市に 1 度だけ出る（座標が取れる限り）。
    const placed = [...dataset.coauthors.values()].filter(
      (c) => c.primaryInstitutionId !== null,
    );
    expect(citiesOf.size).toBe(placed.length);
    for (const coauthor of dataset.coauthors.values()) {
      if (coauthor.primaryInstitutionId === null) {
        expect(coauthor.primaryBy).toBeNull();
        continue;
      }
      expect(['first-listed', 'orcid', 'fallback']).toContain(
        coauthor.primaryBy,
      );
      // 主所属は必ずその人の所属一覧に含まれる。
      expect(coauthor.institutionIds).toContain(coauthor.primaryInstitutionId);
    }
  });

  it('主所属の既知解（先頭に印字された所属で決まる）', () => {
    const dataset = aggregate({
      seedWorks,
      openAlexWorks,
      institutions: rawInstitutions,
      seedOrcid: SEED_ORCID,
    });
    const cityOf = (name) => {
      const coauthor = [...dataset.coauthors.values()].find(
        (c) => c.name === name,
      );
      const city = dataset.cities.find((c) =>
        c.coauthors.some((x) => x.id === coauthor.id),
      );
      return { city: city?.city ?? null, by: coauthor.primaryBy };
    };

    expect(cityOf('Toshi A. Furukawa')).toEqual({
      city: 'Kyoto',
      by: 'first-listed',
    });
    expect(cityOf('Stefan Leucht')).toEqual({
      city: 'Munich',
      by: 'first-listed',
    });
    expect(cityOf('Edoardo G. Ostinelli')).toEqual({
      city: 'Oxford',
      by: 'first-listed',
    });
    expect(cityOf('Orestis Efthimiou')).toEqual({
      city: 'Bern',
      by: 'first-listed',
    });
    expect(cityOf('Masatsugu Sakata')).toEqual({
      city: 'Kyoto',
      by: 'first-listed',
    });
  });

  it('主所属の内訳が既知解と一致する', () => {
    const dataset = aggregate({
      seedWorks,
      openAlexWorks,
      institutions: rawInstitutions,
      seedOrcid: SEED_ORCID,
    });
    // ORCID の所属名を渡していないので orcid は 0。
    expect(dataset.stats.primaryBy).toEqual({
      firstListed: 139,
      orcid: 0,
      fallback: 4,
      none: 2,
    });
    const sum = Object.values(dataset.stats.primaryBy).reduce(
      (a, b) => a + b,
      0,
    );
    expect(sum).toBe(dataset.stats.coauthors);
  });

  it('pin=all（旧来の挙動）では 1 人が複数都市に現れる', () => {
    const dataset = aggregate({
      seedWorks,
      openAlexWorks,
      institutions: rawInstitutions,
      seedOrcid: SEED_ORCID,
      pinMode: 'all',
    });
    const citiesOf = new Map();
    for (const city of dataset.cities) {
      for (const coauthor of city.coauthors) {
        citiesOf.set(coauthor.id, (citiesOf.get(coauthor.id) ?? 0) + 1);
      }
    }
    const multi = [...citiesOf.values()].filter((n) => n > 1);
    expect(multi.length).toBe(55);
    expect(dataset.stats.cities).toBe(69);
    expect(dataset.stats.countries).toBe(15);
  });

  it('決定的: 同じ入力を 3 回まわしても主所属が変わらない', () => {
    const runs = [];
    for (let i = 0; i < 3; i += 1) {
      const dataset = aggregate({
        seedWorks,
        openAlexWorks,
        institutions: rawInstitutions,
        seedOrcid: SEED_ORCID,
      });
      runs.push(
        JSON.stringify(
          [...dataset.coauthors.values()].map((c) => [
            c.id,
            c.primaryInstitutionId,
            c.primaryBy,
          ]),
        ),
      );
    }
    expect(new Set(runs).size).toBe(1);
  });

  it('空 seed でも落ちない', () => {
    const dataset = aggregate({
      seedWorks: [],
      openAlexWorks: [],
      institutions: [],
    });
    expect(dataset.stats.seedWorks).toBe(0);
    expect(dataset.stats.yearMin).toBe(0);
    expect(dataset.cities).toEqual([]);
    expect(dataset.coauthors.size).toBe(0);
  });
});

/**
 * 主所属の決定規則そのものの単体テスト。
 * 実データでは規則 1 がほぼ全部決めてしまうので、規則 2 と 3 はここで凍結する。
 */
describe('assignPrimaryAffiliations', () => {
  const master = new Map([
    [
      'https://openalex.org/I1',
      { id: 'https://openalex.org/I1', name: 'Kyoto University' },
    ],
    [
      'https://openalex.org/I2',
      { id: 'https://openalex.org/I2', name: 'Technical University of Munich' },
    ],
    [
      'https://openalex.org/I3',
      { id: 'https://openalex.org/I3', name: 'The University of Tokyo' },
    ],
  ]);
  const cityKeyByInstitution = new Map([
    ['https://openalex.org/I1', 'JP|Kyoto'],
    ['https://openalex.org/I2', 'DE|Munich'],
    ['https://openalex.org/I3', 'JP|Tokyo'],
  ]);

  /** @param {Object} [over] */
  function person(over = {}) {
    return {
      id: 'https://openalex.org/A1',
      name: 'Someone',
      orcid: null,
      institutionIds: [],
      dois: [],
      paperCount: 0,
      ...over,
    };
  }

  function run(coauthor, events, orcidAffiliations = {}) {
    const counts = assignPrimaryAffiliations({
      coauthors: [coauthor],
      eventsOf: () => events,
      cityKeyByInstitution,
      institutionMaster: master,
      orcidAffiliations,
    });
    return { coauthor, counts };
  }

  it('規則 1: 先頭に来た回数が多い都市を採る', () => {
    const { coauthor } = run(
      person({
        institutionIds: ['https://openalex.org/I1', 'https://openalex.org/I2'],
      }),
      [
        { institutionId: 'https://openalex.org/I1', year: 2020, order: 0 },
        { institutionId: 'https://openalex.org/I1', year: 2021, order: 1 },
        { institutionId: 'https://openalex.org/I2', year: 2026, order: 2 },
      ],
    );
    expect(coauthor.primaryInstitutionId).toBe('https://openalex.org/I1');
    expect(coauthor.primaryBy).toBe('first-listed');
  });

  it('規則 1: 同数なら最も新しい論文のもの', () => {
    const { coauthor } = run(
      person({
        institutionIds: ['https://openalex.org/I1', 'https://openalex.org/I2'],
      }),
      [
        { institutionId: 'https://openalex.org/I1', year: 2019, order: 0 },
        { institutionId: 'https://openalex.org/I2', year: 2026, order: 1 },
      ],
    );
    expect(coauthor.primaryInstitutionId).toBe('https://openalex.org/I2');
    expect(coauthor.primaryBy).toBe('first-listed');
  });

  it('規則 2: 件数も年も同じなら ORCID の所属名で決める', () => {
    const { coauthor } = run(
      person({
        orcid: 'https://orcid.org/0000-0002-1825-0097',
        institutionIds: ['https://openalex.org/I1', 'https://openalex.org/I2'],
      }),
      [
        { institutionId: 'https://openalex.org/I1', year: 2024, order: 0 },
        { institutionId: 'https://openalex.org/I2', year: 2024, order: 1 },
      ],
      { '0000-0002-1825-0097': ['Technical University of Munich'] },
    );
    expect(coauthor.primaryInstitutionId).toBe('https://openalex.org/I2');
    expect(coauthor.primaryBy).toBe('orcid');
  });

  it('規則 2: 所属名が 2 都市に当たるときは決めない（規則 3 に落ちる）', () => {
    const { coauthor } = run(
      person({
        orcid: 'https://orcid.org/0000-0002-1825-0097',
        institutionIds: ['https://openalex.org/I1', 'https://openalex.org/I2'],
      }),
      [
        { institutionId: 'https://openalex.org/I1', year: 2024, order: 0 },
        { institutionId: 'https://openalex.org/I2', year: 2024, order: 1 },
      ],
      {
        '0000-0002-1825-0097': [
          'Kyoto University',
          'Technical University of Munich',
        ],
      },
    );
    expect(coauthor.primaryInstitutionId).toBe('https://openalex.org/I1');
    expect(coauthor.primaryBy).toBe('fallback');
  });

  it('規則 2: OpenAlex の所属が 1 つも無い人は機関マスタ全体から引く', () => {
    const { coauthor } = run(
      person({ orcid: '0000-0002-1825-0097', institutionIds: [] }),
      [],
      { '0000-0002-1825-0097': ['University of Tokyo'] },
    );
    // OpenAlex 側の `The University of Tokyo` と部分一致する。
    expect(coauthor.primaryInstitutionId).toBe('https://openalex.org/I3');
    expect(coauthor.primaryBy).toBe('orcid');
  });

  it('所属も ORCID も無ければ主所属は null（所属不明のまま数える）', () => {
    const { coauthor, counts } = run(person(), []);
    expect(coauthor.primaryInstitutionId).toBeNull();
    expect(coauthor.primaryBy).toBeNull();
    expect(counts.none).toBe(1);
  });

  it('規則 3: 決め手が無ければ機関 ID の昇順で決定的に決める', () => {
    const { coauthor } = run(
      person({
        institutionIds: ['https://openalex.org/I2', 'https://openalex.org/I1'],
      }),
      [
        { institutionId: 'https://openalex.org/I2', year: 2024, order: 0 },
        { institutionId: 'https://openalex.org/I1', year: 2024, order: 1 },
      ],
    );
    expect(coauthor.primaryInstitutionId).toBe('https://openalex.org/I1');
    expect(coauthor.primaryBy).toBe('fallback');
  });
});

describe('機関名の照合', () => {
  it('英数字以外を落として小文字化する', () => {
    expect(normalizeInstitutionName('The University of Tokyo')).toBe(
      'theuniversityoftokyo',
    );
    expect(normalizeInstitutionName(null)).toBe('');
  });

  it('部分一致で拾う（The が付く / 付かないを吸収する）', () => {
    expect(
      matchesOrcidAffiliation('University of Tokyo', [
        'The University of Tokyo',
      ]),
    ).toBe(true);
    expect(
      matchesOrcidAffiliation('Kyoto University', ['University of Bern']),
    ).toBe(false);
  });

  it('短すぎる名前では当たらない（誤爆防止）', () => {
    expect(matchesOrcidAffiliation('MIT', ['MIT'])).toBe(false);
  });
});

describe('normalizePinMode', () => {
  it('既定は primary、all だけ旧来の挙動', () => {
    expect(normalizePinMode(undefined)).toBe('primary');
    expect(normalizePinMode('primary')).toBe('primary');
    expect(normalizePinMode('wat')).toBe('primary');
    expect(normalizePinMode('all')).toBe('all');
  });
});
