/**
 * 「画面で直した状態が、埋め込みスニペットにそのまま入る」ことの凍結。
 *
 * 手直し（除外）と絞り込みは localStorage ではなく **URL** に載せる。
 * ここで確かめるのは 3 つ:
 *   1. 短縮形の往復（`xa=5030252459.5122799223` → OpenAlex ID に戻る）
 *   2. 既定値は URL に書かない（リンクを短く保つ）
 *   3. 生成したスニペットの `src` を widget 側で読み直すと**同じ地図**になる
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  DEFAULTS,
  applyCurationToState,
  countUnencodableIds,
  curationFromState,
  expandDois,
  expandOpenAlexIds,
  parseMinPapers,
  readStateFromUrl,
  shortenDois,
  shortenOpenAlexIds,
  stateToQuery,
} from '../src/ui/controls.js';
import {
  URL_WARN_LENGTH,
  buildSnippet,
  buildWidgetUrl,
} from '../src/ui/embed-snippet.js';
import {
  normalizeDataset,
  applyCuration,
  filterDataset,
} from '../src/ui/derive.js';
import { mergeCurations } from '../src/curation.js';

const snapshot = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/dataset-snapshot.json', import.meta.url)),
    'utf8',
  ),
);
const dataset = normalizeDataset(snapshot);
const RANGE = { from: 2019, to: 2026 };
const BOUNDS = { from: 2019, to: 2026 };

/** 論文数の多い共著者 2 人（除外の実例に使う） */
const TOP_AUTHORS = [...dataset.coauthors.values()]
  .filter((c) => typeof c.id === 'string')
  .sort((a, b) => b.paperCount - a.paperCount)
  .slice(0, 2)
  .map((c) => c.id);

/** その state で描かれる地図（都市キーと数字だけ取り出したもの） */
function mapOf(state) {
  const curated = applyCuration(dataset, curationFromState(state));
  const view = filterDataset(curated, RANGE, { minPapers: state.min });
  return view.cities.map((city) => ({
    key: city.key,
    papers: city.paperCount,
    coauthors: city.coauthorCount,
  }));
}

describe('ID の短縮形', () => {
  it('OpenAlex の著者 ID は接頭辞を落として並べる', () => {
    const ids = [
      'https://openalex.org/A5030252459',
      'https://openalex.org/A5122799223',
    ];
    expect(shortenOpenAlexIds(ids, 'A')).toBe('5030252459.5122799223');
    expect(expandOpenAlexIds('5030252459.5122799223', 'A')).toEqual(ids);
  });

  it('機関 ID も同じ形（接頭辞の文字だけ違う）', () => {
    const ids = ['https://openalex.org/I62916508'];
    expect(shortenOpenAlexIds(ids, 'I')).toBe('62916508');
    expect(expandOpenAlexIds('62916508', 'I')).toEqual(ids);
  });

  it('著者 ID が無い共著者は ORCID をキーにして載せる', () => {
    const ids = ['https://orcid.org/0009-0007-3985-2197'];
    expect(shortenOpenAlexIds(ids, 'A')).toBe('o0009-0007-3985-2197');
    expect(expandOpenAlexIds('o0009-0007-3985-2197', 'A')).toEqual(ids);
  });

  it('どちらでもないキーは載せられないので数えて知らせる', () => {
    expect(shortenOpenAlexIds(['name:Wei Zhang'], 'A')).toBe('');
    expect(countUnencodableIds(['name:Wei Zhang'], 'A')).toBe(1);
    expect(
      countUnencodableIds(['https://openalex.org/A1', 'name:Wei Zhang'], 'A'),
    ).toBe(1);
  });

  it('DOI は共通の 10. を落として並べる', () => {
    const dois = ['10.1016/j.eclinm.2026.103988', '10.1001/jama.2020.1'];
    expect(shortenDois(dois)).toBe(
      '1016/j.eclinm.2026.103988*1001/jama.2020.1',
    );
    expect(expandDois(shortenDois(dois))).toEqual(dois);
  });

  it('min= は 1 未満と数字でないものを 1 に落とす', () => {
    expect(parseMinPapers('3')).toBe(3);
    expect(parseMinPapers('0')).toBe(1);
    expect(parseMinPapers('wat')).toBe(1);
    expect(parseMinPapers(null)).toBe(1);
  });
});

