import { describe, expect, it, vi } from 'vitest';

import {
  chunk,
  fetchInstitutions,
  fetchWorksByDois,
  joinFilterValues,
  requestOpenAlex,
  shortOpenAlexId,
} from '../src/openalex.js';
import {
  createFixtureFetch,
  jsonResponse,
  loadFixture,
} from './helpers/stub-fetch.js';

/** snapshot と同じ 34 件の DOI。 */
const dois = loadFixture('dataset-snapshot.json').works.map((work) => work.doi);

/** fixture に入っている 120 機関の ID。 */
const institutionIds = loadFixture('openalex-institutions-pages.json')
  .flatMap((page) => page.results)
  .map((institution) => institution.id);

describe('バッチ分割', () => {
  it('34 DOI は 25 件ずつ 2 リクエストに割れる', async () => {
    const { fetchImpl, calls } = createFixtureFetch();
    const works = await fetchWorksByDois(dois, {
      fetchImpl,
      mailto: 'test@example.org',
    });

    expect(calls).toHaveLength(2);
    expect(works).toHaveLength(34);

    const filters = calls.map((url) => url.match(/filter=doi:(.*)$/)[1]);
    expect(filters[0].split('|')).toHaveLength(25);
    expect(filters[1].split('|')).toHaveLength(9);
  });

  it('120 機関は 50 件ずつ 3 リクエストに割れる', async () => {
    const { fetchImpl, calls } = createFixtureFetch();
    const institutions = await fetchInstitutions(institutionIds, {
      fetchImpl,
      mailto: 'test@example.org',
    });

    expect(calls).toHaveLength(3);
    expect(institutions).toHaveLength(120);

    const filters = calls.map(
      (url) => url.match(/filter=ids\.openalex:(.*)$/)[1],
    );
    expect(filters.map((filter) => filter.split('|').length)).toEqual([
      50, 50, 20,
    ]);
    // ID は URL 末尾のセグメントを使う。
    expect(filters[0].split('|')[0]).toMatch(/^I\d+$/);
  });

  it('chunk は端数を最後のバッチに残す', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  it('shortOpenAlexId は URL 末尾のセグメントを返す', () => {
    expect(shortOpenAlexId('https://openalex.org/I62916508')).toBe('I62916508');
    expect(shortOpenAlexId('I62916508')).toBe('I62916508');
  });
});

describe('URL の組み立て', () => {
  it('区切りの | はエンコードしない（DOI 個々はエンコードする）', () => {
    const filter = joinFilterValues([
      '10.1016/j.eclinm.2026.103988',
      '10.1002/1348-9585.12097',
    ]);
    expect(filter).toContain('|');
    expect(filter).not.toContain('%7C');
    // DOI 内のスラッシュはエンコードされる。
    expect(filter).toBe(
      '10.1016%2Fj.eclinm.2026.103988|10.1002%2F1348-9585.12097',
    );
  });

  it('全リクエストに mailto が付く（polite pool）', async () => {
    const { fetchImpl, calls } = createFixtureFetch();
    await fetchWorksByDois(dois, { fetchImpl, mailto: 'me@example.org' });
    await fetchInstitutions(institutionIds, {
      fetchImpl,
      mailto: 'me@example.org',
    });
    expect(calls).toHaveLength(5);
    expect(calls.every((url) => url.includes('mailto=me%40example.org'))).toBe(
      true,
    );
  });

  it('institutions の select に ror が入る', async () => {
    const { fetchImpl, calls } = createFixtureFetch();
    await fetchInstitutions(institutionIds.slice(0, 3), { fetchImpl });
    expect(calls[0]).toContain(
      'select=id,display_name,country_code,type,geo,ror',
    );
  });

  it('リクエストは直列に流す', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return jsonResponse({ results: [] });
    };
    await fetchInstitutions(institutionIds, { fetchImpl });
    expect(maxInFlight).toBe(1);
  });
});

describe('リトライ', () => {
  it('429 は指数バックオフでリトライして成功する', async () => {
    const sleeps = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'ok' }] }));

    const payload = await requestOpenAlex('https://api.openalex.org/works', {
      fetchImpl,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([500, 1000]);
    expect(payload.results).toHaveLength(1);
  });

  it('5xx もリトライし、上限を超えたら投げる（最大 3 回）', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    await expect(
      requestOpenAlex('https://api.openalex.org/works', {
        fetchImpl,
        sleepImpl: async () => {},
      }),
    ).rejects.toThrow(/HTTP 503/);
    // 初回 + リトライ 3 回。
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('429 以外の 4xx は即エラー', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 403));
    await expect(
      requestOpenAlex('https://api.openalex.org/works', {
        fetchImpl,
        sleepImpl: async () => {},
      }),
    ).rejects.toThrow(/HTTP 403/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('onProgress', () => {
  it('バッチごとに呼ばれる', async () => {
    const { fetchImpl } = createFixtureFetch();
    /** @type {Array<[string, number, number]>} */
    const events = [];
    await fetchWorksByDois(dois, {
      fetchImpl,
      onProgress: (msg, done, total) => events.push([msg, done, total]),
    });
    expect(events).toEqual([
      ['OpenAlex から論文情報を取得中', 0, 2],
      ['OpenAlex から論文情報を取得中', 1, 2],
      ['OpenAlex から論文情報を取得中', 2, 2],
    ]);
  });
});
