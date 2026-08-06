/**
 * 主所属を決める前に候補を「勤務先らしい種別」へ絞り込む規則の既知解テスト。
 *
 * 動機は実測。145 名のうち 12 名がドイツの研究コンソーシアム本部
 * （German Centre for Cardiovascular Research / German Center for Infection Research /
 * German Center for Neurodegenerative Diseases / German Center for Diabetes Research、
 * いずれも OpenAlex の `type` は `facility`）に紐づき、地図に Braunschweig 7 名・
 * Berlin 4 名・Bonn 1 名という**実在しない集積**が出ていた。実際には Siafis /
 * Bighelli / Schneider-Thoma / Rodolico / Kim / Priller はミュンヘン工科大学の
 * Leucht 研の人である。
 *
 * ここで凍結するのは 3 つ:
 *   1. 絞り込みが効くのは「非 education/healthcare が主所属なのに education/healthcare の
 *      所属も持っている」人。実測で 17 名いたのが 0 名になる
 *   2. 絞り込みは論文数・共著者数・機関数を動かさない。動くのは都市への割り当てだけ
 *   3. education/healthcare を 1 つも持たない人（企業研究者など）には暴発しない
 */
import { describe, expect, it } from 'vitest';

import { buildDataset } from '../src/pipeline.js';
import {
  assignPrimaryAffiliations,
  normalizeAffiliationTypeMode,
  OCCUPATIONAL_INSTITUTION_TYPES,
} from '../src/aggregate.js';
import { createFixtureFetch } from './helpers/stub-fetch.js';

const SEEDS = [
  { kind: 'orcid', value: '0000-0003-1317-0220' },
  { kind: 'researchmap', value: 'yk_frkw' },
];

/** @param {Object} [options] */
async function build(options = {}) {
  const { fetchImpl } = createFixtureFetch();
  return buildDataset({
    seeds: SEEDS,
    mailto: 'test@example.org',
    fetchImpl,
    useCache: false,
    ...options,
  });
}

const on = await build();
const off = await build({ preferOccupationalTypes: false });

const OCCUPATIONAL = new Set(OCCUPATIONAL_INSTITUTION_TYPES);

/**
 * 「主所属が勤務先らしい種別でないのに、本人はその種別の所属も持っている」人。
 * これがこの施策で潰したかった状態そのもの。
 * @param {any} dataset
 */
function misplaced(dataset) {
  return [...dataset.coauthors.values()].filter((coauthor) => {
    const primary = dataset.institutions.get(coauthor.primaryInstitutionId);
    if (!primary || OCCUPATIONAL.has(primary.type)) return false;
    return coauthor.institutionIds.some((id) =>
      OCCUPATIONAL.has(dataset.institutions.get(id)?.type),
    );
  });
}

/** @param {any} dataset */
function cityOf(dataset, name) {
  const coauthor = [...dataset.coauthors.values()].find((c) => c.name === name);
  const city = dataset.cities.find((c) =>
    c.coauthors.some((x) => x.id === coauthor.id),
  );
  return {
    institution: dataset.institutions.get(coauthor.primaryInstitutionId)?.name,
    city: city?.city ?? null,
  };
}

