import { describe, expect, it } from 'vitest';

import { buildDataset } from '../src/pipeline.js';
import { PROGRESS_STRINGS } from '../src/ui/i18n.js';
import {
  createFixtureFetch,
  jsonResponse,
  loadFixture,
  serializeDataset,
  stripRor,
} from './helpers/stub-fetch.js';

const snapshot = loadFixture('dataset-snapshot.json');

/**
 * ORCID + researchmap の 2 seed。実運用と同じ組み合わせ。
 */
async function build() {
  const { fetchImpl, calls } = createFixtureFetch();
  const dataset = await buildDataset({
    seeds: [
      { kind: 'orcid', value: '0000-0003-1317-0220' },
      { kind: 'researchmap', value: 'yk_frkw' },
    ],
    mailto: 'test@example.org',
    fetchImpl,
    useCache: false,
  });
  return { dataset, calls };
}

describe('buildDataset', () => {
  it('dataset-snapshot.json と一致する', async () => {
    const { dataset } = await build();
    expect(stripRor(serializeDataset(dataset))).toEqual(snapshot);
  });

  it('stats が既知解と一致する', async () => {
    const { dataset } = await build();
    expect(dataset.stats).toEqual({
      seedWorks: 34,
      matchedWorks: 34,
      unmatchedDois: [],
      // 統合後の人数。統合前は 166 レコード（tests/merge-coauthors.test.js 参照）。
      coauthors: 145,
      coauthorsMerged: 21,
      institutions: 119,
      geoResolved: 119,
      // 1 人 1 都市に置くようになって 69 → 47（誰の主所属でもない都市が消える）。
      // さらに主所属を勤務先らしい種別に絞って 47 → 43
      // （DE|Braunschweig / DE|Berlin / DE|Bonn / US|Orangeburg が消える）。
      cities: 43,
      countries: 14,
      authorshipRows: 315,
      authorshipsWithoutInstitution: 5,
      coauthorsWithoutInstitution: 2,
      // 主所属の内訳。ORCID の所属名は「先頭所属」で決まらなかった人にしか使わない。
      primaryBy: { firstListed: 142, orcid: 0, fallback: 1, none: 2 },
      // 種別の絞り込みで主所属が別の機関に変わった人数。
      primaryTypeFiltered: 18,
      yearMin: 2019,
      yearMax: 2026,
    });
    // 突合できなかった DOI は 0 件。
    expect(dataset.stats.unmatchedDois).toHaveLength(0);
    // 座標の欠損ゼロ。
    expect(dataset.stats.geoResolved).toBe(dataset.stats.institutions);
  });

  it('cities の上位 10 件が snapshot と一致する', async () => {
    const { dataset } = await build();
    expect(
      stripRor(JSON.parse(JSON.stringify(dataset.cities.slice(0, 10)))),
    ).toEqual(snapshot.cities.slice(0, 10));
  });

  it('上位都市の論文数・機関数が既知解と一致する', async () => {
    const { dataset } = await build();
    const byCity = new Map(dataset.cities.map((city) => [city.key, city]));

    expect(byCity.get('JP|Tokyo')).toMatchObject({
      city: 'Tokyo',
      paperCount: 13,
      coauthorCount: 18,
    });
    expect(byCity.get('JP|Tokyo').institutions).toHaveLength(9);

    expect(byCity.get('JP|Kyoto')).toMatchObject({
      paperCount: 17,
      coauthorCount: 18,
    });
    // 京都を主所属とする 18 人はいずれも京都大学。
    expect(byCity.get('JP|Kyoto').institutions).toHaveLength(1);

    expect(byCity.get('CH|Bern')).toMatchObject({
      paperCount: 14,
      coauthorCount: 3,
    });
    expect(byCity.get('CH|Bern').institutions).toHaveLength(1);

    // Leucht 研の面々が研究コンソーシアム本部からミュンヘンに戻ってくる（11 → 25）。
    expect(byCity.get('DE|Munich')).toMatchObject({
      paperCount: 13,
      coauthorCount: 25,
    });
    expect(byCity.get('DE|Munich').institutions).toHaveLength(4);

    // 誰の主所属でもない都市は地図から消える（共著者は主所属の都市に 1 度だけ出る）。
    expect(byCity.has('CH|Lausanne')).toBe(false);
    expect(byCity.has('JP|Saitama')).toBe(false);
  });

  it('1 人が 2 つ以上の都市に現れない', async () => {
    const { dataset } = await build();
    /** @type {Map<string, string[]>} */
    const citiesOf = new Map();
    for (const city of dataset.cities) {
      for (const coauthor of city.coauthors) {
        if (!citiesOf.has(coauthor.id)) citiesOf.set(coauthor.id, []);
        citiesOf.get(coauthor.id).push(city.key);
      }
    }
    const duplicated = [...citiesOf.entries()].filter(
      ([, keys]) => keys.length > 1,
    );
    expect(duplicated).toEqual([]);
    // 主所属が決まった 143 人がちょうど 1 度ずつ地図に出る。
    expect(citiesOf.size).toBe(143);
  });

  it('min= の下限で残る共著者数が既知解と一致する', async () => {
    const { dataset } = await build();
    const atLeast = (n) =>
      [...dataset.coauthors.values()].filter((c) => c.paperCount >= n).length;
    expect(atLeast(1)).toBe(145);
    expect(atLeast(2)).toBe(53);
    expect(atLeast(3)).toBe(27);
  });

  it('pin=all なら旧来の 69 都市 15 か国に戻せる', async () => {
    const { fetchImpl } = createFixtureFetch();
    const dataset = await buildDataset({
      seeds: [
        { kind: 'orcid', value: '0000-0003-1317-0220' },
        { kind: 'researchmap', value: 'yk_frkw' },
      ],
      mailto: 'test@example.org',
      fetchImpl,
      useCache: false,
      pinMode: 'all',
    });
    expect(dataset.stats.cities).toBe(69);
    expect(dataset.stats.countries).toBe(15);
  });

  it('実データでは規則 1 で決まらない 2 人分しか ORCID を引かない', async () => {
    const { dataset, calls } = await build();
    const searches = calls.filter((url) => url.includes('expanded-search'));
    // 145 人分を 50 人ずつ 3 回引いていたのを 1 回に減らす。
    expect(searches).toHaveLength(1);
    expect(dataset.pendingOrcidLookups).toEqual([
      '0000-0001-7016-2687',
      '0000-0003-2196-0601',
    ]);
    // 規則 1 で決まった 142 人は問い合わせに含めない。
    const query = decodeURIComponent(searches[0]);
    for (const orcid of dataset.pendingOrcidLookups)
      expect(query).toContain(orcid);
    expect(query.split(' OR ')).toHaveLength(
      dataset.pendingOrcidLookups.length,
    );
  });

  it('ORCID の所属取得が落ちても地図は同じように出る', async () => {
    const { fetchImpl } = createFixtureFetch({
      // 全バッチ失敗させる。
      orcidAffiliations: [],
    });
    const dataset = await buildDataset({
      seeds: [
        { kind: 'orcid', value: '0000-0003-1317-0220' },
        { kind: 'researchmap', value: 'yk_frkw' },
      ],
      mailto: 'test@example.org',
      fetchImpl,
      useCache: false,
    });
    expect(dataset.stats.cities).toBe(43);
    expect(dataset.stats.primaryBy.orcid).toBe(0);
  });

  it('Oxford が 1 ノードにまとまる（座標丸めだと 3 分割される回帰）', async () => {
    const { dataset } = await build();
    const oxford = dataset.cities.filter((city) => city.city === 'Oxford');
    expect(oxford).toHaveLength(1);
    expect(oxford[0].key).toBe('GB|Oxford');
    expect(oxford[0].paperCount).toBe(10);
    expect(oxford[0].coauthorCount).toBe(4);
    expect(oxford[0].institutions).toHaveLength(3);
    // 代表座標は最も多くの機関が共有する丸め座標（論文数ではない）。
    expect([oxford[0].lat, oxford[0].lng]).toEqual([51.75222, -1.25596]);
  });

  it('Kyoto が 1 ノードにまとまる（country_code が null の機関を含む回帰）', async () => {
    const { dataset } = await build();
    const kyoto = dataset.cities.filter((city) => city.city === 'Kyoto');
    expect(kyoto).toHaveLength(1);
    expect(kyoto[0].key).toBe('JP|Kyoto');
    expect(kyoto[0].paperCount).toBe(17);
    expect(kyoto[0].coauthorCount).toBe(18);
    // 京都を主所属とする人はいずれも京都大学なので、載る機関は 1 つ。
    expect(kyoto[0].institutions).toHaveLength(1);
    // グループの国コードは非 null の機関から埋まる（country_code が null の
    // Kyoto Min-iren Asukai Hospital も同じノードに束ねられている）。
    expect(kyoto[0].countryCode).toBe('JP');
  });

  it('Osaka が 1 ノードにまとまる（country_code が null の機関を含む回帰）', async () => {
    const { dataset } = await build();
    const osaka = dataset.cities.filter((city) => city.city === 'Osaka');
    expect(osaka).toHaveLength(1);
    expect(osaka[0].key).toBe('JP|Osaka');
    // Yuki Kataoka の主所属が Santen（company・大阪）から京都大学に移ったので減る。
    expect(osaka[0].paperCount).toBe(1);
    expect(osaka[0].coauthorCount).toBe(2);
    expect(osaka[0].institutions).toHaveLength(2);
    expect(osaka[0].countryCode).toBe('JP');
  });

  it('都市ノードの key と都市名が一意', async () => {
    const { dataset } = await build();
    const keys = dataset.cities.map((city) => city.key);
    expect(new Set(keys).size).toBe(keys.length);
    const names = dataset.cities.map((city) => city.city);
    expect(new Set(names).size).toBe(names.length);
    // 座標フォールバックのキーは残っていない。
    expect(keys.some((key) => key.includes('@'))).toBe(false);
  });

  it('代表座標は年フィルタで揺れない', async () => {
    const { dataset } = await build();
    const { fetchImpl } = createFixtureFetch();
    const filtered = await buildDataset({
      seeds: [
        { kind: 'orcid', value: '0000-0003-1317-0220' },
        { kind: 'researchmap', value: 'yk_frkw' },
      ],
      yearFrom: 2024,
      mailto: 'test@example.org',
      fetchImpl,
      useCache: false,
    });

    const before = new Map(dataset.cities.map((city) => [city.key, city]));
    let compared = 0;
    for (const city of filtered.cities) {
      const original = before.get(city.key);
      if (!original) continue;
      compared += 1;
      // 論文数は変わってもピンの座標は同じ（d3 の join が壊れないこと）。
      expect([city.lat, city.lng]).toEqual([original.lat, original.lng]);
    }
    expect(compared).toBeGreaterThan(10);
    expect(filtered.stats.seedWorks).toBeLessThan(34);
  });

  it('cities は paperCount 降順 → coauthorCount 降順 → key 昇順', async () => {
    const { dataset } = await build();
    for (let i = 1; i < dataset.cities.length; i += 1) {
      const prev = dataset.cities[i - 1];
      const current = dataset.cities[i];
      if (prev.paperCount !== current.paperCount) {
        expect(prev.paperCount).toBeGreaterThan(current.paperCount);
      } else if (prev.coauthorCount !== current.coauthorCount) {
        expect(prev.coauthorCount).toBeGreaterThan(current.coauthorCount);
      } else {
        expect(prev.key < current.key).toBe(true);
      }
    }
  });

  it('seed 本人は共著者に含まれない', async () => {
    const { dataset } = await build();
    expect(dataset.seedAuthorIds.length).toBeGreaterThan(0);
    for (const seedId of dataset.seedAuthorIds) {
      expect(dataset.coauthors.has(seedId)).toBe(false);
    }
    for (const coauthor of dataset.coauthors.values()) {
      expect(coauthor.orcid).not.toBe('https://orcid.org/0000-0003-1317-0220');
    }
  });

  it('yearFrom / yearTo は seed works の段階で効く', async () => {
    const { fetchImpl } = createFixtureFetch();
    const dataset = await buildDataset({
      seeds: [{ kind: 'orcid', value: '0000-0003-1317-0220' }],
      yearFrom: 2025,
      mailto: 'test@example.org',
      fetchImpl,
      useCache: false,
    });
    expect(dataset.works.every((work) => work.year >= 2025)).toBe(true);
    expect(dataset.works.length).toBeLessThan(34);
    expect(dataset.stats.seedWorks).toBe(dataset.works.length);
  });

  it('ネットワークは fetchImpl 経由でしか触らない', async () => {
    const { calls } = await build();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((url) => url.startsWith('https://'))).toBe(true);
  });
});

