import { describe, expect, it } from 'vitest';

import { buildDataset } from '../src/pipeline.js';
import { PROGRESS_STRINGS } from '../src/ui/i18n.js';
import {
  createFixtureFetch,
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
      cities: 69,
      countries: 15,
      authorshipRows: 315,
      authorshipsWithoutInstitution: 5,
      coauthorsWithoutInstitution: 2,
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
      paperCount: 20,
      coauthorCount: 24,
    });
    expect(byCity.get('JP|Tokyo').institutions).toHaveLength(15);

    expect(byCity.get('JP|Kyoto')).toMatchObject({
      paperCount: 17,
      coauthorCount: 19,
    });
    expect(byCity.get('JP|Kyoto').institutions).toHaveLength(3);

    expect(byCity.get('CH|Bern')).toMatchObject({
      paperCount: 14,
      coauthorCount: 3,
    });
    expect(byCity.get('CH|Bern').institutions).toHaveLength(2);

    expect(byCity.get('CH|Lausanne')).toMatchObject({
      paperCount: 14,
      coauthorCount: 3,
    });
    expect(byCity.get('CH|Lausanne').institutions).toHaveLength(1);

    expect(byCity.get('JP|Saitama')).toMatchObject({
      paperCount: 14,
      coauthorCount: 1,
    });
    expect(byCity.get('JP|Saitama').institutions).toHaveLength(1);

    expect(byCity.get('DE|Munich')).toMatchObject({
      paperCount: 13,
      coauthorCount: 27,
    });
    expect(byCity.get('DE|Munich').institutions).toHaveLength(6);
  });

  it('Oxford が 1 ノードにまとまる（座標丸めだと 3 分割される回帰）', async () => {
    const { dataset } = await build();
    const oxford = dataset.cities.filter((city) => city.city === 'Oxford');
    expect(oxford).toHaveLength(1);
    expect(oxford[0].key).toBe('GB|Oxford');
    expect(oxford[0].paperCount).toBe(10);
    expect(oxford[0].coauthorCount).toBe(4);
    expect(oxford[0].institutions).toHaveLength(4);
    // 代表座標は最も多くの機関が共有する丸め座標（論文数ではない）。
    expect([oxford[0].lat, oxford[0].lng]).toEqual([51.75222, -1.25596]);
  });

  it('Kyoto が 1 ノードにまとまる（country_code が null の機関を含む回帰）', async () => {
    const { dataset } = await build();
    const kyoto = dataset.cities.filter((city) => city.city === 'Kyoto');
    expect(kyoto).toHaveLength(1);
    expect(kyoto[0].key).toBe('JP|Kyoto');
    expect(kyoto[0].paperCount).toBe(17);
    expect(kyoto[0].coauthorCount).toBe(19);
    expect(kyoto[0].institutions).toHaveLength(3);
    // country_code が null の機関も同じノードに入る。
    const asukai = kyoto[0].institutions.find(
      (institution) => institution.name === 'Kyoto Min-iren Asukai Hospital',
    );
    expect(asukai).toBeDefined();
    expect(asukai.countryCode).toBeNull();
    // グループの国コードは非 null の機関から埋まる。
    expect(kyoto[0].countryCode).toBe('JP');
  });

  it('Osaka が 1 ノードにまとまる（country_code が null の機関を含む回帰）', async () => {
    const { dataset } = await build();
    const osaka = dataset.cities.filter((city) => city.city === 'Osaka');
    expect(osaka).toHaveLength(1);
    expect(osaka[0].key).toBe('JP|Osaka');
    expect(osaka[0].paperCount).toBe(5);
    expect(osaka[0].coauthorCount).toBe(7);
    expect(osaka[0].institutions).toHaveLength(3);
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