describe('主所属の種別優先（既定 ON）', () => {
  it('絞り込み前に 17 名いた「勤務地でない主所属」が 0 名になる', () => {
    expect(misplaced(off)).toHaveLength(17);
    expect(misplaced(on)).toHaveLength(0);
  });

  it('絞り込みで主所属が変わったのは 18 名', () => {
    // 17 名の内訳に加えて、Yuki Furukawa（著者 ID A5122791740・ORCID 無しの分裂
    // レコード）が University of Tokyo Hospital(healthcare) から
    // Technical University of Munich(education) に移る。この人は絞り込み前から
    // healthcare が主所属なので上の 17 名には入らないが、コンソーシアム本部の
    // 先頭所属が候補から落ちた結果として都市が変わる。
    expect(on.stats.primaryTypeFiltered).toBe(18);
    const flagged = [...on.coauthors.values()].filter(
      (c) => c.primaryTypeFiltered,
    );
    expect(flagged).toHaveLength(18);
    // フラグが立った人の主所属は必ず勤務先らしい種別になっている。
    for (const coauthor of flagged) {
      const primary = on.institutions.get(coauthor.primaryInstitutionId);
      expect(OCCUPATIONAL.has(primary.type)).toBe(true);
    }
  });

  it('Leucht 研の面々がミュンヘン工科大学に戻る', () => {
    for (const name of [
      'Spyridon Siafis',
      'Irene Bighelli',
      'Johannes Schneider-Thoma',
      'Josef Priller',
    ]) {
      expect(cityOf(on, name)).toEqual({
        institution: 'Technical University of Munich',
        city: 'Munich',
      });
    }
  });

  it('コンソーシアム本部の都市が地図から消える', () => {
    const before = new Set(off.cities.map((city) => city.key));
    const after = new Set(on.cities.map((city) => city.key));

    // 増えた都市は無い（人は動くだけで、行き先はもともとある都市）。
    expect([...after].filter((key) => !before.has(key))).toEqual([]);
    // DE|Berlin も残らない。Berlin にいたのは DZHK（facility）を主所属にしていた
    // 4 名だけで、Charité(healthcare) を持つ Josef Priller も Munich に移るため。
    expect([...before].filter((key) => !after.has(key)).sort()).toEqual([
      'DE|Berlin',
      'DE|Bonn',
      'DE|Braunschweig',
      'US|Orangeburg',
    ]);
    expect(off.stats.cities).toBe(47);
    expect(on.stats.cities).toBe(43);
    // 国は減らない（いずれもドイツ・米国に別の都市が残る）。
    expect(on.stats.countries).toBe(14);
    expect(off.stats.countries).toBe(14);
  });

  it('論文・共著者・機関の数は動かない（動くのは都市への割り当てだけ）', () => {
    for (const key of [
      'seedWorks',
      'matchedWorks',
      'coauthors',
      'coauthorsMerged',
      'institutions',
      'geoResolved',
      'authorshipRows',
      'authorshipsWithoutInstitution',
      'coauthorsWithoutInstitution',
    ]) {
      expect(on.stats[key]).toBe(off.stats[key]);
    }
    expect(on.stats.coauthors).toBe(145);
    expect(on.stats.institutions).toBe(119);
  });

  it('誰も 2 つ以上の都市に現れない', () => {
    /** @type {Map<string, string[]>} */
    const citiesOf = new Map();
    for (const city of on.cities) {
      for (const coauthor of city.coauthors) {
        if (!citiesOf.has(coauthor.id)) citiesOf.set(coauthor.id, []);
        citiesOf.get(coauthor.id).push(city.key);
      }
    }
    expect(
      [...citiesOf.entries()].filter(([, keys]) => keys.length > 1),
    ).toEqual([]);
    expect(citiesOf.size).toBe(143);
  });

  it('education / healthcare を持たない人はそのまま（暴発しない）', () => {
    // 絞り込み後も 12 名は勤務先らしい種別以外が主所属のまま残る。
    // いずれも候補にその種別が 1 つも無い人。
    const kept = [...on.coauthors.values()].filter((coauthor) => {
      const primary = on.institutions.get(coauthor.primaryInstitutionId);
      return primary && !OCCUPATIONAL.has(primary.type);
    });
    expect(kept).toHaveLength(12);
    for (const coauthor of kept) {
      expect(coauthor.primaryTypeFiltered).toBe(false);
      const types = coauthor.institutionIds.map(
        (id) => on.institutions.get(id)?.type,
      );
      expect(types.some((type) => OCCUPATIONAL.has(type))).toBe(false);
    }
  });
});

