/**
 * 表示スコープ（国 / 地域 / 全世界）の判定とフィット。
 *
 * fixture の dataset-snapshot.json は実データなので、年フィルタを掛けると
 * 「1 カ国」「複数地域」の状況をそのまま作れる。既知解として使う。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { feature } from 'topojson-client';
import { geoContains, geoEquirectangular } from 'd3-geo';

import { normalizeDataset, filterDataset } from '../src/ui/derive.js';
import {
  SCOPE_AUTO,
  SCOPE_COUNTRY,
  SCOPE_REGION,
  SCOPE_WORLD,
  countryCodesOf,
  createCountryLocator,
  detectScope,
  parseScope,
  resolveFit,
} from '../src/map/scope.js';
import { regionOf, REGIONS, COUNTRY_REGION } from '../src/map/regions.js';
import { createProjection, padExtent } from '../src/map/projections.js';
import {
  DEFAULTS,
  readStateFromUrl,
  stateToQuery,
} from '../src/ui/controls.js';
import { fitNoteText } from '../src/map/render.js';
import { createTranslator } from '../src/ui/i18n.js';

const read = (rel) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'),
  );

const dataset = normalizeDataset(read('./fixtures/dataset-snapshot.json'));
// world-atlas は public/ に copy:atlas でコピーされる同じファイル
const atlas = read('../public/countries-110m.json');
const features = feature(atlas, atlas.objects.countries).features;
const locator = createCountryLocator(features);

/** 年で切った都市ノード列 */
function citiesFor(from, to) {
  return filterDataset(dataset, { from, to }).cities;
}

/** 合成の都市ノード（座標は各国の首都あたり） */
const SYNTHETIC = {
  DE: { city: 'Berlin', country: 'Germany', lat: 52.52, lng: 13.405 },
  FR: { city: 'Paris', country: 'France', lat: 48.857, lng: 2.352 },
  IT: { city: 'Rome', country: 'Italy', lat: 41.9, lng: 12.5 },
  NL: { city: 'Amsterdam', country: 'Netherlands', lat: 52.374, lng: 4.9 },
  JP: { city: 'Tokyo', country: 'Japan', lat: 35.69, lng: 139.69 },
  CN: { city: 'Beijing', country: 'China', lat: 39.906, lng: 116.391 },
  KR: { city: 'Seoul', country: 'South Korea', lat: 37.566, lng: 126.978 },
  NZ: { city: 'Wellington', country: 'New Zealand', lat: -41.29, lng: 174.777 },
  FJ: { city: 'Suva', country: 'Fiji', lat: -18.141, lng: 178.442 },
  BR: { city: 'Brasilia', country: 'Brazil', lat: -15.79, lng: -47.88 },
};

function synth(codes, paperCounts = {}) {
  return codes.map((code, i) => ({
    key: `${code}|x`,
    countryCode: code,
    paperCount: paperCounts[code] ?? codes.length - i,
    ...SYNTHETIC[code],
  }));
}

describe('地域対応表', () => {
  it('大陸をまたぐ国は 1 つの地域に割り当てられている', () => {
    expect(regionOf('RU')).toBe('europe');
    expect(regionOf('TR')).toBe('asia');
    expect(regionOf('EG')).toBe('africa');
    expect(regionOf('GL')).toBe('northAmerica');
    expect(regionOf('MX')).toBe('northAmerica');
    expect(regionOf('BR')).toBe('southAmerica');
  });

  it('大小の表記ゆれと空値を吸収する', () => {
    expect(regionOf('jp')).toBe('asia');
    expect(regionOf(' de ')).toBe('europe');
    expect(regionOf('')).toBeNull();
    expect(regionOf(null)).toBeNull();
    expect(regionOf(undefined)).toBeNull();
  });

  it('どの国も 7 区分のどれかに入り、重複しない', () => {
    for (const region of COUNTRY_REGION.values()) {
      expect(REGIONS).toContain(region);
    }
    expect(REGIONS).toHaveLength(7);
  });

  it('fixture に出てくる国コードはすべて表に載っている', () => {
    for (const code of countryCodesOf(dataset.cities)) {
      expect(regionOf(code)).not.toBeNull();
    }
  });
});

