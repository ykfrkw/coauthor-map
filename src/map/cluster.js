/**
 * 粒度（grain）。
 *
 * 前提の制約: OpenAlex の座標は**都市の重心**なので、都市より細かい粒度は
 * 原理的に作れない（東京の 15 機関はすべて 35.6895 / 139.6917 の1点を返す）。
 * そこで連続的に変えるのは座標の粒度ではなく「画面上のまとまり方」にする。
 *
 *   国 ←──────────────────→ 都市
 *   country      r=64px … r=0px
 *
 *  - 投影**後**のスクリーン座標で、r px 以内のノードを1つの塊にまとめる
 *  - ズームすると同じ r でも塊がほどける（画面距離が広がるため）。
 *    セマンティックズームと組み合わせているので追従は自動で効く
 *  - 塊の代表座標は構成ノードのうち論文数が最大のもの。
 *    平均を取ると海に落ちるので取らない
 *  - 塊の paperCount は構成都市の **DOI の和集合**の大きさ。
 *    単純な足し算にすると、複数都市に跨る論文が二重計上になる
 *  - 貪欲法（論文数の降順に置いていく）なので結果は決定的
 */
import { geoCentroid } from 'd3-geo';

/** スライダーの右端（= r 0px = 都市そのもの）に対応する位置 */
export const GRAIN_MAX = 65;
/** スライダーの左端。国単位 */
export const GRAIN_COUNTRY = 'country';
export const DEFAULT_GRAIN = 0;

/**
 * URL の `grain=` を内部表現に直す。
 * `'country'` か 0〜64 の px。
 */
export function parseGrain(raw) {
  if (raw == null || raw === '') return DEFAULT_GRAIN;
  if (String(raw).toLowerCase() === GRAIN_COUNTRY) return GRAIN_COUNTRY;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_GRAIN;
  return Math.max(0, Math.min(GRAIN_MAX - 1, Math.round(n)));
}

/** 内部表現 → スライダー位置（左端 0 が国、右端 65 が都市） */
export function grainToSlider(grain) {
  if (grain === GRAIN_COUNTRY) return 0;
  return GRAIN_MAX - grain;
}

/** スライダー位置 → 内部表現 */
export function sliderToGrain(pos) {
  const p = Math.max(0, Math.min(GRAIN_MAX, Math.round(Number(pos) || 0)));
  return p === 0 ? GRAIN_COUNTRY : GRAIN_MAX - p;
}

/** URL に載せる文字列 */
export function grainToParam(grain) {
  return grain === GRAIN_COUNTRY ? GRAIN_COUNTRY : String(grain);
}

/**
 * 複数の都市ノードを1つにまとめた集計値を作る。
 * DOI と著者 ID は必ず和集合（足し算にしない）。
 */
function aggregate(members) {
  const dois = new Set();
  const coauthors = [];
  const seenCoauthor = new Set();
  const institutions = [];
  const seenInstitution = new Set();

  for (const m of members) {
    for (const d of m.dois) dois.add(d);
    for (const c of m.coauthors) {
      if (seenCoauthor.has(c.id)) continue;
      seenCoauthor.add(c.id);
      coauthors.push(c);
    }
    for (const i of m.institutions) {
      if (seenInstitution.has(i.id)) continue;
      seenInstitution.add(i.id);
      institutions.push(i);
    }
  }

  coauthors.sort(
    (a, b) => b.paperCount - a.paperCount || a.name.localeCompare(b.name),
  );

  return {
    dois: [...dois],
    coauthors,
    institutions,
    paperCount: dois.size,
    coauthorCount: coauthors.length,
  };
}

/** 論文数降順、同数なら key 昇順（決定的にするため） */
function byPaperCountDesc(a, b) {
  return (
    b.paperCount - a.paperCount || String(a.key).localeCompare(String(b.key))
  );
}

/* ------------------------------------------------------------------ *
 * 国単位
 * ------------------------------------------------------------------ */

/** Natural Earth と OpenAlex で綴りが違う国のつき合わせ表 */
const COUNTRY_ALIASES = new Map(
  Object.entries({
    'united states': 'united states of america',
    usa: 'united states of america',
    'russian federation': 'russia',
    'republic of korea': 'south korea',
    'korea republic of': 'south korea',
    'viet nam': 'vietnam',
    'iran islamic republic of': 'iran',
    'syrian arab republic': 'syria',
    'tanzania united republic of': 'tanzania',
    'moldova republic of': 'moldova',
    'brunei darussalam': 'brunei',
    'czech republic': 'czechia',
    'bosnia and herzegovina': 'bosnia and herz.',
    'dominican republic': 'dominican rep.',
    'central african republic': 'central african rep.',
    'democratic republic of the congo': 'dem. rep. congo',
    'south sudan': 's. sudan',
    'equatorial guinea': 'eq. guinea',
    'solomon islands': 'solomon is.',
    'western sahara': 'w. sahara',
    'falkland islands': 'falkland is.',
    'taiwan province of china': 'taiwan',
    "lao people's democratic republic": 'laos',
    'hong kong': 'china',
    macao: 'china',
  }),
);