describe('afftype=off（従来の判定に戻す）', () => {
  it('種別優先を切ると 2026-08 以前の既知解に戻る', () => {
    expect(off.stats.cities).toBe(47);
    expect(off.stats.primaryBy).toEqual({
      firstListed: 139,
      orcid: 0,
      fallback: 4,
      none: 2,
    });
    expect(off.stats.primaryTypeFiltered).toBe(0);
    for (const coauthor of off.coauthors.values()) {
      expect(coauthor.primaryTypeFiltered).toBe(false);
    }
  });

  it('切ると Leucht 研の面々はコンソーシアム本部に戻る', () => {
    expect(cityOf(off, 'Spyridon Siafis')).toEqual({
      institution: 'German Center for Infection Research',
      city: 'Braunschweig',
    });
    expect(cityOf(off, 'Josef Priller')).toEqual({
      institution: 'German Center for Neurodegenerative Diseases',
      city: 'Bonn',
    });
  });
});

describe('normalizeAffiliationTypeMode', () => {
  it('既定は有効。off / false / 0 だけ無効', () => {
    expect(normalizeAffiliationTypeMode(undefined)).toBe(true);
    expect(normalizeAffiliationTypeMode(null)).toBe(true);
    expect(normalizeAffiliationTypeMode('on')).toBe(true);
    expect(normalizeAffiliationTypeMode('wat')).toBe(true);
    expect(normalizeAffiliationTypeMode('off')).toBe(false);
    expect(normalizeAffiliationTypeMode('false')).toBe(false);
    expect(normalizeAffiliationTypeMode('0')).toBe(false);
    expect(normalizeAffiliationTypeMode(false)).toBe(false);
  });

  it('優先する種別は education と healthcare の 2 つ', () => {
    expect([...OCCUPATIONAL_INSTITUTION_TYPES]).toEqual([
      'education',
      'healthcare',
    ]);
  });
});

