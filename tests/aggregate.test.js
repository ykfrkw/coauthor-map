import { describe, expect, it } from 'vitest';

import {
  aggregate,
  applyWorkCuration,
  cityKey,
  detectSeedAuthorIds,
  filterWorksByYear,
  groupInstitutionsIntoCities,
  haversineKm,
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
    expect(tokyo.institutions).toHaveLength(14);
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
    expect(dataset.stats.countries).toBe(15);
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