/**
 * ORCID の所属取得を「規則 1 で決まらない人がいるときだけ」に遅らせた経路の固定。
 *
 * 実データは規則 1 でほぼ決まってしまうので、合成データで両方の経路を作る:
 *   - 全員が規則 1 で決まる  → expanded-search を 1 回も投げない
 *   - 決まらない人がいる      → その人の分だけ投げ、規則 2 で決め直す
 */
describe('ORCID 所属の遅延取得', () => {
  const SEED_ORCID = '0000-0000-0000-0001';
  const DECIDED_ORCID = '0000-0000-0000-0003';
  const UNDECIDED_ORCID = '0000-0000-0000-0002';

  const TOKYO = 'https://openalex.org/I1';
  const OXFORD = 'https://openalex.org/I2';

  const INSTITUTIONS = [
    {
      id: TOKYO,
      display_name: 'Alpha University',
      country_code: 'JP',
      type: 'education',
      geo: {
        latitude: 35.68,
        longitude: 139.69,
        city: 'Tokyo',
        country: 'Japan',
        country_code: 'JP',
      },
    },
    {
      id: OXFORD,
      display_name: 'Beta University',
      country_code: 'GB',
      type: 'education',
      geo: {
        latitude: 51.75,
        longitude: -1.25,
        city: 'Oxford',
        country: 'United Kingdom',
        country_code: 'GB',
      },
    },
  ];

  /** OpenAlex の authorship 1 行。 */
  const row = (id, orcid, institutionId) => ({
    author: {
      id: `https://openalex.org/${id}`,
      display_name: id,
      orcid: orcid ? `https://orcid.org/${orcid}` : null,
    },
    institutions: [INSTITUTIONS.find((i) => i.id === institutionId)],
  });

  /** OpenAlex の work 1 件。 */
  const work = (doi, authorships) => ({
    id: `https://openalex.org/W${doi}`,
    doi: `https://doi.org/${doi}`,
    display_name: doi,
    publication_year: 2020,
    authorships,
  });

  /**
   * 合成データを返すスタブ。expanded-search は**問い合わせられた ORCID の分だけ**返す。
   * @param {Object} input
   * @param {any[]} input.works
   * @param {Record<string, string[]>} [input.affiliations]
   */
  function syntheticFetch({ works, affiliations = {} }) {
    const dois = works.map((entry) =>
      entry.doi.replace('https://doi.org/', ''),
    );
    /** @type {string[]} */
    const calls = [];

    const fetchImpl = async (url) => {
      const target = String(url);
      calls.push(target);

      if (target.startsWith('https://pub.orcid.org/v3.0/expanded-search')) {
        const query = new URL(target).searchParams.get('q') ?? '';
        const requested = query
          .replace(/^orcid:\(|\)$/g, '')
          .split(' OR ')
          .map((id) => id.trim());
        return jsonResponse({
          'expanded-result': requested
            .filter((id) => affiliations[id])
            .map((id) => ({
              'orcid-id': id,
              'institution-name': affiliations[id],
            })),
        });
      }
      if (target.startsWith('https://pub.orcid.org/')) {
        return jsonResponse({
          group: dois.map((doi) => ({
            'work-summary': [
              {
                title: { title: { value: doi } },
                'publication-date': { year: { value: '2020' } },
                'external-ids': {
                  'external-id': [
                    { 'external-id-type': 'doi', 'external-id-value': doi },
                  ],
                },
              },
            ],
          })),
        });
      }
      if (target.includes('api.openalex.org/works'))
        return jsonResponse({ results: works });
      if (target.includes('api.openalex.org/institutions'))
        return jsonResponse({ results: INSTITUTIONS });
      return jsonResponse({ error: 'unexpected url' }, 404);
    };

    return { fetchImpl: /** @type {any} */ (fetchImpl), calls };
  }

  /** 全員が規則 1 で決まる構成。共著者はどちらも所属が 1 つだけ。 */
  const decidedWorks = [
    work('10.1/a', [
      row('A0', SEED_ORCID, TOKYO),
      row('A1', DECIDED_ORCID, TOKYO),
    ]),
  ];

  /** A2 だけ 2 都市に 1 本ずつで割れる（同数・同年なので規則 1 が決められない）。 */
  const undecidedWorks = [
    work('10.1/a', [
      row('A0', SEED_ORCID, TOKYO),
      row('A1', DECIDED_ORCID, TOKYO),
      row('A2', UNDECIDED_ORCID, TOKYO),
    ]),
    work('10.1/b', [
      row('A0', SEED_ORCID, OXFORD),
      row('A2', UNDECIDED_ORCID, OXFORD),
    ]),
  ];

  /**
   * @param {ReturnType<typeof syntheticFetch>} stub
   * @param {Object} [options]
   */
  function run(stub, options = {}) {
    return buildDataset({
      seeds: [{ kind: 'orcid', value: SEED_ORCID }],
      mailto: 'test@example.org',
      fetchImpl: stub.fetchImpl,
      useCache: false,
      ...options,
    });
  }

  const searchesOf = (calls) =>
    calls.filter((url) => url.includes('expanded-search'));

  it('全員が規則 1 で決まるなら expanded-search を 1 回も投げない', async () => {
    const stub = syntheticFetch({ works: decidedWorks });
    const dataset = await run(stub);

    expect(searchesOf(stub.calls)).toEqual([]);
    expect(dataset.pendingOrcidLookups).toEqual([]);
    expect(dataset.stats.primaryBy).toEqual({
      firstListed: 1,
      orcid: 0,
      fallback: 0,
      none: 0,
    });
  });

  it('その経路では onProgress に orcid-affiliations が出ない', async () => {
    const stub = syntheticFetch({ works: decidedWorks });
    /** @type {string[]} */
    const keys = [];
    await run(stub, { onProgress: (key) => keys.push(key) });
    expect(keys).not.toContain('orcid-affiliations');
    expect(keys.at(-1)).toBe('aggregate');
  });

  it('決まらない人がいるときだけ、その人の分を投げる', async () => {
    const stub = syntheticFetch({
      works: undecidedWorks,
      affiliations: { [UNDECIDED_ORCID]: ['Beta University'] },
    });
    const dataset = await run(stub);

    const searches = searchesOf(stub.calls);
    expect(searches).toHaveLength(1);
    const query = decodeURIComponent(searches[0]);
    expect(query).toContain(UNDECIDED_ORCID);
    // 規則 1 で決まった人は問い合わせに混ぜない。
    expect(query).not.toContain(DECIDED_ORCID);

    expect(dataset.pendingOrcidLookups).toEqual([UNDECIDED_ORCID]);
    expect(dataset.stats.primaryBy).toEqual({
      firstListed: 1,
      orcid: 1,
      fallback: 0,
      none: 0,
    });
    const undecided = [...dataset.coauthors.values()].find(
      (coauthor) => coauthor.orcid === `https://orcid.org/${UNDECIDED_ORCID}`,
    );
    expect(undecided.primaryInstitutionId).toBe(OXFORD);
    expect(undecided.primaryBy).toBe('orcid');
  });

  it('orcidaff=off なら決まらない人がいても投げない', async () => {
    const stub = syntheticFetch({
      works: undecidedWorks,
      affiliations: { [UNDECIDED_ORCID]: ['Beta University'] },
    });
    const dataset = await run(stub, { useOrcidAffiliations: false });

    expect(searchesOf(stub.calls)).toEqual([]);
    // 規則 2 を使えないので規則 3（機関 ID 昇順）に落ちる。
    expect(dataset.stats.primaryBy).toEqual({
      firstListed: 1,
      orcid: 0,
      fallback: 1,
      none: 0,
    });
  });
});

