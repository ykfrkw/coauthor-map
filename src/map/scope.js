/**
 * 表示スコープ。共著者の散らばり方に応じて地図の初期表示範囲を決める。
 *
 * 3 段階:
 *   country — 相異なる国が 1 つだけ。その国のポリゴンに合わせる
 *   region  — 複数国だが全部同じ大陸区分。**データに出てくる国だけ**の和に合わせる
 *   world   — それ以外、または判定できないとき
 *
 * 国コードからポリゴンを引く方法について:
 * 同梱の countries-110m.json（world-atlas / Natural Earth）は feature の id が
 * **ISO 3166-1 の数値コード（文字列）**で、properties は name しか持たない。
 * alpha-2 は入っていない。数値コード ↔ alpha-2 の対応表を手で抱えるのは
 * 249 行の保守負債になるので作らない。代わりに d3-geo の geoContains で
 * 「その国の都市ノードの座標がどのポリゴンに入るか」を見て feature を特定する。
 * 引きたいのはデータに出てくる国だけなので、これで過不足なく足りる。
 *
 * フォールバックは country → region → world の順。110m 解像度で落ちている
 * 島嶼のように、どのポリゴンにも入らない座標しか無い国は「特定できなかった」
 * ものとして次の段に落とす。
 */
import { geoContains, geoCentroid } from 'd3-geo';
import { regionOf } from './regions.js';

export const SCOPE_AUTO = 'auto';
export const SCOPE_COUNTRY = 'country';
export const SCOPE_REGION = 'region';
export const SCOPE_WORLD = 'world';

/** UI の選択肢。順序がそのまま並び順になる */
export const SCOPE_OPTIONS = Object.freeze([
  { id: SCOPE_AUTO, labelKey: 'scope.auto' },
  { id: SCOPE_COUNTRY, labelKey: 'scope.country' },
  { id: SCOPE_REGION, labelKey: 'scope.region' },
  { id: SCOPE_WORLD, labelKey: 'scope.world' },
]);

export const DEFAULT_SCOPE = SCOPE_AUTO;

const SCOPE_IDS = new Set(SCOPE_OPTIONS.map((s) => s.id));

/** URL の `scope=` を内部表現に直す。未知の値は既定に落とす */
export function parseScope(raw) {
  const id = String(raw ?? '')
    .trim()
    .toLowerCase();
  return SCOPE_IDS.has(id) ? id : DEFAULT_SCOPE;
}

/**
 * 都市ノード列に出てくる国コードを、論文数の多い順のまま重複なく並べる。
 * cities は derive.js で論文数降順に並んでいるので、先頭が「主たる国」になる。
 * @param {Array<{countryCode?: string|null}>} cities
 * @returns {string[]} 大文字の alpha-2
 */
