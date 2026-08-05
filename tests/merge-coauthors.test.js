/**
 * 共著者レコードの統合の既知解テスト。
 *
 * OpenAlex は同一人物に複数の著者レコードを作る。実測では共著者が 13% 水増しされ、
 * 地図の丸の大きさ（size=coauthors）が最大 27% 狂っていた。
 * ここで凍結するのは 2 つ:
 *   1. 統合しても**論文・機関・都市・国は 1 つも動かない**（変わるのは人の同一性だけ）
 *   2. 統合の判定は同姓同名の別人を潰さない（同一論文への同居を先に見る）
 */
import { describe, expect, it } from 'vitest';

import { buildDataset } from '../src/pipeline.js';
import { mergeCoauthors, normalizeMergeMode } from '../src/aggregate.js';
import {
  DEFAULTS,
  readStateFromUrl,
  stateToQuery,
} from '../src/ui/controls.js';
import { createFixtureFetch } from './helpers/stub-fetch.js';

const SEEDS = [
  { kind: 'orcid', value: '0000-0003-1317-0220' },
  { kind: 'researchmap', value: 'yk_frkw' },
];

/**
 * @param {Object} [options] `mergeCoauthors` だけ差し替える
 */
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

const merged = await build();
const unmerged = await build({ mergeCoauthors: false });
const orcidOnly = await build({ mergeCoauthors: 'orcid' });

/** @param {any} dataset */
function cityByKey(dataset) {
  return new Map(dataset.cities.map((city) => [city.key, city]));
}

describe('共著者の統合（既定 ON）', () => {
  it('統合前後で論文・機関・都市・国が動かない', () => {
    for (const key of ['cities', 'institutions', 'countries', 'matchedWorks'])
      expect(merged.stats[key]).toBe(unmerged.stats[key]);
    // 既知解そのもの。ここが動いたら統合ロジックの誤り。
    expect(merged.stats.cities).toBe(69);
    expect(merged.stats.institutions).toBe(119);
    expect(merged.stats.countries).toBe(15);
    expect(merged.stats.matchedWorks).toBe(34);
    expect(merged.stats.seedWorks).toBe(34);
  });

  it('都市の集合と代表座標が動かない', () => {
    const before = cityByKey(unmerged);
    const after = cityByKey(merged);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [key, city] of after) {
      expect([city.lat, city.lng]).toEqual([
        before.get(key).lat,
        before.get(key).lng,
      ]);
    }
  });

  it('都市の paperCount と DOI 一覧が 1 件も動かない', () => {
    const before = cityByKey(unmerged);
    for (const city of merged.cities) {
      expect(city.paperCount).toBe(before.get(city.key).paperCount);
      expect(city.dois).toEqual(before.get(city.key).dois);
    }
  });

  it('都市に載る機関の一覧と並びが動かない', () => {
    const before = cityByKey(unmerged);
    for (const city of merged.cities) {
      expect(city.institutions.map((i) => i.id)).toEqual(
        before.get(city.key).institutions.map((i) => i.id),
      );
    }
  });

  it('共著者は 145 人、吸収されたレコードは 21 件', () => {
    expect(merged.stats.coauthors).toBe(145);
    expect(merged.stats.coauthorsMerged).toBe(21);
    expect(merged.coauthors.size).toBe(145);
    // 吸収数 = 統合前後の差。
    expect(unmerged.stats.coauthors - merged.stats.coauthors).toBe(21);
  });

  it('水増しが大きかった都市の共著者数が下がる', () => {
    const after = cityByKey(merged);
    expect(after.get('DE|Munich').coauthorCount).toBe(27);
    expect(after.get('DE|Berlin').coauthorCount).toBe(17);
    expect(after.get('JP|Kyoto').coauthorCount).toBe(19);
    expect(after.get('JP|Tokyo').coauthorCount).toBe(24);
  });

  it('分裂していなかった都市の共著者数は動かない', () => {
    const after = cityByKey(merged);
    const before = cityByKey(unmerged);
    for (const [key, expected] of [
      ['CH|Bern', 3],
      ['CH|Lausanne', 3],
      ['JP|Saitama', 1],
    ]) {
      expect(after.get(key).coauthorCount).toBe(expected);
      expect(before.get(key).coauthorCount).toBe(expected);
    }
  });

  it('Stefan Leucht が 1 レコードになる（ORCID 一致）', () => {
    const leucht = [...merged.coauthors.values()].filter(
      (c) => c.name === 'Stefan Leucht',
    );
    expect(leucht).toHaveLength(1);
    expect(leucht[0].id).toBe('https://openalex.org/A5002251483');
    expect(leucht[0].mergedBy).toBe('orcid');
    expect(leucht[0].mergedIds).toContain('https://openalex.org/A5136768910');
    // 論文は和集合。代表 9 本 + 分裂した 2 レコード 1 本ずつ。
    expect(leucht[0].paperCount).toBe(leucht[0].dois.length);
    expect(leucht[0].paperCount).toBe(11);
    expect(new Set(leucht[0].dois).size).toBe(leucht[0].dois.length);
  });

  it('統合していない共著者は mergedIds が空・mergedBy が null', () => {
    const untouched = [...merged.coauthors.values()].filter(
      (c) => c.mergedIds.length === 0,
    );
    expect(untouched.length).toBe(145 - 19);
    for (const coauthor of untouched) expect(coauthor.mergedBy).toBeNull();
  });

  it('吸収された著者 ID は Dataset に残らない', () => {
    for (const coauthor of merged.coauthors.values()) {
      for (const id of coauthor.mergedIds) {
        expect(merged.coauthors.has(id)).toBe(false);
        expect(id).not.toBe(coauthor.id);
      }
    }
  });

  it('同じ入力を 5 回まわしても同じ出力（決定的）', async () => {
    const runs = [];
    for (let i = 0; i < 5; i += 1) {
      const dataset = await build();
      runs.push(JSON.stringify([...dataset.coauthors.values()]));
    }
    expect(new Set(runs).size).toBe(1);
  });
});