describe('onProgress', () => {
  /** ORCID + researchmap の 2 seed で流したときに出るキー列 */
  async function collectProgress() {
    const { fetchImpl } = createFixtureFetch();
    /** @type {Array<[string, number, number]>} */
    const events = [];
    await buildDataset({
      seeds: [
        { kind: 'orcid', value: '0000-0003-1317-0220' },
        { kind: 'researchmap', value: 'yk_frkw' },
      ],
      mailto: 'test@example.org',
      fetchImpl,
      useCache: false,
      onProgress: (key, done, total) => events.push([key, done, total]),
    });
    return events;
  }

  it('第1引数は i18n が文言を持つ安定キーだけ', async () => {
    const events = await collectProgress();
    const known = new Set(Object.keys(PROGRESS_STRINGS));
    const seen = new Set(events.map(([key]) => key));
    expect(seen.size).toBeGreaterThan(0);
    for (const key of seen) expect(known.has(key)).toBe(true);
  });

  it('キーは ASCII のみ（日本語が混ざらない回帰）', async () => {
    const events = await collectProgress();
    for (const [key] of events) {
      // eslint-disable-next-line no-control-regex
      expect(key).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it('この seed 構成で出るキーは seeds / seeds:* / works / institutions / aggregate', async () => {
    const events = await collectProgress();
    expect([...new Set(events.map(([key]) => key))].sort()).toEqual([
      'aggregate',
      'institutions',
      'orcid-affiliations',
      'seeds',
      'seeds:orcid',
      'seeds:researchmap',
      'works',
    ]);
  });

  it('seeds は最後に done === total で締める', async () => {
    const events = await collectProgress();
    const seedEvents = events.filter(([key]) => key === 'seeds');
    const last = seedEvents.at(-1);
    expect(last).toEqual(['seeds', 2, 2]);
  });

  it('aggregate が最後に来る', async () => {
    const events = await collectProgress();
    expect(events.at(-1)).toEqual(['aggregate', 1, 1]);
  });
});