export function countryCodesOf(cities) {
  const out = [];
  const seen = new Set();
  for (const city of cities ?? []) {
    const code = String(city?.countryCode ?? '')
      .trim()
      .toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

/**
 * 国コードの集合から 3 段階のどれかを決める。
 * 対応表に無い国コードが 1 つでも混じっていたら world に落とす。
 * @param {Array} cities 都市ノード列
 * @returns {'country'|'region'|'world'}
 */
export function detectScope(cities) {
  const codes = countryCodesOf(cities);
  if (codes.length === 0) return SCOPE_WORLD;
  if (codes.length === 1) return SCOPE_COUNTRY;

  const first = regionOf(codes[0]);
  if (!first) return SCOPE_WORLD;
  for (const code of codes.slice(1)) {
    if (regionOf(code) !== first) return SCOPE_WORLD;
  }
  return SCOPE_REGION;
}

/**
 * 座標 → world-atlas の feature を引く関数を作る。
 *
 * geoContains は多角形の点包含判定なので安くはない。年スライダーを動かすたびに
 * 全都市 × 全 feature を回すと重くなるため、座標ごとに結果を覚える。
 * 同じ atlas に対して 1 個作って使い回す想定。
 *
 * @param {Array} features atlas.land.features
 */
export function createCountryLocator(features = []) {
  const cache = new Map();

  /** @returns {Object|null} */
  function at(lng, lat) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    const key = `${lng},${lat}`;
    if (cache.has(key)) return cache.get(key);
    let hit = null;
    for (const f of features) {
      // 複数ヒットは起きない想定だが、起きたら最初の 1 つを使う
      if (geoContains(f, [lng, lat])) {
        hit = f;
        break;
      }
    }
    cache.set(key, hit);
    return hit;
  }

  /**
   * 国コードに対応する feature。その国の都市を順に試し、最初に当たったものを返す。
   * どの都市もポリゴンに入らなければ null（= 特定できなかった）。
   */
  function forCountry(cities, code) {
    for (const city of cities ?? []) {
      if (String(city?.countryCode ?? '').toUpperCase() !== code) continue;
      const hit = at(city.lng, city.lat);
      if (hit) return hit;
    }
    return null;
  }

  return { at, forCountry };
}

/** その国の表示名。都市ノードが持っている名前をそのまま使う（国名表は作らない） */
function countryNameOf(cities, code) {
  for (const city of cities ?? []) {
    if (String(city?.countryCode ?? '').toUpperCase() !== code) continue;
    if (city.country) return city.country;
  }
  return code;
}

/** 重心の経度。取れなければ null */
function centroidLon(geometry) {
  const c = geoCentroid(geometry);
  return Number.isFinite(c?.[0]) ? c[0] : null;
}

const WORLD_FIT = Object.freeze({
  scope: SCOPE_WORLD,
  geometry: null,
  centerLon: null,
  label: null,
});

/**
 * フィット対象を決める。
 *
 * @param {Object} opts
 * @param {Array} opts.cities   都市ノード列（論文数降順）
 * @param {Array} [opts.features] atlas.land.features（locator を渡すなら不要）
 * @param {ReturnType<createCountryLocator>} [opts.locator]
 * @param {string} [opts.scope] 'auto' | 'country' | 'region' | 'world'
 * @returns {{scope: 'country'|'region'|'world',
 *            geometry: Object|null,
 *            centerLon: number|null,
 *            label: {type: 'country', name: string}|{type: 'region', region: string}|null}}
 */
export function resolveFit({
  cities = [],
  features,
  locator,
  scope = SCOPE_AUTO,
}) {
  const wanted = parseScope(scope);
  if (wanted === SCOPE_WORLD) return WORLD_FIT;

  const codes = countryCodesOf(cities);
  if (!codes.length) return WORLD_FIT;

  const find = locator ?? createCountryLocator(features ?? []);
  // auto なら自動判定、明示指定ならその段から始める。
  // 明示 country / region で国がばらけている場合は「論文数が最大の国」を基準にする
  const start = wanted === SCOPE_AUTO ? detectScope(cities) : wanted;
  if (start === SCOPE_WORLD) return WORLD_FIT;

  if (start === SCOPE_COUNTRY) {
    const code = codes[0];
    const feature = find.forCountry(cities, code);
    if (feature) {
      return {
        scope: SCOPE_COUNTRY,
        geometry: feature,
        centerLon: centroidLon(feature),
        label: { type: 'country', name: countryNameOf(cities, code) },
      };
    }
    // 特定できなければ region を試す
  }

  const region = regionOf(codes[0]);
  if (!region) return WORLD_FIT;

  const inRegion = codes.filter((c) => regionOf(c) === region);
  const seen = new Set();
  const members = [];
  for (const code of inRegion) {
    const feature = find.forCountry(cities, code);
    if (!feature || seen.has(feature)) continue;
    seen.add(feature);
    members.push(feature);
  }
  if (!members.length) return WORLD_FIT;

  const geometry = { type: 'FeatureCollection', features: members };
  return {
    scope: SCOPE_REGION,
    geometry,
    centerLon: centroidLon(geometry),
    label: { type: 'region', region },
  };
}
