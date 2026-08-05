/**
 * 地図データ（world-atlas の TopoJSON）の読み込みと、解像度の出し分け。
 *
 * 持つ解像度は 2 段階だけ:
 *   110m … 105KB。世界全体を眺めるぶんにはこれで足りる。**常にこれから始める**
 *    50m … 739KB。国 / 地域にフィットしたときと、大きく拡大したときだけ読む
 *
 * 10m（3.5MB）は採らない。海岸線の精度より初期表示の軽さを取る。
 *
 * 方針:
 *  - 初期表示のコストを 1 バイトも増やさない。50m は必要になった瞬間に初めて取りに行く
 *  - 届くまでは 110m のまま描いておき、届いたら黙って差し替える。
 *    描画側は d3 の join による差分更新なので、ピン・ズーム・ラベルの状態は保たれる
 *  - 一度読んだら使い回す。**失敗しても覚えておき、二度は取りに行かない**
 *    （ホイールを回すたびに 739KB を投げ直す事故を防ぐ）
 *  - 引き下げはしない。一度上げた解像度は戻さない（差し替えのちらつきを避ける）
 */
import { feature, mesh } from 'topojson-client';
import { SCOPE_WORLD } from './scope.js';

export const RESOLUTION_LOW = '110m';
export const RESOLUTION_HIGH = '50m';

/** 解像度の順序。数が大きいほど精細 */
const RANK = Object.freeze({
  [RESOLUTION_LOW]: 1,
  [RESOLUTION_HIGH]: 2,
});

const rankOf = (resolution) => RANK[resolution] ?? 0;

/**
 * 世界表示のまま 50m に引き上げる拡大率のしきい値（投影のスケール ÷ 初期スケール）。
 *
 * 根拠: 世界全体（等倍）では 110m の頂点間隔が画面上 1px 前後に収まるので、
 * 角張りは見えない。2 倍あたりまでは差が分からず、739KB を払う値打ちがない。
 * 3 倍を超えるとちょうど大陸ひとつが画面を占める大きさになり、
 * ノルウェーやギリシャの海岸線が目に見えて多角形になる。そこを境にする。
 *
 * セマンティックズームなので d3-zoom の transform.k がそのままこの比になる。
 */
export const HIGH_RES_SCALE_RATIO = 3;

/** 配信元の URL。public/ に copy:atlas が置いたファイルを実行時に読む */
export function atlasUrl(resolution, baseUrl = '') {
  return `${baseUrl}countries-${resolution}.json`;
}

/**
 * TopoJSON を陸ポリゴンと国境メッシュに分ける。
 * @param {any} topo
 * @returns {{land: Object, borders: Object}}
 */
export function parseAtlas(topo) {
  return {
    land: feature(topo, topo.objects.countries),
    borders: mesh(topo, topo.objects.countries, (a, b) => a !== b),
  };
}

/**
 * いま欲しい解像度を決める。
 *
 *  - 国 / 地域にフィットしているなら 50m。海岸線が主役になる表示なので惜しまない
 *  - 世界表示でも、利用者が大きく拡大したら 50m に引き上げる
 *
 * @param {Object} opts
 * @param {string|null} [opts.scope]  解決後のフィット範囲（'country' | 'region' | 'world'）
 * @param {number} [opts.scaleRatio]  初期スケールに対する現在の倍率
 * @returns {'110m'|'50m'}
 */
export function resolutionFor({ scope, scaleRatio = 1 } = {}) {
  if (scope && scope !== SCOPE_WORLD) return RESOLUTION_HIGH;
  const ratio = Number(scaleRatio);
  return Number.isFinite(ratio) && ratio > HIGH_RES_SCALE_RATIO
    ? RESOLUTION_HIGH
    : RESOLUTION_LOW;
}

/**
 * 解像度つきの atlas 供給元。
 *
 * `ensure(resolution)` はいまより精細な解像度を求められたときだけ取りに行き、
 * 差し替えたら true を返す。**失敗しても投げない**（false を返すだけ）ので、
 * 呼び出し側は戻り値を見て描き直すかどうかだけ決めればよい。
 *
 * @param {Object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]  テスト用の差し替え口
 * @param {string} [opts.baseUrl]
 * @returns {{ensure: (r: string) => Promise<boolean>, atlas: Object|null, resolution: string|null}}
 */
export function createAtlasProvider({ fetchImpl, baseUrl = '' } = {}) {
  /** 解像度 → 取得中 / 取得済みの Promise。失敗した Promise も残す */
  const requests = new Map();
  let atlas = null;
  let resolution = null;

  function request(target) {
    const cached = requests.get(target);
    if (cached) return cached;
    const url = atlasUrl(target, baseUrl);
    const call = fetchImpl ?? globalThis.fetch;
    const pending = Promise.resolve(call(url))
      .then((res) => {
        if (!res?.ok) throw new Error(`${url}: HTTP ${res?.status}`);
        return res.json();
      })
      .then(parseAtlas);
    requests.set(target, pending);
    return pending;
  }

  async function ensure(target) {
    const want = rankOf(target);
    // 未知の解像度と引き下げの要求は無視する
    if (!want || want <= rankOf(resolution)) return false;
    try {
      const loaded = await request(target);
      // 待っているあいだに、より精細なものが入っていたら譲る
      if (want <= rankOf(resolution)) return false;
      atlas = loaded;
      resolution = target;
      return true;
    } catch (err) {
      // 110m が取れなければ陸は描けないが、経緯線とピンは出る。
      // 50m が取れなければ 110m のまま動き続ける。どちらも黙って諦める
      console.warn(`[atlas] could not load ${target}`, err);
      return false;
    }
  }

  return {
    ensure,
    get atlas() {
      return atlas;
    },
    get resolution() {
      return resolution;
    },
  };
}