describe('URL クエリ', () => {
  const base = () => ({ ...readStateFromUrl('') });

  it('既定は何も書かない（min / pin / orcidaff / 除外）', () => {
    const query = stateToQuery(base(), BOUNDS);
    for (const key of ['min', 'pin', 'orcidaff', 'xa', 'xi', 'xd'])
      expect(query).not.toContain(`${key}=`);
    expect(DEFAULTS.min).toBe(1);
    expect(DEFAULTS.pin).toBe('primary');
    expect(DEFAULTS.orcidaff).toBe(true);
  });

  it('絞り込みと除外を載せて、読み直すと同じ値に戻る', () => {
    const state = base();
    state.min = 3;
    state.xa = TOP_AUTHORS;
    state.xi = ['https://openalex.org/I62916508'];
    state.xd = ['10.1016/j.eclinm.2026.103988'];
    state.pin = 'all';
    state.orcidaff = false;

    const query = stateToQuery(state, BOUNDS);
    expect(query).toContain('min=3');
    expect(query).toContain('pin=all');
    expect(query).toContain('orcidaff=off');

    const restored = readStateFromUrl(`?${query}`);
    expect(restored.min).toBe(3);
    expect(restored.xa).toEqual(state.xa);
    expect(restored.xi).toEqual(state.xi);
    expect(restored.xd).toEqual(state.xd);
    expect(restored.pin).toBe('all');
    expect(restored.orcidaff).toBe(false);
  });

  it('手直しを state に書き戻す経路がある（スニペットに反映させるため）', () => {
    const state = base();
    applyCurationToState(state, {
      excludeAuthorIds: TOP_AUTHORS,
      excludeInstitutionIds: ['https://openalex.org/I62916508'],
      excludeDois: ['10.1016/j.eclinm.2026.103988'],
      addDois: [],
      mergeInstitutions: {},
    });
    expect(stateToQuery(state, BOUNDS)).toContain('xa=');
    // 往復して Curation に戻せる
    const curation = curationFromState(
      readStateFromUrl(`?${stateToQuery(state, BOUNDS)}`),
    );
    expect(curation.excludeAuthorIds).toEqual(TOP_AUTHORS);
    // 既存の手直しと重ねられる
    const merged = mergeCurations({ excludeDois: ['10.9999/other'] }, curation);
    expect(merged.excludeAuthorIds).toEqual(TOP_AUTHORS);
    expect(merged.excludeDois).toContain('10.9999/other');
  });
});

describe('埋め込みスニペット', () => {
  it('補正した状態の src を widget 側で読み直すと同じ地図になる', () => {
    const state = readStateFromUrl('');
    state.min = 2;
    state.xa = TOP_AUTHORS;

    const src = buildWidgetUrl(state, BOUNDS);
    const snippet = buildSnippet(src, 720);
    expect(snippet).toContain(`src="${src}"`);
    expect(src).toContain('min=2');
    expect(src).toContain('xa=');

    // widget.html は同じ readStateFromUrl でクエリを読む
    const widgetState = readStateFromUrl(src.slice(src.indexOf('?')));
    expect(widgetState.min).toBe(2);
    expect(widgetState.xa).toEqual(TOP_AUTHORS);

    const expected = mapOf(state);
    expect(mapOf(widgetState)).toEqual(expected);
    // 除外した人は地図から消えている
    const idsOnMap = new Set(
      applyCuration(dataset, curationFromState(widgetState))
        .cities.flatMap((c) => c.coauthors)
        .map((c) => c.id),
    );
    for (const id of TOP_AUTHORS) expect(idsOnMap.has(id)).toBe(false);
  });

  it('警告の閾値は 1800 文字（黙って切り捨てない）', () => {
    expect(URL_WARN_LENGTH).toBe(1800);
    const state = readStateFromUrl('');
    // 除外を大量に積むと閾値を超える
    state.xa = [...dataset.coauthors.values()]
      .filter((c) => typeof c.id === 'string')
      .map((c) => c.id);
    state.xi = [...dataset.institutions.keys()];
    expect(buildWidgetUrl(state, BOUNDS).length).toBeGreaterThan(
      URL_WARN_LENGTH,
    );
    // 既定の地図は十分短い
    expect(buildWidgetUrl(readStateFromUrl(''), BOUNDS).length).toBeLessThan(
      URL_WARN_LENGTH,
    );
  });
});

describe('Main collaborations の絞り込み', () => {
  it('min= の下限が地図・統計の両方に効く', () => {
    const all = filterDataset(dataset, RANGE, { minPapers: 1 });
    const main = filterDataset(dataset, RANGE, { minPapers: 3 });
    expect(all.summary.coauthors).toBe(143);
    expect(main.summary.coauthors).toBe(27);
    // 母数は絞り込み前の全共著者数
    expect(main.summary.coauthorsTotal).toBe(145);
    // 都市の論文数も残った人の和集合に揃う
    expect(main.summary.papers).toBeLessThan(all.summary.papers);
    for (const city of main.cities) {
      const union = new Set(city.coauthors.flatMap((c) => c.dois));
      for (const doi of city.dois) expect(union.has(doi)).toBe(true);
      expect(city.paperCount).toBe(city.dois.length);
      for (const coauthor of city.coauthors)
        expect(coauthor.paperCount).toBeGreaterThanOrEqual(3);
    }
  });

  it('除外した人は都市からもピンの大きさからも消える', () => {
    const target = [...dataset.coauthors.values()]
      .filter((c) => typeof c.id === 'string')
      .sort((a, b) => b.paperCount - a.paperCount)[0];
    const before = filterDataset(dataset, RANGE, { minPapers: 1 });
    const curated = applyCuration(dataset, {
      excludeDois: [],
      excludeAuthorIds: [target.id],
      excludeInstitutionIds: [],
      addDois: [],
      mergeInstitutions: {},
    });
    const after = filterDataset(curated, RANGE, { minPapers: 1 });
    expect(after.summary.coauthors).toBe(before.summary.coauthors - 1);
    for (const city of after.cities)
      expect(city.coauthors.some((c) => c.id === target.id)).toBe(false);
  });
});
