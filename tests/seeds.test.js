import { describe, expect, it } from 'vitest';

import {
  fetchOrcidWorks,
  assertValidOrcid,
  normalizeOrcid,
} from '../src/seeds/orcid.js';
import {
  fetchResearchmapWorks,
  parsePublicationYear,
  pickLocalizedText,
} from '../src/seeds/researchmap.js';
import { unionSeedWorks } from '../src/aggregate.js';
import { createFixtureFetch, jsonResponse } from './helpers/stub-fetch.js';

describe('fetchOrcidWorks', () => {
  it('fixture から 34 件の SeedWork を取り出す', async () => {
    const { fetchImpl, calls } = createFixtureFetch();
    const works = await fetchOrcidWorks('0000-0003-1317-0220', { fetchImpl });

    expect(works).toHaveLength(34);
    expect(calls[0]).toBe(
      'https://pub.orcid.org/v3.0/0000-0003-1317-0220/works',
    );
    for (const work of works) {
      expect(work.sources).toEqual(['orcid']);
      expect(work.doi).toBe(work.doi.toLowerCase());
      expect(work.doi.startsWith('10.')).toBe(true);
    }
    expect(works.some((work) => work.year === 2026)).toBe(true);
    expect(works.every((work) => work.title !== null)).toBe(true);
  });

  it('DOI が無い group はスキップする', async () => {
    const fetchImpl = async () =>
      jsonResponse({
        group: [
          { 'work-summary': [{ title: { title: { value: 'no doi' } } }] },
          {
            'external-ids': {
              'external-id': [
                { 'external-id-type': 'isbn', 'external-id-value': '978' },
                {
                  'external-id-type': 'doi',
                  'external-id-value': 'https://doi.org/10.1/A',
                },
              ],
            },
            'work-summary': [
              {
                title: { title: { value: 'ok' } },
                'publication-date': { year: { value: '2024' } },
              },
            ],
          },
        ],
      });
    const works = await fetchOrcidWorks('0000-0003-1317-0220', { fetchImpl });
    expect(works).toEqual([
      { doi: '10.1/a', year: 2024, title: 'ok', sources: ['orcid'] },
    ]);
  });

  it('ORCID の形式を検証する', () => {
    expect(assertValidOrcid('0000-0003-1317-0220')).toBe('0000-0003-1317-0220');
    expect(assertValidOrcid('https://orcid.org/0000-0002-1825-009x')).toBe(
      '0000-0002-1825-009X',
    );
    expect(normalizeOrcid(' 0000-0002-1825-009x ')).toBe('0000-0002-1825-009X');

    expect(() => assertValidOrcid('0000-0003-1317-022')).toThrow(/not a valid ORCID iD/);
    expect(() => assertValidOrcid('0000000313170220')).toThrow(/not a valid ORCID iD/);
    expect(() => assertValidOrcid('0000-0003-1317-02X0')).toThrow(/not a valid ORCID iD/);
    expect(() => assertValidOrcid('')).toThrow(/not a valid ORCID iD/);
  });
});

describe('fetchResearchmapWorks', () => {
  it('fixture から 25 件の SeedWork を取り出す', async () => {
    const { fetchImpl, calls } = createFixtureFetch();
    const works = await fetchResearchmapWorks('yk_frkw', { fetchImpl });

    expect(works).toHaveLength(25);
    // limit を明示しないと既定 25 件で黙って切れる。
    expect(calls[0]).toBe(
      'https://api.researchmap.jp/yk_frkw/published_papers?limit=200&start=1',
    );
    for (const work of works) {
      expect(work.sources).toEqual(['researchmap']);
      expect(work.doi.startsWith('10.')).toBe(true);
    }
  });

  it('total_items に足りなければ start を進めてページングする', async () => {
    /** @type {string[]} */
    const calls = [];
    const makeItem = (n) => ({
      paper_title: { en: `paper ${n}` },
      publication_date: '2024-05-01',
      identifiers: { doi: [`10.1/${n}`] },
    });
    const fetchImpl = async (url) => {
      calls.push(String(url));
      const start = Number(new URL(String(url)).searchParams.get('start'));
      const items = start === 1 ? [makeItem(1), makeItem(2)] : [makeItem(3)];
      return jsonResponse({ total_items: 3, items });
    };

    const works = await fetchResearchmapWorks('yk_frkw', {
      fetchImpl,
      pageSize: 2,
    });
    expect(works.map((work) => work.doi)).toEqual([
      '10.1/1',
      '10.1/2',
      '10.1/3',
    ]);
    expect(calls).toEqual([
      'https://api.researchmap.jp/yk_frkw/published_papers?limit=2&start=1',
      'https://api.researchmap.jp/yk_frkw/published_papers?limit=2&start=3',
    ]);
  });

  it('publication_date は YYYY / YYYY-MM / YYYY-MM-DD を受ける', () => {
    expect(parsePublicationYear('2019')).toBe(2019);
    expect(parsePublicationYear('2020-06')).toBe(2020);
    expect(parsePublicationYear('2021-06-15')).toBe(2021);
    expect(parsePublicationYear(null)).toBeNull();
  });

  it('paper_title は en を優先する', () => {
    expect(pickLocalizedText({ en: 'English', ja: '日本語' })).toBe('English');
    expect(pickLocalizedText({ ja: '日本語' })).toBe('日本語');
    expect(pickLocalizedText('plain')).toBe('plain');
    expect(pickLocalizedText(null)).toBeNull();
  });
});

describe('seed の和集合', () => {
  it('researchmap は ORCID の部分集合で、和集合は 34 件', async () => {
    const { fetchImpl } = createFixtureFetch();
    const orcidWorks = await fetchOrcidWorks('0000-0003-1317-0220', {
      fetchImpl,
    });
    const researchmapWorks = await fetchResearchmapWorks('yk_frkw', {
      fetchImpl,
    });

    expect(orcidWorks).toHaveLength(34);
    expect(researchmapWorks).toHaveLength(25);

    const orcidDois = new Set(orcidWorks.map((work) => work.doi));
    expect(researchmapWorks.every((work) => orcidDois.has(work.doi))).toBe(
      true,
    );

    const union = unionSeedWorks([orcidWorks, researchmapWorks]);
    expect(union).toHaveLength(34);

    // 両方から来た DOI は sources が結合される。
    const shared = union.filter((work) => work.sources.length === 2);
    expect(shared).toHaveLength(25);
    expect(shared[0].sources).toEqual(['orcid', 'researchmap']);

    // DOI 昇順で返る。
    expect(union.map((work) => work.doi)).toEqual(
      [...union.map((work) => work.doi)].sort(),
    );
  });
});