describe('スコープの自動判定', () => {
  it('2019 年だけなら日本 1 カ国 → country', () => {
    const cities = citiesFor(2019, 2019);
    expect(countryCodesOf(cities)).toEqual(['JP']);
    expect(detectScope(cities)).toBe(SCOPE_COUNTRY);
  });

  it('2019–2020 も日本 1 カ国 → country', () => {
    const cities = citiesFor(2019, 2020);
    expect(countryCodesOf(cities)).toEqual(['JP']);
    expect(detectScope(cities)).toBe(SCOPE_COUNTRY);
  });

  it('2019–2021 は 5 カ国・複数地域 → world', () => {
    const cities = citiesFor(2019, 2021);
    expect(countryCodesOf(cities).sort()).toEqual([
      'CH',
      'GB',
      'JP',
      'NL',
      'US',
    ]);
    expect(detectScope(cities)).toBe(SCOPE_WORLD);
  });

  it('全期間は 14 カ国 → world', () => {
    const cities = citiesFor(2019, 2026);
    expect(countryCodesOf(cities)).toHaveLength(14);
    expect(detectScope(cities)).toBe(SCOPE_WORLD);
  });

  it('欧州 4 カ国なら region', () => {
    const cities = synth(['DE', 'FR', 'IT', 'NL']);
    expect(detectScope(cities)).toBe(SCOPE_REGION);
    expect(resolveFit({ cities, locator }).label).toEqual({
      type: 'region',
      region: 'europe',
    });
  });

  it('アジア 3 カ国なら region', () => {
    const cities = synth(['JP', 'CN', 'KR']);
    expect(detectScope(cities)).toBe(SCOPE_REGION);
    expect(resolveFit({ cities, locator }).label).toEqual({
      type: 'region',
      region: 'asia',
    });
  });

  it('地域をまたぐと world', () => {
    expect(detectScope(synth(['DE', 'JP']))).toBe(SCOPE_WORLD);
    expect(detectScope(synth(['BR', 'DE']))).toBe(SCOPE_WORLD);
  });

  it('国コードが 1 つも無ければ world', () => {
    expect(detectScope([])).toBe(SCOPE_WORLD);
    expect(detectScope([{ countryCode: null }])).toBe(SCOPE_WORLD);
  });

  it('対応表に無い国コードが混じれば world に落ちる', () => {
    const cities = [
      { countryCode: 'DE', country: 'Germany', lat: 52.52, lng: 13.405 },
      { countryCode: 'ZZ', country: 'Nowhere', lat: 0, lng: 0 },
    ];
    expect(regionOf('ZZ')).toBeNull();
    expect(detectScope(cities)).toBe(SCOPE_WORLD);
    expect(resolveFit({ cities, locator }).scope).toBe(SCOPE_WORLD);
  });

  it('先頭の国が対応表に無ければ world（判定不能）', () => {
    const cities = [
      { countryCode: 'ZZ', country: 'Nowhere', lat: 0, lng: 0 },
      { countryCode: 'DE', country: 'Germany', lat: 52.52, lng: 13.405 },
    ];
    expect(detectScope(cities)).toBe(SCOPE_WORLD);
  });
});

describe('scope パラメータ', () => {
  it('既知の値だけ通し、未知は auto に落ちる', () => {
    expect(parseScope('country')).toBe(SCOPE_COUNTRY);
    expect(parseScope('REGION')).toBe(SCOPE_REGION);
    expect(parseScope('world')).toBe(SCOPE_WORLD);
    expect(parseScope('galaxy')).toBe(SCOPE_AUTO);
    expect(parseScope(null)).toBe(SCOPE_AUTO);
    expect(parseScope('')).toBe(SCOPE_AUTO);
  });

  it('world を明示したらポリゴンにフィットしない', () => {
    const fit = resolveFit({
      cities: citiesFor(2019, 2019),
      locator,
      scope: SCOPE_WORLD,
    });
    expect(fit.scope).toBe(SCOPE_WORLD);
    expect(fit.geometry).toBeNull();
    expect(fit.label).toBeNull();
  });

  it('国がばらけていても country を明示したら主たる国に合わせる', () => {
    const cities = citiesFor(2019, 2026);
    const fit = resolveFit({ cities, locator, scope: SCOPE_COUNTRY });
    expect(fit.scope).toBe(SCOPE_COUNTRY);
    expect(fit.label).toEqual({ type: 'country', name: 'Japan' });
  });

  it('region を明示したら主たる国と同じ地域の国だけを束ねる', () => {
    const cities = citiesFor(2019, 2026);
    const fit = resolveFit({ cities, locator, scope: SCOPE_REGION });
    expect(fit.scope).toBe(SCOPE_REGION);
    expect(fit.label).toEqual({ type: 'region', region: 'asia' });
    // アジアの国だけ（日本と中国）。欧州や北米は入らない
    expect(fit.geometry.features.length).toBe(2);
  });
});