describe('種別の絞り込み（合成データ）', () => {
  const master = new Map([
    [
      'https://openalex.org/I1',
      {
        id: 'https://openalex.org/I1',
        name: 'German Center for Infection Research',
        type: 'facility',
      },
    ],
    [
      'https://openalex.org/I2',
      {
        id: 'https://openalex.org/I2',
        name: 'Technical University of Munich',
        type: 'education',
      },
    ],
    [
      'https://openalex.org/I3',
      { id: 'https://openalex.org/I3', name: 'Acme Pharma', type: 'company' },
    ],
    [
      'https://openalex.org/I4',
      { id: 'https://openalex.org/I4', name: 'Acme Labs', type: 'company' },
    ],
    [
      'https://openalex.org/I5',
      {
        id: 'https://openalex.org/I5',
        name: 'Charité - Universitätsmedizin Berlin',
        type: 'healthcare',
      },
    ],
  ]);
  const cityKeyByInstitution = new Map([
    ['https://openalex.org/I1', 'DE|Braunschweig'],
    ['https://openalex.org/I2', 'DE|Munich'],
    ['https://openalex.org/I3', 'JP|Osaka'],
    ['https://openalex.org/I4', 'JP|Tokyo'],
    ['https://openalex.org/I5', 'DE|Berlin'],
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

  function run(coauthor, events, options = {}) {
    const counts = assignPrimaryAffiliations({
      coauthors: [coauthor],
      eventsOf: () => events,
      cityKeyByInstitution,
      institutionMaster: master,
      ...options,
    });
    return { coauthor, counts };
  }

  it('先頭がコンソーシアム本部でも、同じ論文の大学を先頭とみなす', () => {
    const { coauthor, counts } = run(
      person({
        institutionIds: ['https://openalex.org/I1', 'https://openalex.org/I2'],
      }),
      [
        {
          institutionId: 'https://openalex.org/I1',
          listedIds: ['https://openalex.org/I1', 'https://openalex.org/I2'],
          year: 2024,
          order: 0,
        },
        {
          institutionId: 'https://openalex.org/I1',
          listedIds: ['https://openalex.org/I1', 'https://openalex.org/I2'],
          year: 2026,
          order: 1,
        },
      ],
    );
    expect(coauthor.primaryInstitutionId).toBe('https://openalex.org/I2');
    expect(coauthor.primaryBy).toBe('first-listed');
    expect(coauthor.primaryTypeFiltered).toBe(true);
    expect(counts.typeFiltered).toBe(1);
  });

  it('preferOccupationalTypes: false なら従来どおり先頭の本部を採る', () => {
    const { coauthor, counts } = run(
      person({
        institutionIds: ['https://openalex.org/I1', 'https://openalex.org/I2'],
      }),
      [
        {
          institutionId: 'https://openalex.org/I1',
          listedIds: ['https://openalex.org/I1', 'https://openalex.org/I2'],
          year: 2024,
          order: 0,
        },
      ],
      { preferOccupationalTypes: false },
    );
    expect(coauthor.primaryInstitutionId).toBe('https://openalex.org/I1');
    expect(coauthor.primaryTypeFiltered).toBe(false);
    expect(counts.typeFiltered).toBe(0);
  });

  it('企業しか所属が無い人は企業のまま（絞り込みが暴発しない）', () => {
    const { coauthor, counts } = run(
      person({
        institutionIds: ['https://openalex.org/I3', 'https://openalex.org/I4'],
      }),
      [
        {
          institutionId: 'https://openalex.org/I3',
          listedIds: ['https://openalex.org/I3'],
          year: 2024,
          order: 0,
        },
        {
          institutionId: 'https://openalex.org/I3',
          listedIds: ['https://openalex.org/I3'],
          year: 2025,
          order: 1,
        },
        {
          institutionId: 'https://openalex.org/I4',
          listedIds: ['https://openalex.org/I4'],
          year: 2026,
          order: 2,
        },
      ],
    );
    expect(coauthor.primaryInstitutionId).toBe('https://openalex.org/I3');
    expect(coauthor.primaryBy).toBe('first-listed');
    expect(coauthor.primaryTypeFiltered).toBe(false);
    expect(counts.typeFiltered).toBe(0);
  });

  it('病院も勤務先として残る（education だけに寄せない）', () => {
    const { coauthor } = run(
      person({
        institutionIds: ['https://openalex.org/I1', 'https://openalex.org/I5'],
      }),
      [
        {
          institutionId: 'https://openalex.org/I1',
          listedIds: ['https://openalex.org/I1', 'https://openalex.org/I5'],
          year: 2024,
          order: 0,
        },
      ],
    );
    expect(coauthor.primaryInstitutionId).toBe('https://openalex.org/I5');
    expect(coauthor.primaryBy).toBe('first-listed');
  });

  it('許容種別が先頭に印字された論文が 1 本も無ければ機関 ID 昇順に落ちる', () => {
    const { coauthor } = run(
      person({
        institutionIds: [
          'https://openalex.org/I1',
          'https://openalex.org/I5',
          'https://openalex.org/I2',
        ],
      }),
      [
        {
          institutionId: 'https://openalex.org/I1',
          listedIds: ['https://openalex.org/I1'],
          year: 2024,
          order: 0,
        },
      ],
    );
    // 先頭所属のイベントは全部落ちるので、絞り込んだ候補（I5 / I2）の昇順で決まる。
    expect(coauthor.primaryInstitutionId).toBe('https://openalex.org/I2');
    expect(coauthor.primaryBy).toBe('fallback');
    expect(coauthor.primaryTypeFiltered).toBe(true);
  });

  it('絞り込みが起きても結論が同じならフラグは立たない', () => {
    const { coauthor, counts } = run(
      person({
        institutionIds: ['https://openalex.org/I2', 'https://openalex.org/I1'],
      }),
      [
        {
          institutionId: 'https://openalex.org/I2',
          listedIds: ['https://openalex.org/I2', 'https://openalex.org/I1'],
          year: 2024,
          order: 0,
        },
      ],
    );
    expect(coauthor.primaryInstitutionId).toBe('https://openalex.org/I2');
    expect(coauthor.primaryTypeFiltered).toBe(false);
    expect(counts.typeFiltered).toBe(0);
  });
});
