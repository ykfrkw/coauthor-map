/**
 * 地図データの解像度の出し分け。
 *
 * 見たいのは「いつ 739KB を取りに行くか」なので、fetch はすべてスタブにして
 * **呼ばれた URL の列**を見る。ネットワークには一切触らない。
 *
 * 描画側（render.js）は DOM を必要とするのでここでは動かさない。代わりに
 * render.js が実際に使う 2 つの部品——`resolutionFor`（どの解像度が要るか）と
 * `createAtlasProvider`（取得と差し替え）——を、描画側と同じ順序で叩く。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HIGH_RES_SCALE_RATIO,
  RESOLUTION_HIGH,
  RESOLUTION_LOW,
  atlasUrl,
  createAtlasProvider,
  parseAtlas,
  resolutionFor,
} from '../src/map/atlas.js';
import {
  SCOPE_COUNTRY,
  SCOPE_REGION,
  SCOPE_WORLD,
  resolveFit,
  createCountryLocator,
} from '../src/map/scope.js';

const read = (rel) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'),
  );

/** copy:atlas が public/ に置く実物（pretest で必ず揃う） */
const TOPO = {
  [RESOLUTION_LOW]: read('../public/countries-110m.json'),
  [RESOLUTION_HIGH]: read('../public/countries-50m.json'),
};

/**
 * 解像度ごとに実物を返すスタブ。呼ばれた URL を記録する。
 * @param {Object} [opts]
 * @param {string[]} [opts.fail] 失敗させる解像度
 */
function stubProvider({ fail = [] } = {}) {
  /** @type {string[]} */
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const hit = [RESOLUTION_HIGH, RESOLUTION_LOW].find((r) =>
      String(url).includes(`countries-${r}.json`),
    );
    if (!hit || fail.includes(hit)) return { ok: false, status: 500 };
    return { ok: true, status: 200, json: async () => TOPO[hit] };
  };
  const provider = createAtlasProvider({ fetchImpl, baseUrl: '/base/' });
  return { provider, calls };
}

/** 取得の失敗は console.warn に残るだけ。テスト出力を汚さないよう黙らせる */
function muteWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('解像度の決め方', () => {
  it('世界表示の等倍は 110m', () => {
    expect(resolutionFor({ scope: SCOPE_WORLD, scaleRatio: 1 })).toBe(
      RESOLUTION_LOW,
    );
    // スコープが未解決（atlas 到着前）のときも 110m
    expect(resolutionFor({})).toBe(RESOLUTION_LOW);
    expect(resolutionFor({ scope: null, scaleRatio: 1 })).toBe(RESOLUTION_LOW);
  });

  it('国 / 地域にフィットしたら 50m', () => {
    expect(resolutionFor({ scope: SCOPE_COUNTRY, scaleRatio: 1 })).toBe(
      RESOLUTION_HIGH,
    );
    expect(resolutionFor({ scope: SCOPE_REGION, scaleRatio: 1 })).toBe(
      RESOLUTION_HIGH,
    );
  });

  it('世界表示でも初期スケールの 3 倍を超えたら 50m', () => {
    expect(HIGH_RES_SCALE_RATIO).toBe(3);
    const at = (k) => resolutionFor({ scope: SCOPE_WORLD, scaleRatio: k });
    expect(at(2.9)).toBe(RESOLUTION_LOW);
    expect(at(3)).toBe(RESOLUTION_LOW);
    expect(at(3.01)).toBe(RESOLUTION_HIGH);
    expect(at(14)).toBe(RESOLUTION_HIGH);
  });

  it('壊れた倍率は 110m に倒す', () => {
    expect(resolutionFor({ scope: SCOPE_WORLD, scaleRatio: NaN })).toBe(
      RESOLUTION_LOW,
    );
    expect(resolutionFor({ scope: SCOPE_WORLD, scaleRatio: undefined })).toBe(
      RESOLUTION_LOW,
    );
  });

  it('URL は base 付きで組み立てる', () => {
    expect(atlasUrl(RESOLUTION_LOW, '/coauthor-map/')).toBe(
      '/coauthor-map/countries-110m.json',
    );
    expect(atlasUrl(RESOLUTION_HIGH)).toBe('countries-50m.json');
  });
});

