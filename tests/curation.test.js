import { describe, expect, it } from 'vitest';

import {
  emptyCuration,
  exportCuration,
  importCuration,
  loadCommittedCuration,
  mergeCurations,
  normalizeCuration,
} from '../src/curation.js';
import { aggregate } from '../src/aggregate.js';
import { jsonResponse, loadFixture } from './helpers/stub-fetch.js';

const openAlexWorks = loadFixture('openalex-works-pages.json').flatMap(
  (page) => page.results,
);
const rawInstitutions = loadFixture('openalex-institutions-pages.json').flatMap(
  (page) => page.results,
);
const seedWorks = loadFixture('dataset-snapshot.json').works;

/**
 * @param {Partial<import('../src/types.js').Curation>} curation
 */
function run(curation) {
  return aggregate({
    seedWorks,
    openAlexWorks,
    institutions: rawInstitutions,
    seedOrcid: '0000-0003-1317-0220',
    curation,
  });
}

describe('normalizeCuration', () => {
  it('未知のキーを捨て、DOI を正規化し、重複を落とす', () => {
    const curation = normalizeCuration({
      excludeDois: ['https://doi.org/10.1/A', '10.1/a', ' 10.2/B '],
      excludeAuthorIds: ['https://openalex.org/A1'],
      addDois: ['DOI:10.3/c'],
      mergeInstitutions: {
        'https://openalex.org/I1': 'https://openalex.org/I2',
      },
      somethingElse: 'ignored',
      excludeInstitutionIds: 'not-an-array',
    });

    expect(curation).toEqual({
      excludeDois: ['10.1/a', '10.2/b'],
      excludeAuthorIds: ['https://openalex.org/A1'],
      excludeInstitutionIds: [],
      addDois: ['10.3/c'],
      mergeInstitutions: {
        'https://openalex.org/I1': 'https://openalex.org/I2',
      },
    });
    expect('somethingElse' in curation).toBe(false);
  });

  it('自分自身への統合は捨てる', () => {
    expect(
      normalizeCuration({ mergeInstitutions: { I1: 'I1' } }).mergeInstitutions,
    ).toEqual({});
  });
});

describe('mergeCurations', () => {
  it('既定値を埋めつつ配列を結合し、mergeInstitutions は後勝ち', () => {
    const merged = mergeCurations(
      { excludeDois: ['10.1/a'], mergeInstitutions: { I1: 'I2' } },
      {
        excludeDois: ['10.1/a', '10.2/b'],
        mergeInstitutions: { I1: 'I3', I4: 'I5' },
      },
      null,
      undefined,
    );
    expect(merged.excludeDois).toEqual(['10.1/a', '10.2/b']);
    expect(merged.mergeInstitutions).toEqual({ I1: 'I3', I4: 'I5' });
    expect(merged.addDois).toEqual([]);
    expect(merged.excludeInstitutionIds).toEqual([]);
  });

  it('引数なしなら空の Curation', () => {
    expect(mergeCurations()).toEqual(emptyCuration());
  });
});

describe('loadCommittedCuration', () => {
  it('commit 済み JSON を読む', async () => {
    const fetchImpl = async (url) => {
      expect(String(url)).toBe('./curation/0000-0003-1317-0220.json');
      return jsonResponse({ excludeDois: ['10.1/a'] });
    };
    const curation = await loadCommittedCuration('0000-0003-1317-0220', {
      fetchImpl,
    });
    expect(curation.excludeDois).toEqual(['10.1/a']);
  });

  it('404 は空の Curation（エラーにしない）', async () => {
    const fetchImpl = async () => jsonResponse({}, 404);
    await expect(
      loadCommittedCuration('0000-0000-0000-0000', { fetchImpl }),
    ).resolves.toEqual(emptyCuration());
  });

  it('ネットワーク例外も空の Curation', async () => {
    const fetchImpl = async () => {
      throw new Error('offline');
    };
    await expect(
      loadCommittedCuration('0000-0000-0000-0000', { fetchImpl }),
    ).resolves.toEqual(emptyCuration());
  });
});