describe('mergeCoauthors の 3 値', () => {
  it('false なら統合しない（166 レコードのまま）', () => {
    expect(unmerged.stats.coauthors).toBe(166);
    expect(unmerged.stats.coauthorsMerged).toBe(0);
    for (const coauthor of unmerged.coauthors.values()) {
      expect(coauthor.mergedIds).toEqual([]);
      expect(coauthor.mergedBy).toBeNull();
    }
  });

  it("'orcid' なら ORCID 一致だけで統合する（163 人）", () => {
    expect(orcidOnly.stats.coauthors).toBe(163);
    expect(orcidOnly.stats.coauthorsMerged).toBe(3);
    for (const coauthor of orcidOnly.coauthors.values()) {
      if (coauthor.mergedIds.length) expect(coauthor.mergedBy).toBe('orcid');
    }
  });

  it('normalizeMergeMode は既定 true / off 系は false', () => {
    expect(normalizeMergeMode(undefined)).toBe(true);
    expect(normalizeMergeMode(true)).toBe(true);
    expect(normalizeMergeMode('orcid')).toBe('orcid');
    for (const value of [false, 'off', 'none', 'false', '0'])
      expect(normalizeMergeMode(value)).toBe(false);
  });
});

/**
 * 合成データ用の共著者レコード。
 */
function record(id, name, { orcid = null, dois = [], institutionIds = [] }) {
  return {
    id: `https://openalex.org/${id}`,
    name,
    orcid,
    institutionIds: institutionIds.map((i) => `https://openalex.org/${i}`),
    dois,
    paperCount: dois.length,
  };
}

describe('統合してはいけない組み合わせ', () => {
  it('同一論文に同居する同姓同名は統合しない（同姓同名の別人）', () => {
    const { coauthors } = mergeCoauthors([
      record('A1', 'Wei Zhang', { dois: ['10.1/a'], institutionIds: ['I1'] }),
      record('A2', 'Wei Zhang', {
        dois: ['10.1/a', '10.1/b'],
        institutionIds: ['I1'],
      }),
    ]);
    expect(coauthors).toHaveLength(2);
    for (const coauthor of coauthors) {
      expect(coauthor.mergedIds).toEqual([]);
      expect(coauthor.mergedBy).toBeNull();
    }
  });

  it('機関を 1 つも共有しない同姓同名は統合しない', () => {
    const { coauthors } = mergeCoauthors([
      record('A1', 'Wei Zhang', { dois: ['10.1/a'], institutionIds: ['I1'] }),
      record('A2', 'Wei Zhang', { dois: ['10.1/b'], institutionIds: ['I2'] }),
    ]);
    expect(coauthors).toHaveLength(2);
  });

  it('所属が取れていない同姓同名も統合しない（機関の共有が無いので）', () => {
    const { coauthors } = mergeCoauthors([
      record('A1', 'Wei Zhang', { dois: ['10.1/a'] }),
      record('A2', 'Wei Zhang', { dois: ['10.1/b'] }),
    ]);
    expect(coauthors).toHaveLength(2);
  });

  it('氏名が違えば機関を共有していても統合しない', () => {
    const { coauthors } = mergeCoauthors([
      record('A1', 'Wei Zhang', { dois: ['10.1/a'], institutionIds: ['I1'] }),
      record('A2', 'Yan Luo', { dois: ['10.1/b'], institutionIds: ['I1'] }),
    ]);
    expect(coauthors).toHaveLength(2);
  });

  it('ORCID が一致すれば同居していても統合する（ORCID は例外なし）', () => {
    const { coauthors } = mergeCoauthors([
      record('A1', 'Wei Zhang', {
        orcid: 'https://orcid.org/0000-0002-1825-0097',
        dois: ['10.1/a'],
      }),
      record('A2', 'W. Zhang', {
        orcid: 'HTTPS://ORCID.ORG/0000-0002-1825-0097',
        dois: ['10.1/a'],
      }),
    ]);
    expect(coauthors).toHaveLength(1);
    expect(coauthors[0].mergedBy).toBe('orcid');
  });
});