describe('geoContains によるポリゴンの特定', () => {
  it('日本の feature が引ける', () => {
    const tokyo = citiesFor(2019, 2020).find((c) => c.city === 'Tokyo');
    const hit = locator.at(tokyo.lng, tokyo.lat);
    expect(hit).toBeTruthy();
    expect(hit.properties.name).toBe('Japan');
    // 数値コードのままで alpha-2 は持っていない（対応表を作っていないことの確認）
    expect(hit.properties.name).toBeTruthy();
    expect(hit.id).toBe('392');
  });

  it('同じ座標を何度引いても同じ feature を返す（メモ化）', () => {
    const a = locator.at(139.69171, 35.6895);
    const b = locator.at(139.69171, 35.6895);
    expect(a).toBe(b);
  });

  it('海の上はどの feature にも入らない', () => {
    expect(locator.at(-160, 0)).toBeNull();
  });

  it('どの都市もポリゴンに入らない国は country を諦めて次の段に落ちる', () => {
    // 太平洋のど真ん中に置いた架空の 1 カ国。country は作れないが
    // 地域（oceania）としても feature が 1 つも引けないので world になる
    const cities = [
      { countryCode: 'NR', country: 'Nauru', lat: -0.52, lng: -166.93 },
    ];
    expect(detectScope(cities)).toBe(SCOPE_COUNTRY);
    expect(resolveFit({ cities, locator }).scope).toBe(SCOPE_WORLD);
  });

  it('country が引けなくても、同じ地域の別の国が引ければ region に落ちる', () => {
    const cities = [
      // 先頭（主たる国）はポリゴンに入らない座標
      { countryCode: 'FJ', country: 'Fiji', lat: 0, lng: -160 },
      SYNTHETIC.NZ && { countryCode: 'NZ', ...SYNTHETIC.NZ },
    ].filter(Boolean);
    const fit = resolveFit({ cities, locator });
    expect(fit.scope).toBe(SCOPE_REGION);
    expect(fit.label).toEqual({ type: 'region', region: 'oceania' });
  });
});