describe('JSON 入出力の往復', () => {
  it('exportCuration → importCuration で元に戻る', () => {
    const curation = normalizeCuration({
      excludeDois: ['10.1/a'],
      excludeAuthorIds: ['https://openalex.org/A1'],
      excludeInstitutionIds: ['https://openalex.org/I1'],
      addDois: ['10.2/b'],
      mergeInstitutions: {
        'https://openalex.org/I2': 'https://openalex.org/I3',
      },
    });
    expect(importCuration(exportCuration(curation))).toEqual(curation);
  });

  it('取り込み時に未知のキーを捨てる', () => {
    const imported = importCuration('{"excludeDois":["10.1/A"],"evil":"x"}');
    expect(imported.excludeDois).toEqual(['10.1/a']);
    expect('evil' in imported).toBe(false);
  });

  it('壊れた JSON・配列は Error', () => {
    expect(() => importCuration('{')).toThrow(/Could not parse/);
    expect(() => importCuration('[]')).toThrow(/must be an object/);
    expect(() => importCuration(null)).toThrow(/must be an object/);
  });
});

describe('curation の適用', () => {
  it('excludeDois は seed から論文を落とす', () => {
    const base = run({});
    const filtered = run({
      excludeDois: ['https://doi.org/10.1001/JAMA.2020.12660'],
    });
    expect(base.stats.seedWorks).toBe(34);
    expect(filtered.stats.seedWorks).toBe(33);
    expect(
      filtered.works.some((work) => work.doi === '10.1001/jama.2020.12660'),
    ).toBe(false);
  });

  it('addDois は seed に論文を足す（未突合なら unmatchedDois に出る）', () => {
    const dataset = run({ addDois: ['10.9999/not-in-openalex'] });
    expect(dataset.stats.seedWorks).toBe(35);
    expect(dataset.stats.matchedWorks).toBe(34);
    expect(dataset.stats.unmatchedDois).toEqual(['10.9999/not-in-openalex']);
    expect(
      dataset.works.find((work) => work.doi === '10.9999/not-in-openalex')
        .sources,
    ).toEqual(['manual']);
  });

  it('excludeAuthorIds は共著者を落とす', () => {
    const base = run({});
    const target = [...base.coauthors.values()][0];
    const filtered = run({ excludeAuthorIds: [target.id] });
    expect(filtered.stats.coauthors).toBe(base.stats.coauthors - 1);
    expect(filtered.coauthors.has(target.id)).toBe(false);
  });

  it('mergeInstitutions は機関 ID を置換する', () => {
    // 東大病院を東大本体に寄せる。
    const hospital = 'https://openalex.org/I4210109338';
    const university = 'https://openalex.org/I74801974';
    const base = run({});
    const merged = run({ mergeInstitutions: { [hospital]: university } });

    expect(base.institutions.has(hospital)).toBe(true);
    expect(merged.institutions.has(hospital)).toBe(false);
    expect(merged.institutions.has(university)).toBe(true);
    expect(merged.stats.institutions).toBe(base.stats.institutions - 1);
    for (const coauthor of merged.coauthors.values()) {
      expect(coauthor.institutionIds).not.toContain(hospital);
    }
  });

  it('excludeInstitutionIds は機関を落とす', () => {
    const university = 'https://openalex.org/I74801974';
    const base = run({});
    const filtered = run({ excludeInstitutionIds: [university] });
    expect(base.institutions.has(university)).toBe(true);
    expect(filtered.institutions.has(university)).toBe(false);
  });

  it('統合してから除外する（適用順）', () => {
    const hospital = 'https://openalex.org/I4210109338';
    const university = 'https://openalex.org/I74801974';
    // 統合先を除外すると、統合元由来の紐付けもまとめて消える。
    const dataset = run({
      mergeInstitutions: { [hospital]: university },
      excludeInstitutionIds: [university],
    });
    expect(dataset.institutions.has(hospital)).toBe(false);
    expect(dataset.institutions.has(university)).toBe(false);
  });
});