describe('統合後の代表レコード', () => {
  it('論文数が最大のレコードを代表にする', () => {
    const { coauthors } = mergeCoauthors([
      record('A9', 'Wei Zhang', { dois: ['10.1/a'], institutionIds: ['I1'] }),
      record('A1', 'Wei Zhang', {
        dois: ['10.1/b', '10.1/c'],
        institutionIds: ['I1', 'I2'],
      }),
    ]);
    expect(coauthors).toHaveLength(1);
    expect(coauthors[0].id).toBe('https://openalex.org/A1');
    // dois / institutionIds は和集合。代表の順を先に、残りを後置。
    expect(coauthors[0].dois).toEqual(['10.1/b', '10.1/c', '10.1/a']);
    expect(coauthors[0].institutionIds).toEqual([
      'https://openalex.org/I1',
      'https://openalex.org/I2',
    ]);
    expect(coauthors[0].paperCount).toBe(3);
    expect(coauthors[0].mergedIds).toEqual(['https://openalex.org/A9']);
    expect(coauthors[0].mergedBy).toBe('name');
  });

  it('論文数が同じなら著者 ID の昇順で最小を代表にする', () => {
    const { coauthors } = mergeCoauthors([
      record('A9', 'Wei Zhang', { dois: ['10.1/a'], institutionIds: ['I1'] }),
      record('A1', 'Wei Zhang', { dois: ['10.1/b'], institutionIds: ['I1'] }),
    ]);
    expect(coauthors[0].id).toBe('https://openalex.org/A1');
    expect(coauthors[0].mergedIds).toEqual(['https://openalex.org/A9']);
  });

  it('ORCID と氏名の両方で繋がった群は根拠を orcid にする', () => {
    const { coauthors } = mergeCoauthors([
      record('A1', 'Wei Zhang', {
        orcid: 'https://orcid.org/0000-0002-1825-0097',
        dois: ['10.1/a', '10.1/b'],
        institutionIds: ['I1'],
      }),
      record('A2', 'Wei Zhang', { dois: ['10.1/c'], institutionIds: ['I1'] }),
      record('A3', 'Wei Zhang', {
        orcid: 'https://orcid.org/0000-0002-1825-0097',
        dois: ['10.1/d'],
        institutionIds: ['I1'],
      }),
    ]);
    expect(coauthors).toHaveLength(1);
    expect(coauthors[0].mergedBy).toBe('orcid');
    expect(coauthors[0].mergedIds).toHaveLength(2);
  });
});

describe('URL クエリ `merge=`', () => {
  it('パラメータ無し（既定 URL）なら統合が効く', () => {
    expect(DEFAULTS.merge).toBe(true);
    expect(readStateFromUrl('').merge).toBe(true);
    expect(readStateFromUrl('?orcid=0000-0003-1317-0220').merge).toBe(true);
  });

  it('off / orcid を読める', () => {
    expect(readStateFromUrl('?merge=off').merge).toBe(false);
    expect(readStateFromUrl('?merge=orcid').merge).toBe('orcid');
    // 知らない値は既定（統合する）に落とす。
    expect(readStateFromUrl('?merge=wat').merge).toBe(true);
  });

  it('既定のときは URL に書かない', () => {
    const base = { orcid: 'X', rm: '', center: DEFAULTS.center };
    expect(stateToQuery({ ...base, merge: true }, undefined)).not.toContain(
      'merge',
    );
    expect(stateToQuery({ ...base, merge: false }, undefined)).toContain(
      'merge=off',
    );
    expect(stateToQuery({ ...base, merge: 'orcid' }, undefined)).toContain(
      'merge=orcid',
    );
  });

  it('URL を往復しても値が変わらない', () => {
    for (const value of [true, false, 'orcid']) {
      const query = stateToQuery(
        { orcid: 'X', rm: '', center: DEFAULTS.center, merge: value },
        undefined,
      );
      expect(readStateFromUrl(`?${query}`).merge).toBe(value);
    }
  });
});

describe('除外との組み合わせ', () => {
  it('代表を除外すると吸収されたレコードごと消える', async () => {
    const leucht = 'https://openalex.org/A5002251483';
    const dataset = await build({ curation: { excludeAuthorIds: [leucht] } });
    expect(dataset.coauthors.has(leucht)).toBe(false);
    expect(dataset.coauthors.has('https://openalex.org/A5136768910')).toBe(
      false,
    );
    expect(dataset.coauthors.has('https://openalex.org/A5130715978')).toBe(
      false,
    );
    // 3 レコード分がまとめて消えるので、人数は 1 人だけ減る。
    expect(dataset.stats.coauthors).toBe(144);
  });
});