describe('atlas の取得', () => {
  it('世界表示の初期読み込みでは 50m を取りに行かない', async () => {
    const { provider, calls } = stubProvider();

    // 描画側と同じ順序: まず 110m、次にそのときの表示に見合う解像度
    await provider.ensure(RESOLUTION_LOW);
    await provider.ensure(resolutionFor({ scope: SCOPE_WORLD, scaleRatio: 1 }));

    expect(calls).toEqual(['/base/countries-110m.json']);
    expect(provider.resolution).toBe(RESOLUTION_LOW);
    expect(provider.atlas.land.features.length).toBeGreaterThan(0);
  });

  it('country スコープでは 50m を 1 回だけ取りに行く', async () => {
    const { provider, calls } = stubProvider();
    await provider.ensure(RESOLUTION_LOW);

    const want = resolutionFor({ scope: SCOPE_COUNTRY, scaleRatio: 1 });
    expect(await provider.ensure(want)).toBe(true);
    expect(provider.resolution).toBe(RESOLUTION_HIGH);

    // 年スライダーやテーマ切替で何度描き直しても、二度目は投げない
    for (let i = 0; i < 5; i += 1) {
      expect(await provider.ensure(want)).toBe(false);
    }
    expect(calls).toEqual([
      '/base/countries-110m.json',
      '/base/countries-50m.json',
    ]);
  });

  it('同時に頼んでも取得は 1 回（読み込み中の重複を潰す）', async () => {
    const { provider, calls } = stubProvider();
    await provider.ensure(RESOLUTION_LOW);
    const results = await Promise.all([
      provider.ensure(RESOLUTION_HIGH),
      provider.ensure(RESOLUTION_HIGH),
      provider.ensure(RESOLUTION_HIGH),
    ]);
    // 差し替えたと答えるのは 1 つだけ
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(calls.filter((u) => u.includes('50m'))).toHaveLength(1);
  });

  it('50m が取れなくても 110m のまま動き続ける', async () => {
    const warn = muteWarn();
    const { provider, calls } = stubProvider({ fail: [RESOLUTION_HIGH] });

    await provider.ensure(RESOLUTION_LOW);
    const before = provider.atlas;

    // 投げない。false を返すだけ
    await expect(provider.ensure(RESOLUTION_HIGH)).resolves.toBe(false);
    expect(provider.atlas).toBe(before);
    expect(provider.resolution).toBe(RESOLUTION_LOW);
    expect(warn).toHaveBeenCalled();

    // 失敗を覚えているので、二度目以降も取りに行かない
    await provider.ensure(RESOLUTION_HIGH);
    expect(calls.filter((u) => u.includes('50m'))).toHaveLength(1);
  });

  it('110m すら取れなければ atlas は null のまま（描画側は陸を描かない）', async () => {
    const warn = muteWarn();
    const { provider } = stubProvider({ fail: [RESOLUTION_LOW] });
    await expect(provider.ensure(RESOLUTION_LOW)).resolves.toBe(false);
    expect(provider.atlas).toBeNull();
    expect(provider.resolution).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('一度上げた解像度は下げない', async () => {
    const { provider, calls } = stubProvider();
    await provider.ensure(RESOLUTION_LOW);
    await provider.ensure(RESOLUTION_HIGH);
    const high = provider.atlas;

    expect(await provider.ensure(RESOLUTION_LOW)).toBe(false);
    expect(provider.atlas).toBe(high);
    expect(provider.resolution).toBe(RESOLUTION_HIGH);
    expect(calls).toHaveLength(2);
  });

  it('知らない解像度は無視する', async () => {
    const { provider, calls } = stubProvider();
    expect(await provider.ensure('10m')).toBe(false);
    expect(await provider.ensure(undefined)).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('50m の中身', () => {
  const low = parseAtlas(TOPO[RESOLUTION_LOW]);
  const high = parseAtlas(TOPO[RESOLUTION_HIGH]);

  /** GeoJSON の座標点をすべて数える */
  function countPoints(geometry) {
    let n = 0;
    const walk = (value) => {
      if (!Array.isArray(value)) return;
      if (typeof value[0] === 'number') {
        n += 1;
        return;
      }
      for (const child of value) walk(child);
    };
    walk(geometry.coordinates);
    for (const f of geometry.features ?? []) walk(f.geometry?.coordinates);
    return n;
  }

  it('陸と国境がどちらの解像度でも取り出せる', () => {
    for (const atlas of [low, high]) {
      expect(atlas.land.features.length).toBeGreaterThan(100);
      expect(atlas.borders.type).toBe('MultiLineString');
    }
  });

  it('50m の海岸線は 110m よりはっきり細かい', () => {
    const lowPoints = countPoints(low.land);
    const highPoints = countPoints(high.land);
    expect(highPoints).toBeGreaterThan(lowPoints * 3);
  });

  it('日本の輪郭の点数が桁で増える（1 カ国フィットで効く差）', () => {
    const japanOf = (atlas) =>
      atlas.land.features.find((f) => f.properties?.name === 'Japan');
    const lowJapan = japanOf(low);
    const highJapan = japanOf(high);
    expect(lowJapan).toBeTruthy();
    expect(highJapan).toBeTruthy();
    expect(countPoints(highJapan.geometry)).toBeGreaterThan(
      countPoints(lowJapan.geometry) * 3,
    );
  });

  it('50m でも国の特定（geoContains）はこれまでどおり効く', () => {
    const locator = createCountryLocator(high.land.features);
    const cities = [
      { countryCode: 'JP', country: 'Japan', lat: 35.6895, lng: 139.69171 },
    ];
    const fit = resolveFit({ cities, locator });
    expect(fit.scope).toBe(SCOPE_COUNTRY);
    expect(fit.label).toEqual({ type: 'country', name: 'Japan' });
    expect(fit.centerLon).toBeGreaterThan(130);
    expect(fit.centerLon).toBeLessThan(145);
  });
});