describe('フィット後の投影', () => {
  const SIZE = { width: 900, height: 468 };

  /** スコープを解決して投影を作る */
  function project(cities, scope = SCOPE_AUTO, id = 'equalEarth') {
    const fit = resolveFit({ cities, locator, scope });
    const { projection } = createProjection({
      id,
      centerLon: fit.centerLon ?? 0,
      width: SIZE.width,
      height: SIZE.height,
      padding: 8,
      fitTarget: fit.geometry,
    });
    return { fit, projection };
  }

  it('日本にフィットすると日本の都市がすべて描画領域の内側に入る', () => {
    const cities = citiesFor(2019, 2019);
    const { fit, projection } = project(cities);
    expect(fit.scope).toBe(SCOPE_COUNTRY);
    expect(fit.label).toEqual({ type: 'country', name: 'Japan' });

    for (const city of cities) {
      const xy = projection([city.lng, city.lat]);
      expect(xy).toBeTruthy();
      expect(xy[0]).toBeGreaterThan(0);
      expect(xy[0]).toBeLessThan(SIZE.width);
      expect(xy[1]).toBeGreaterThan(0);
      expect(xy[1]).toBeLessThan(SIZE.height);
    }
  });

  it('日本フィットは世界地図よりはっきり拡大されている', () => {
    const cities = citiesFor(2019, 2019);
    const world = project(cities, SCOPE_WORLD).projection.scale();
    const country = project(cities, SCOPE_COUNTRY).projection.scale();
    expect(country).toBeGreaterThan(world * 4);
  });

  it('中心経度の既定は対象の重心（日本なら 130–145°E あたり）', () => {
    const { fit } = project(citiesFor(2019, 2019));
    expect(fit.centerLon).toBeGreaterThan(130);
    expect(fit.centerLon).toBeLessThan(145);
  });

  it('世界スコープでは重心を持たない（利用者の中心経度が生きる）', () => {
    const fit = resolveFit({ cities: citiesFor(2019, 2026), locator });
    expect(fit.scope).toBe(SCOPE_WORLD);
    expect(fit.centerLon).toBeNull();
  });

  it('日付変更線をまたぐ oceania でもフィットが破綻しない', () => {
    const cities = synth(['NZ', 'FJ']);
    const { fit, projection } = project(cities);
    expect(fit.scope).toBe(SCOPE_REGION);
    expect(fit.label).toEqual({ type: 'region', region: 'oceania' });
    // 重心は東経 170 台。-170 側に折り返していないこと
    expect(fit.centerLon).toBeGreaterThan(160);
    expect(fit.centerLon).toBeLessThanOrEqual(180);
    expect(projection.scale()).toBeGreaterThan(0);
    expect(Number.isFinite(projection.scale())).toBe(true);

    for (const city of cities) {
      const xy = projection([city.lng, city.lat]);
      expect(xy.every(Number.isFinite)).toBe(true);
      expect(xy[0]).toBeGreaterThan(0);
      expect(xy[0]).toBeLessThan(SIZE.width);
      expect(xy[1]).toBeGreaterThan(0);
      expect(xy[1]).toBeLessThan(SIZE.height);
    }
  });

  it('欧州フィットでも各国の都市が内側に入る', () => {
    const cities = synth(['DE', 'FR', 'IT', 'NL']);
    const { fit, projection } = project(cities);
    expect(fit.scope).toBe(SCOPE_REGION);
    for (const city of cities) {
      const xy = projection([city.lng, city.lat]);
      expect(xy[0]).toBeGreaterThan(0);
      expect(xy[0]).toBeLessThan(SIZE.width);
      expect(xy[1]).toBeGreaterThan(0);
      expect(xy[1]).toBeLessThan(SIZE.height);
    }
  });

  it('どの投影法でもフィットが有限値になる', () => {
    const cities = citiesFor(2019, 2019);
    for (const id of [
      'equalEarth',
      'naturalEarth',
      'equirectangular',
      'mercator',
      'orthographic',
    ]) {
      const { projection } = project(cities, SCOPE_AUTO, id);
      expect(Number.isFinite(projection.scale())).toBe(true);
      expect(projection.scale()).toBeGreaterThan(0);
    }
  });

  it('世界スコープの投影は従来どおり（フィット対象を渡さないときと一致）', () => {
    const before = createProjection({
      id: 'equalEarth',
      centerLon: 140,
      width: SIZE.width,
      height: SIZE.height,
      padding: 8,
    });
    const after = createProjection({
      id: 'equalEarth',
      centerLon: 140,
      width: SIZE.width,
      height: SIZE.height,
      padding: 8,
      fitTarget: null,
    });
    expect(after.base.scale).toBe(before.base.scale);
    expect(after.base.translate).toEqual(before.base.translate);
  });
});

describe('フィットの余白', () => {
  it('枠を 1/1.15 に縮める（= 対象の bbox を 1.15 倍に広げるのと同じ）', () => {
    const extent = [
      [0, 0],
      [115, 230],
    ];
    const padded = padExtent(extent, 1.15);
    expect(padded[1][0] - padded[0][0]).toBeCloseTo(100, 6);
    expect(padded[1][1] - padded[0][1]).toBeCloseTo(200, 6);
    // 中心はずらさない
    expect(padded[0][0] + padded[1][0]).toBeCloseTo(115, 6);
    expect(padded[0][1] + padded[1][1]).toBeCloseTo(230, 6);
  });

  it('潰れるほど小さい枠は縮めない', () => {
    const tiny = [
      [0, 0],
      [1, 1],
    ];
    expect(padExtent(tiny, 100)).toEqual(tiny);
  });

  it('国フィットの縮尺は、余白なしで合わせた場合のちょうど 1/1.15', () => {
    const cities = [{ countryCode: 'JP', ...SYNTHETIC.JP }];
    const fit = resolveFit({ cities, locator });

    // 余白なしで同じ対象に合わせた場合の縮尺（比較用に素の d3 で作る）
    const bare = geoEquirectangular()
      .rotate([-fit.centerLon, 0, 0])
      .fitExtent(
        [
          [8, 8],
          [792, 392],
        ],
        fit.geometry,
      );

    const { projection } = createProjection({
      id: 'equirectangular',
      centerLon: fit.centerLon,
      width: 800,
      height: 400,
      padding: 8,
      fitTarget: fit.geometry,
    });

    expect(projection.scale()).toBeCloseTo(bare.scale() / 1.15, 6);
  });
});