function normalizeCountryName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[.,'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 国名から world-atlas のポリゴンを探す。
 * 完全一致 → 別名表 → 前方一致（"united states" ⊂ "united states of america"）の順。
 */
function findCountryFeature(features, name) {
  const target = normalizeCountryName(name);
  if (!target) return null;
  const aliased = COUNTRY_ALIASES.get(target) ?? target;
  let prefixHit = null;
  for (const f of features) {
    const n = normalizeCountryName(f.properties?.name);
    if (n === target || n === aliased) return f;
    if (!prefixHit && (n.startsWith(aliased) || aliased.startsWith(n)))
      prefixHit = f;
  }
  return prefixHit;
}

/**
 * 国単位のノードを作る。座標は world-atlas のポリゴン重心（d3.geoCentroid）。
 * ポリゴンが見つからない国は、論文数が最大の都市の座標で代用する。
 *
 * @param {Array} cities
 * @param {{land: {features: Array}}|null} atlas
 */
export function buildCountryNodes(cities, atlas) {
  const groups = new Map();
  for (const city of cities) {
    // countryCode が null の都市がある（機関側に国コードが入っていない）。
    // 表示名でも束ねられるようにフォールバックする
    const key = city.countryCode || city.country || '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(city);
  }

  const features = atlas?.land?.features ?? [];
  const nodes = [];

  for (const [key, members] of groups) {
    members.sort(byPaperCountDesc);
    const head = members[0];
    const agg = aggregate(members);

    let lat = head.lat;
    let lng = head.lng;
    const featureHit = findCountryFeature(features, head.country ?? key);
    if (featureHit) {
      const centroid = geoCentroid(featureHit);
      if (Number.isFinite(centroid[0]) && Number.isFinite(centroid[1])) {
        lng = centroid[0];
        lat = centroid[1];
      }
    }

    nodes.push({
      key: `country:${key}`,
      lat,
      lng,
      city: head.country ?? key,
      country: head.country ?? key,
      countryCode: head.countryCode ?? null,
      members,
      isCountry: true,
      ...agg,
    });
  }

  nodes.sort(byPaperCountDesc);
  return nodes;
}

/* ------------------------------------------------------------------ *
 * スクリーン座標での近接クラスタリング
 * ------------------------------------------------------------------ */

/**
 * 投影済みノードを r px でまとめる。
 *
 * @param {Array<{node: Object, x: number, y: number}>} placed
 * @param {number} radiusPx  0 なら何もしない
 * @returns {Array} 塊（1件だけの塊は元ノードをそのまま返す）
 */
export function clusterPlaced(placed, radiusPx) {
  if (!(radiusPx > 0) || placed.length < 2) {
    return placed.map(({ node, x, y }) => ({
      ...node,
      x,
      y,
      members: node.members ?? [node],
    }));
  }

  // 論文数の降順に置いていく貪欲法。順序が決まっているので結果は決定的
  const order = placed.slice().sort((a, b) => byPaperCountDesc(a.node, b.node));

  const taken = new Array(order.length).fill(false);
  const r2 = radiusPx * radiusPx;
  const out = [];

  for (let i = 0; i < order.length; i += 1) {
    if (taken[i]) continue;
    taken[i] = true;
    const head = order[i];
    const members = [head.node];

    for (let j = i + 1; j < order.length; j += 1) {
      if (taken[j]) continue;
      const dx = order[j].x - head.x;
      const dy = order[j].y - head.y;
      if (dx * dx + dy * dy <= r2) {
        taken[j] = true;
        members.push(order[j].node);
      }
    }

    if (members.length === 1) {
      out.push({
        ...head.node,
        x: head.x,
        y: head.y,
        members: head.node.members ?? [head.node],
      });
      continue;
    }

    // 塊の中身は「都市」に展開しておく（国モードの塊なら国が並ぶ）
    const flat = members.flatMap((m) => m.members ?? [m]);
    const agg = aggregate(members);
    out.push({
      ...head.node,
      key: `cluster:${head.node.key}:${members.length}`,
      x: head.x,
      y: head.y,
      members: flat.sort(byPaperCountDesc),
      clusterOf: members.length,
      ...agg,
    });
  }

  return out;
}
