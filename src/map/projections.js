/**
 * 投影法レジストリ。
 *
 * 中心経度は projection.rotate([-lon, -lat]) で与える。緯度方向の回転は
 * 正射図法（地球儀）だけで使う。他の投影法で緯度を回すと見慣れない斜め地図に
 * なるので、rotatable: false のものは緯度を常に 0 に潰す。
 *
 * 日付変更線: d3-geo の geoPath は既定で antimeridian の preclip が入るため、
 * rotate で 180 付近を中心に持ってきてもポリゴンは切断されて破綻しない。
 * 正射図法は clipAngle(90) が既定で入る。
 */
import {
  geoEqualEarth,
  geoNaturalEarth1,
  geoEquirectangular,
  geoMercator,
  geoOrthographic,
  geoDistance,
  geoBounds,
} from 'd3-geo';

/** 投影法の定義一覧。順序がそのまま UI の並び順になる */
export const PROJECTIONS = [
  {
    id: 'equalEarth',
    labelKey: 'proj.equalEarth',
    factory: geoEqualEarth,
    rotatable: false,
  },
  {
    id: 'naturalEarth',
    labelKey: 'proj.naturalEarth',
    factory: geoNaturalEarth1,
    rotatable: false,
  },
  {
    id: 'equirectangular',
    labelKey: 'proj.equirectangular',
    factory: geoEquirectangular,
    rotatable: false,
  },
  {
    id: 'mercator',
    labelKey: 'proj.mercator',
    factory: geoMercator,
    rotatable: false,
  },
  {
    id: 'orthographic',
    labelKey: 'proj.orthographic',
    factory: geoOrthographic,
    rotatable: true,
  },
];

export const DEFAULT_PROJECTION = 'equalEarth';

/** 中心経度のプリセット */
export const CENTER_PRESETS = [
  { id: 'japan', labelKey: 'center.japan', lon: 140 },
  { id: 'europe', labelKey: 'center.europe', lon: 10 },
  { id: 'americas', labelKey: 'center.americas', lon: -80 },
  { id: 'pacific', labelKey: 'center.pacific', lon: 180 },
  { id: 'atlantic', labelKey: 'center.atlantic', lon: -30 },
];

/** 未知の id が来ても既定に落ちる */
export function getProjectionSpec(id) {
  return PROJECTIONS.find((p) => p.id === id) ?? PROJECTIONS[0];
}

/** 経度を -180..180 に畳む。スライダーと URL の往復で 181 のような値が来ても壊さない */
export function normalizeLongitude(lon) {
  const n = Number(lon);
  if (!Number.isFinite(n)) return 0;
  return ((((n + 180) % 360) + 360) % 360) - 180;
}

/** 緯度回転はここで抑える。極を越えると裏返るので ±89 で止める */
export function clampRotateLat(lat) {
  const n = Number(lat);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-89, Math.min(89, n));
}

const SPHERE = { type: 'Sphere' };

/** メルカトルで世界全体を出すときの代用矩形（極が無限遠なので緯度を切る） */
const MERCATOR_WORLD = {
  type: 'Polygon',
  coordinates: [
    [
      [-180, -83],
      [180, -83],
      [180, 83],
      [-180, 83],
      [-180, -83],
    ],
  ],
};

/**
 * 国や地域にフィットさせるときの余白。
 *
 * ぴったり合わせると縁のピンが切れるので、対象の境界ボックスを 1.15 倍に
 * 広げてから合わせたい。地理座標の bbox を膨らませると日付変更線をまたぐ
 * ケースで壊れるので、**投影後の矩形**の側を 1/1.15 に縮めて同じ結果を得る。
 * fitExtent は投影後の bbox を枠に収める関数なので、これは
 * 「bbox を 1.15 倍してから合わせる」と等価で、経度の折り返しに依存しない。
 */
export const FIT_PAD_FACTOR = 1.15;

/** 枠を中心に向かって factor 分だけ縮める */
export function padExtent(extent, factor = FIT_PAD_FACTOR) {
  const [[x0, y0], [x1, y1]] = extent;
  const w = x1 - x0;
  const h = y1 - y0;
  const insetX = (w - w / factor) / 2;
  const insetY = (h - h / factor) / 2;
  // 縮めすぎて潰れないように最低 1px は残す
  if (w - insetX * 2 < 1 || h - insetY * 2 < 1) return extent;
  return [
    [x0 + insetX, y0 + insetY],
    [x1 - insetX, y1 - insetY],
  ];
}