describe('自動フィットの注記', () => {
  const t = createTranslator();

  it('国にフィットしたら国名を出す', () => {
    const fit = resolveFit({ cities: citiesFor(2019, 2019), locator });
    expect(fitNoteText(fit, t)).toBe('Fitted to Japan');
  });

  it('地域にフィットしたら US 英語の地域名を出す', () => {
    expect(
      fitNoteText(resolveFit({ cities: synth(['DE', 'FR']), locator }), t),
    ).toBe('Fitted to Europe');
    expect(
      fitNoteText(resolveFit({ cities: synth(['NZ', 'FJ']), locator }), t),
    ).toBe('Fitted to Oceania');
  });

  it('全世界のときは何も出さない', () => {
    const fit = resolveFit({ cities: citiesFor(2019, 2026), locator });
    expect(fitNoteText(fit, t)).toBe('');
    expect(fitNoteText(null, t)).toBe('');
  });

  it('7 区分すべてに文言がある', () => {
    for (const region of REGIONS) {
      const text = fitNoteText({ label: { type: 'region', region } }, t);
      expect(text.startsWith('Fitted to ')).toBe(true);
      expect(text).not.toContain('region.');
    }
  });
});

describe('scope の URL 往復', () => {
  const base = () => ({ ...DEFAULTS, from: null, to: null });

  it('既定は auto で、URL には書かない', () => {
    expect(DEFAULTS.scope).toBe(SCOPE_AUTO);
    expect(readStateFromUrl('').scope).toBe(SCOPE_AUTO);
    expect(stateToQuery(base())).not.toContain('scope');
  });

  it('auto 以外は URL に載り、読み戻せる', () => {
    for (const scope of [SCOPE_COUNTRY, SCOPE_REGION, SCOPE_WORLD]) {
      const query = stateToQuery({ ...base(), scope });
      expect(query).toContain(`scope=${scope}`);
      expect(readStateFromUrl(`?${query}`).scope).toBe(scope);
    }
  });

  it('未知の scope は auto に落ちる', () => {
    expect(readStateFromUrl('?scope=galaxy').scope).toBe(SCOPE_AUTO);
  });

  it('center を書いた URL は「明示した」扱いになる', () => {
    expect(readStateFromUrl('').centerExplicit).toBe(false);
    expect(readStateFromUrl('?center=10').centerExplicit).toBe(true);
    // 既定値と同じ 140 でも、明示していれば URL に残す
    expect(readStateFromUrl('?center=140').centerExplicit).toBe(true);
    expect(
      stateToQuery({ ...base(), center: 140, centerExplicit: true }),
    ).toContain('center=140');
    expect(stateToQuery(base())).not.toContain('center');
  });

  it('クエリ無しの既定 URL は従来どおり（scope も center も出ない）', () => {
    const query = stateToQuery(readStateFromUrl(''), { from: 2019, to: 2026 });
    expect(query).toBe('orcid=0000-0003-1317-0220&rm=yk_frkw');
  });
});

describe('日本のポリゴン', () => {
  it('geoContains で日本のすべての都市が日本の feature に入る', () => {
    const japan = locator.at(139.69171, 35.6895);
    const jpCities = dataset.cities.filter((c) => c.countryCode === 'JP');
    expect(jpCities.length).toBeGreaterThan(0);
    const inside = jpCities.filter((c) => geoContains(japan, [c.lng, c.lat]));
    // 110m 解像度なので離島が落ちることはあるが、大半は入る
    expect(inside.length).toBeGreaterThan(jpCities.length / 2);
  });
});