/**
 * メルカトルは極が無限遠なので、±83 を越える対象はそのまま渡せない。
 * 越えていたら世界全体の代用矩形に落とす（南極スコープのような極端な場合だけ）。
 */
function mercatorSafeTarget(target) {
  if (!target) return MERCATOR_WORLD;
  const [[, south], [, north]] = geoBounds(target);
  if (!Number.isFinite(south) || !Number.isFinite(north)) return MERCATOR_WORLD;
  return south < -83 || north > 83 ? MERCATOR_WORLD : target;
}

/**
 * 投影法インスタンスを作り、与えられた矩形にフィットさせる。
 *
 * @param {Object} opts
 * @param {string} opts.id           投影法 id
 * @param {number} opts.centerLon    中心経度（度）
 * @param {number} [opts.rotateLat]  緯度方向の回転（正射図法のみ有効）
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {number} [opts.padding]
 * @param {Object|null} [opts.fitTarget] 国 / 地域のポリゴン。null なら世界全体
 * @returns {{ projection: import('d3-geo').GeoProjection, spec: Object,
 *             base: {scale: number, translate: [number, number]} }}
 */
export function createProjection({
  id,
  centerLon,
  rotateLat = 0,
  width,
  height,
  padding = 6,
  fitTarget = null,
}) {
  const spec = getProjectionSpec(id);
  const lon = normalizeLongitude(centerLon);
  const lat = spec.rotatable ? clampRotateLat(rotateLat) : 0;

  const projection = spec.factory();
  // rotate の符号は「地球を回す」側なので中心にしたい経度の符号を反転する
  projection.rotate([-lon, -lat, 0]);

  const extent = [
    [padding, padding],
    [
      Math.max(padding + 1, width - padding),
      Math.max(padding + 1, height - padding),
    ],
  ];

  // メルカトルは極が無限遠なので、Sphere でフィットさせると縦が伸び切る。
  // 実用範囲の ±83° に切って、そこをフィット対象にする。
  let target = fitTarget ?? SPHERE;
  if (spec.id === 'mercator') target = mercatorSafeTarget(fitTarget);

  // 世界全体のときは従来どおり枠いっぱい。国 / 地域のときだけ余白を足す
  const scoped = target !== SPHERE && target !== MERCATOR_WORLD;
  projection.fitExtent(scoped ? padExtent(extent) : extent, target);

  const base = {
    scale: projection.scale(),
    translate: /** @type {[number, number]} */ (projection.translate().slice()),
  };

  return { projection, spec, base };
}

/**
 * d3-zoom の transform を投影法に反映する（セマンティックズーム）。
 * 幾何変換ではなく投影パラメータを動かすので、線幅とピン半径が
 * 拡大率によらず一定に保たれ、日付変更線のクリップも正しく効き続ける。
 *
 * 正射図法では平行移動を無効にする（移動は回転が担当するため）。
 */
export function applyZoom(projection, spec, base, transform) {
  const k = transform.k;
  projection.scale(base.scale * k);
  if (spec.rotatable) {
    projection.translate(base.translate);
  } else {
    projection.translate([
      base.translate[0] * k + transform.x,
      base.translate[1] * k + transform.y,
    ]);
  }
}

/**
 * 正射図法で点が地球の裏側にあるかどうか。
 *
 * projection([lng, lat]) は裏側の点にも座標を返してしまう（クリップは
 * geoPath のストリーム側にしか掛からない）。角距離で自前に判定する。
 */
export function createVisibilityTest(projection, spec) {
  if (!spec.rotatable) return () => true;
  const [rl, rp] = projection.rotate();
  const center = [-rl, -rp];
  return (lng, lat) => geoDistance([lng, lat], center) < Math.PI / 2 - 1e-6;
}

/**
 * 正射図法のドラッグ量（px）を回転量（度）に変換する。
 * 拡大しているほど 1px あたりの回転は小さくなる。
 */
export function dragToRotation(dx, dy, scale) {
  const k = 90 / Math.max(scale, 1);
  return { dLon: dx * k, dLat: -dy * k };
}
