/**
 * SVG 地図の描画。
 *
 * 設計上の要点:
 *  - 再描画は d3 の join による差分更新。テーマ切替や年フィルタでちらつかせない
 *  - ズームは幾何変換ではなく投影パラメータを動かす「セマンティックズーム」。
 *    線幅とピン半径が拡大率に依存せず、日付変更線のクリップも効き続ける。
 *    粒度クラスタリングが画面距離で効くのも、これがあるおかげで自動追従する
 *  - ピンの大きさは scaleSqrt。面積が値に比例する（半径比例にすると誇張される）
 *  - 重なりは「大きい順に描く」で解決。小さいピンが必ず前面に来る
 *  - 地図データ（countries-*.json）は public/ から実行時 fetch。
 *    TopoJSON をバンドルに焼き込まない。始まりは常に 110m で、国 / 地域に
 *    フィットしたときと大きく拡大したときだけ 50m に差し替える（atlas.js 参照）。
 *    差し替えは land / borders の d 属性を書き換えるだけなので、
 *    ピン・ズーム・ラベルの状態はそのまま残る。書き出し（SVG / PNG）は
 *    表示中の SVG を直列化するので、そのとき描いている解像度がそのまま出る
 */
import { select } from 'd3-selection';
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom';
import { drag as d3drag } from 'd3-drag';
import { scaleSqrt } from 'd3-scale';
import { geoPath, geoGraticule10 } from 'd3-geo';
import {
  createProjection,
  applyZoom,
  createVisibilityTest,
  dragToRotation,
  normalizeLongitude,
  clampRotateLat,
  getProjectionSpec,
} from './projections.js';
import {
  buildCountryNodes,
  clusterPlaced,
  GRAIN_COUNTRY,
  DEFAULT_GRAIN,
} from './cluster.js';
import {
  resolveFit,
  createCountryLocator,
  SCOPE_AUTO,
  SCOPE_WORLD,
} from './scope.js';
import {
  createAtlasProvider,
  resolutionFor,
  RESOLUTION_LOW,
  RESOLUTION_HIGH,
} from './atlas.js';
import { regionLabelKey } from './regions.js';

const SPHERE = { type: 'Sphere' };
const GRATICULE = geoGraticule10();

const MIN_RADIUS = 2.5;
const UNIFORM_RADIUS = 5;
const MAX_LABELS = 10;
const TOOLTIP_INSTITUTIONS = 5;
const TOOLTIP_COAUTHORS = 8;
const TOOLTIP_CITIES = 6;

let sharedProvider = null;

/**
 * ページ全体で 1 つの atlas 供給元を共有する。
 * 地図を 2 つ立てても同じファイルを二度取りに行かせないため。
 */
export function getAtlasProvider() {
  if (!sharedProvider) {
    sharedProvider = createAtlasProvider({
      baseUrl: import.meta.env.BASE_URL,
    });
  }
  return sharedProvider;
}

/** ピンの値を取り出す */
function metricValue(node, sizeMode) {
  if (sizeMode === 'coauthors') return node.coauthorCount;
  if (sizeMode === 'uniform') return 1;
  return node.paperCount;
}

/** HTML 埋め込み用の最小エスケープ */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 地図レンダラを作る。
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.container   地図を入れる要素（position: relative の .map-wrap）
 * @param {(k: string, p?: Object) => string} opts.t  翻訳関数
 * @param {boolean} [opts.compact]       widget 用に余白と最大高を詰める
 * @param {ReturnType<createAtlasProvider>} [opts.atlasProvider] 既定はページ共有のもの
 */
export function createMapRenderer({
  container,
  t,
  compact = false,
  atlasProvider = getAtlasProvider(),
}) {
  const wrap = select(container);
  wrap.selectAll('*').remove();

  const svg = wrap
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('role', 'img')
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const gRoot = svg.append('g').attr('class', 'map-root');
  const pSphere = gRoot.append('path').attr('class', 'map-sphere');
  const pGraticule = gRoot.append('path').attr('class', 'map-graticule');
  const pLand = gRoot.append('path').attr('class', 'map-land');
  const pBorders = gRoot.append('path').attr('class', 'map-borders');
  const gPins = gRoot.append('g').attr('class', 'map-pins');
  const gLabels = gRoot.append('g').attr('class', 'map-labels');

  const tooltip = wrap
    .append('div')
    .attr('class', 'map-tooltip')
    .attr('role', 'status')
    .attr('aria-live', 'polite')
    .property('hidden', true);

  /** 現在の状態 */
  const state = {
    cities: [],
    grain: DEFAULT_GRAIN,
    projectionId: 'equalEarth',
    centerLon: 0,
    /** 利用者が中心経度を明示したか。false なら自動フィットの重心に譲る */
    centerExplicit: false,
    rotateLat: 0,
    sizeMode: 'papers',
    scope: SCOPE_AUTO,
    ariaLabel: '',
    width: 320,
    height: 180,
  };

  let atlas = null;
  let locator = null;
  let countryNodesCache = null;
  let countryNodesKey = null;
  let projectionState = null;
  let transform = zoomIdentity;
  let activeKey = null;
  let onRotate = null;
  let onNodes = null;
  let destroyed = false;
  /** 現在のフィット対象。null なら次の rebuild で引き直す */
  let fit = null;
  /** 利用者がズーム・パン・回転したか。true のあいだは勝手に再フィットしない */
  let userMoved = false;
  /** 50m をもう頼んだか。成否によらず 1 回で打ち止めにする */
  let highResRequested = false;

  // ---- ズーム（全投影法共通。正射図法では倍率だけ使う） ----
  const zoomBehavior = d3zoom()
    .scaleExtent([1, 14])
    .on('zoom', (event) => {
      transform = event.transform;
      // sourceEvent が無いのは resetView などのプログラム側の操作。
      // 利用者の操作だけを「動かした」と数える
      if (event.sourceEvent) userMoved = true;
      // 大きく拡大したら海岸線を精細にする（届くのは数百 ms 後。描画は待たない）
      syncResolution();
      draw();
    });

  // ---- 回転ドラッグ（正射図法のみ） ----
  const dragBehavior = d3drag().on('drag', (event) => {
    if (!projectionState?.spec.rotatable) return;
    userMoved = true;
    state.centerExplicit = true;
    const { dLon, dLat } = dragToRotation(
      event.dx,
      event.dy,
      projectionState.projection.scale(),
    );
    state.centerLon = normalizeLongitude(state.centerLon + dLon);
    state.rotateLat = clampRotateLat(state.rotateLat + dLat);
    projectionState.projection.rotate([-state.centerLon, -state.rotateLat, 0]);
    hideTooltip();
    draw();
    onRotate?.({ centerLon: state.centerLon, rotateLat: state.rotateLat });
  });

  svg.call(zoomBehavior).call(dragBehavior);
  svg.on('dblclick.zoom', null);

  // 空白クリックと Esc でツールチップを閉じる
  svg.on('pointerdown', (event) => {
    if (event.target === svg.node()) hideTooltip();
  });
  container.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideTooltip();
  });

  // ---- サイズ追従 ----
  function computeSize() {
    const w = Math.max(240, Math.round(container.clientWidth || 320));
    const spec = getProjectionSpec(state.projectionId);
    const maxH = compact ? 520 : 620;
    // 地球儀は正方形に近いほうが収まりがよい。平面図は横長に取る
    const ratio = spec.rotatable ? 0.92 : 0.52;
    // 狭い画面では横長にしすぎると地図が潰れるので下限を高めに取る
    const minH = w < 420 ? 240 : 200;
    const h = Math.round(Math.max(minH, Math.min(maxH, w * ratio)));
    return { width: w, height: h };
  }

  /** 実測サイズを state に取り込む。変化があったら true */
  function syncSize() {
    const next = computeSize();
    if (next.width === state.width && next.height === state.height)
      return false;
    state.width = next.width;
    state.height = next.height;
    return true;
  }

  function onResize() {
    if (destroyed) return;
    if (!syncSize()) return;
    rebuildProjection();
    draw();
  }

  // ResizeObserver が本命だが、背面タブなど配信が止まる状況があるので
  // window の resize と update() 側の実測もあわせて使う（三重に張る）
  const ro =
    typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
  ro?.observe(container);
  window.addEventListener('resize', onResize);

  /**
   * 表示スコープを引き直す。atlas が来る前は世界地図のまま（ポリゴンが無いので
   * 国を特定できない）。atlas が届いた時点でもう一度呼ばれる。
   */
  function resolveScope() {
    if (!locator) {
      return {
        scope: SCOPE_WORLD,
        geometry: null,
        centerLon: null,
        label: null,
      };
    }
    return resolveFit({
      cities: state.cities,
      locator,
      scope: state.scope,
    });
  }

  function rebuildProjection() {
    if (!fit) fit = resolveScope();
    // 中心経度は「明示されていれば利用者の値、そうでなければ対象の重心」。
    // 重心は d3.geoCentroid の球面重心なので、日付変更線をまたぐ地域でも折り返さない
    const centerLon =
      !state.centerExplicit && fit.centerLon != null
        ? fit.centerLon
        : state.centerLon;

    projectionState = createProjection({
      id: state.projectionId,
      centerLon,
      rotateLat: state.rotateLat,
      width: state.width,
      height: state.height,
      padding: compact ? 4 : 8,
      fitTarget: fit.geometry,
    });
    syncResolution();
    // 正射図法では zoom のドラッグを止め、回転ドラッグに譲る
    if (projectionState.spec.rotatable) {
      zoomBehavior.filter(
        (event) => event.type === 'wheel' || event.touches?.length > 1,
      );
    } else {
      zoomBehavior.filter(
        (event) => !event.button && event.type !== 'dblclick',
      );
    }
  }

  /** 粒度に応じた「投影前」のノード列 */
  function baseNodes() {
    if (state.grain !== GRAIN_COUNTRY) return state.cities;
    // 国重心は atlas に依存するので、都市集合と atlas の有無でキャッシュを判定する
    const key = `${state.cities.length}:${state.cities[0]?.key ?? ''}:${atlas ? 1 : 0}:${
      state.cities.at(-1)?.key ?? ''
    }`;
    if (countryNodesKey !== key) {
      countryNodesCache = buildCountryNodes(state.cities, atlas);
      countryNodesKey = key;
    }
    return countryNodesCache;
  }

  // ---- ツールチップ ----
  function listWithRest(items, limit, toText) {
    const shown = items.slice(0, limit);
    const rest = items.length - shown.length;
    const body = shown.map((x) => `<li>${esc(toText(x))}</li>`).join('');
    const more =
      rest > 0
        ? `<li class="hint">${esc(t('tip.andMore', { n: rest }))}</li>`
        : '';
    return `<ul>${body}${more}</ul>`;
  }

  function tooltipHtml(node) {
    const members = node.members ?? [node];
    const grouped = members.length > 1;
    const parts = [];

    parts.push(`<h3>${esc(node.city ?? '—')}</h3>`);
    if (!node.isCountry && node.country) {
      parts.push(`<p class="hint">${esc(node.country)}</p>`);
    }

    const dl = [
      `<dt>${esc(t('tip.papers'))}</dt><dd>${node.paperCount}</dd>`,
      `<dt>${esc(t('tip.coauthors'))}</dt><dd>${node.coauthorCount}</dd>`,
      `<dt>${esc(t('tip.institutions'))}</dt><dd>${node.institutions.length}</dd>`,
    ];
    if (grouped)
      dl.push(`<dt>${esc(t('tip.cities'))}</dt><dd>${members.length}</dd>`);
    parts.push(`<dl>${dl.join('')}</dl>`);

    if (grouped) {
      // 塊のときは「都市 → その機関」の入れ子で見せる
      const shown = members.slice(0, TOOLTIP_CITIES);
      const rest = members.length - shown.length;
      const rows = shown
        .map((m) => {
          const inst = m.institutions
            .slice(0, 2)
            .map((i) => i.name)
            .join(', ');
          const more =
            m.institutions.length > 2 ? ` +${m.institutions.length - 2}` : '';
          return `<li><b>${esc(m.city ?? '—')}</b> (${m.paperCount})${
            inst ? `<br><span class="hint">${esc(inst)}${esc(more)}</span>` : ''
          }</li>`;
        })
        .join('');
      const moreRow =
        rest > 0
          ? `<li class="hint">${esc(t('tip.andMore', { n: rest }))}</li>`
          : '';
      parts.push(`<ul>${rows}${moreRow}</ul>`);
    } else if (node.institutions.length) {
      parts.push(
        listWithRest(node.institutions, TOOLTIP_INSTITUTIONS, (i) => i.name),
      );
    }

    if (node.coauthors.length) {
      const shown = node.coauthors.slice(0, TOOLTIP_COAUTHORS);
      const rest = node.coauthors.length - shown.length;
      parts.push(
        `<p>${shown.map((c) => esc(c.name)).join(', ')}` +
          (rest > 0
            ? ` <span class="hint">${esc(t('tip.andMore', { n: rest }))}</span>`
            : '') +
          `</p>`,
      );
    }
    return parts.join('');
  }

  function showTooltip(node, x, y) {
    activeKey = node.key;
    tooltip.property('hidden', false).html(tooltipHtml(node));
    const el = tooltip.node();
    const box = el.getBoundingClientRect();
    const w = container.clientWidth;
    const h = container.clientHeight;
    // SVG は viewBox 座標なので、実 px に直してから配置して画面内に収める
    const sx = (x / state.width) * w;
    const sy = (y / state.height) * h;
    el.style.left = `${Math.max(6, Math.min(Math.max(6, w - box.width - 6), sx - box.width / 2))}px`;
    el.style.top = `${Math.max(6, Math.min(Math.max(6, h - box.height - 6), sy - box.height - 14))}px`;
    gPins.selectAll('circle').classed('is-active', (d) => d.key === activeKey);
  }

  function hideTooltip() {
    activeKey = null;
    tooltip.property('hidden', true).html('');
    gPins.selectAll('circle').classed('is-active', false);
  }

  function nodeAria(node) {
    const members = node.members ?? [node];
    if (members.length > 1) {
      return t('map.pinAriaCluster', {
        city: node.city ?? '—',
        cities: members.length,
        papers: node.paperCount,
        coauthors: node.coauthorCount,
      });
    }
    return t('map.pinAria', {
      city: node.city ?? '—',
      country: node.country ?? node.countryCode ?? '—',
      papers: node.paperCount,
      coauthors: node.coauthorCount,
      institutions: node.institutions.length,
    });
  }

  function nodeLabel(node) {
    const members = node.members ?? [node];
    if (members.length > 1 && !node.isCountry) {
      return `${node.city} ${t('map.clusterMore', { n: members.length - 1 })}`;
    }
    return node.city;
  }

  // ---- 描画本体 ----
  function draw() {
    if (!projectionState) rebuildProjection();
    const { projection, spec, base } = projectionState;
    applyZoom(projection, spec, base, transform);
    const path = geoPath(projection);
    const visible = createVisibilityTest(projection, spec);

    svg
      .attr('viewBox', `0 0 ${state.width} ${state.height}`)
      .attr('aria-label', state.ariaLabel);

    pSphere.attr('d', path(SPHERE) || '');
    pGraticule.attr('d', path(GRATICULE) || '');
    if (atlas) {
      pLand.attr('d', path(atlas.land) || '');
      pBorders.attr('d', path(atlas.borders) || '');
    }

    // 1) 投影して、画面に載るものだけ残す
    const projected = [];
    for (const node of baseNodes()) {
      if (!Number.isFinite(node.lat) || !Number.isFinite(node.lng)) continue;
      if (!visible(node.lng, node.lat)) continue;
      const xy = projection([node.lng, node.lat]);
      if (!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) continue;
      projected.push({ node, x: xy[0], y: xy[1] });
    }

    // 2) 画面座標でまとめる。ズームすると画面距離が広がるので塊は自動でほどける
    const radiusPx = state.grain === GRAIN_COUNTRY ? 0 : state.grain;
    const nodes = clusterPlaced(projected, radiusPx);

    // 3) 値 → 半径。面積比例なので scaleSqrt
    const values = nodes.map((n) => metricValue(n, state.sizeMode));
    const maxValue = values.length ? Math.max(...values) : 1;
    const maxRadius = Math.max(9, Math.min(26, state.width / 26));
    const radiusScale = scaleSqrt()
      .domain([0, maxValue || 1])
      .range([0, maxRadius]);
    for (const n of nodes) {
      n.r =
        state.sizeMode === 'uniform'
          ? UNIFORM_RADIUS
          : Math.max(MIN_RADIUS, radiusScale(metricValue(n, state.sizeMode)));
    }

    // 4) 大きい順に描く → 小さいピンが前面に来て、埋もれない
    nodes.sort(
      (a, b) => b.r - a.r || String(a.key).localeCompare(String(b.key)),
    );

    gPins
      .selectAll('circle')
      .data(nodes, (d) => d.key)
      .join(
        (enter) =>
          enter
            .append('circle')
            .attr('class', 'map-pin')
            .attr('tabindex', 0)
            .attr('role', 'button')
            .on('pointerenter', (event, d) => {
              if (event.pointerType === 'touch') return;
              showTooltip(d, d.x, d.y);
            })
            .on('pointerleave', (event) => {
              if (event.pointerType === 'touch') return;
              hideTooltip();
            })
            .on('click', (event, d) => {
              event.stopPropagation();
              if (activeKey === d.key) hideTooltip();
              else showTooltip(d, d.x, d.y);
            })
            .on('focus', (event, d) => showTooltip(d, d.x, d.y))
            .on('blur', () => hideTooltip()),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .attr('r', (d) => d.r)
      .attr('aria-label', nodeAria)
      .classed('is-active', (d) => d.key === activeKey)
      .order();

    // ラベルは上位だけ。全部出すと 69 地点で読めなくなる。
    // さらに、重なるものは後ろから落とす（欧州の団子で文字が潰れるのを避ける）
    const candidates = nodes
      .slice()
      .sort(
        (a, b) =>
          metricValue(b, state.sizeMode) - metricValue(a, state.sizeMode),
      )
      .filter((d) => d.city)
      .slice(0, MAX_LABELS * 2);

    const boxes = [];
    const labelled = [];
    for (const d of candidates) {
      if (labelled.length >= MAX_LABELS) break;
      const text = nodeLabel(d);
      const halfWidth = (String(text).length * 4.8) / 2 + 2;
      const lx = Math.max(
        halfWidth + 2,
        Math.min(state.width - halfWidth - 2, d.x),
      );
      const ly = Math.max(11, d.y - d.r - 4);
      const box = {
        x0: lx - halfWidth,
        x1: lx + halfWidth,
        y0: ly - 10,
        y1: ly + 3,
      };
      const hits = boxes.some(
        (b) =>
          !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1),
      );
      if (hits) continue;
      boxes.push(box);
      labelled.push({ ...d, lx, ly, labelText: text });
    }

    gLabels
      .selectAll('text')
      .data(labelled, (d) => d.key)
      .join('text')
      .attr('class', 'map-label')
      .attr('text-anchor', 'middle')
      .attr('x', (d) => d.lx)
      .attr('y', (d) => d.ly)
      .text((d) => d.labelText);

    const result = {
      nodes,
      radiusScale,
      maxValue,
      maxRadius,
      pinCount: nodes.length,
      fit: { scope: fit?.scope ?? SCOPE_WORLD, label: fit?.label ?? null },
    };
    onNodes?.(result);
    return result;
  }

  let lastDraw = null;

  /** 状態を差し込んで描き直す */
  function update(next = {}) {
    const projectionChanged =
      next.projectionId !== undefined &&
      next.projectionId !== state.projectionId;
    const scopeChanged = next.scope !== undefined && next.scope !== state.scope;
    const citiesChanged = next.cities != null && next.cities !== state.cities;
    if (citiesChanged) countryNodesKey = null;
    Object.assign(state, next);
    state.centerLon = normalizeLongitude(state.centerLon);
    state.rotateLat = clampRotateLat(state.rotateLat);

    // スコープを選び直したのは明示の指示なので、動かした後でも従う。
    // 国の集合が変わっただけのときは、利用者が動かしていないときだけ追従する
    if (scopeChanged) {
      fit = null;
      userMoved = false;
      transform = zoomIdentity;
      svg.call(zoomBehavior.transform, zoomIdentity);
    } else if (citiesChanged && !userMoved) {
      fit = null;
    }

    // 毎回実測する。ResizeObserver が来ない環境（背面タブなど）でも
    // 幅が変われば必ず追従させるため、ここを唯一の拠りどころにする
    syncSize();
    if (projectionChanged) {
      // 投影法を変えると高さの比率も変わる。ズームも初期化する
      transform = zoomIdentity;
      svg.call(zoomBehavior.transform, zoomIdentity);
    }
    rebuildProjection();
    lastDraw = draw();
    return lastDraw;
  }

  function resetView() {
    transform = zoomIdentity;
    svg.call(zoomBehavior.transform, zoomIdentity);
    hideTooltip();
    // 「リセット」は自動フィットに戻す操作でもある。
    // 回転や中心スライダーで付いた「明示した」印もここで解除する
    userMoved = false;
    state.centerExplicit = false;
    fit = null;
    rebuildProjection();
    lastDraw = draw();
    return lastDraw;
  }

  /**
   * 届いた atlas を受け取る。
   *
   * 最初の 1 枚（110m）が来たときだけフィットを引き直す。ポリゴンが揃って初めて
   * 国 / 地域を特定できるため。50m への差し替えでは投影に一切触らない
   * ——ズームもピンの位置も動かさず、陸と国境の輪郭だけが精細になる。
   */
  function adoptAtlas(loaded) {
    if (!loaded || loaded === atlas) return;
    const first = !atlas;
    atlas = loaded;
    locator = createCountryLocator(loaded.land?.features ?? []);
    // 国重心はポリゴン由来なので、解像度が変われば作り直す（キーは変わらない）
    countryNodesKey = null;
    if (first && !userMoved) {
      fit = null;
      rebuildProjection();
    }
    lastDraw = draw();
  }

  /**
   * いまの表示に見合う解像度を確かめ、足りなければ引き上げる。
   * 引き下げはしない（一度精細にした地図を粗く戻すとちらつくため）。
   */
  function syncResolution() {
    if (highResRequested) return;
    const want = resolutionFor({
      scope: fit?.scope,
      scaleRatio: transform.k,
    });
    if (want !== RESOLUTION_HIGH) return;
    highResRequested = true;
    atlasProvider.ensure(RESOLUTION_HIGH).then(() => {
      // 失敗したら解像度は上がらない。何もせず 110m のまま動き続ける
      if (destroyed || atlasProvider.resolution !== RESOLUTION_HIGH) return;
      adoptAtlas(atlasProvider.atlas);
    });
  }

  // 起動時に読むのは 110m だけ。50m は必要になってから取りに行く
  atlasProvider.ensure(RESOLUTION_LOW).then(() => {
    // 陸が描けなくてもピンと経緯線は出す（atlas が null のままでも draw は通る）
    if (!destroyed) adoptAtlas(atlasProvider.atlas);
  });

  return {
    update,
    resetView,
    hideTooltip,
    /** 回転ドラッグの結果を URL 等に反映するためのフック */
    onRotate(fn) {
      onRotate = fn;
    },
    /** 描画のたびに呼ばれる。凡例とピン数表示の更新用 */
    onNodes(fn) {
      onNodes = fn;
    },
    get svgNode() {
      return svg.node();
    },
    get size() {
      return { width: state.width, height: state.height };
    },
    get lastDraw() {
      return lastDraw;
    },
    destroy() {
      destroyed = true;
      ro?.disconnect();
      wrap.selectAll('*').remove();
    },
  };
}

/**
 * 凡例。ピンの大きさが何を表すかを、実際の円で見せる。
 */
export function renderLegend(
  el,
  { sizeMode, maxValue, maxRadius, pinCount, fitNote, t },
) {
  const host = select(el);
  host.selectAll('*').remove();

  if (sizeMode !== 'uniform' && maxValue) {
    const metricLabel =
      sizeMode === 'coauthors'
        ? t('ctrl.size.coauthors')
        : t('ctrl.size.papers');
    const steps = [maxValue, Math.max(1, Math.round(maxValue / 4)), 1].filter(
      (v, i, a) => a.indexOf(v) === i,
    );
    const scale = scaleSqrt()
      .domain([0, maxValue])
      .range([0, maxRadius ?? 18]);

    const swatches = host.append('div').attr('class', 'legend-swatches');
    for (const v of steps) {
      const r = Math.max(MIN_RADIUS, scale(v));
      const g = swatches.append('div');
      g.append('svg')
        .attr('width', r * 2 + 2)
        .attr('height', r * 2 + 2)
        .attr('aria-hidden', 'true')
        .append('circle')
        .attr('class', 'legend-dot')
        .attr('cx', r + 1)
        .attr('cy', r + 1)
        .attr('r', r);
      g.append('div').style('text-align', 'center').text(v);
    }
    host.append('span').text(t('map.legendSize', { metric: metricLabel }));
  }

  if (Number.isFinite(pinCount)) {
    host.append('span').text(t('map.pinCount', { n: pinCount }));
  }

  // 自動で範囲が決まったことが分かるように短く添える（世界地図のときは出さない）
  if (fitNote) host.append('span').text(fitNote);
}

/**
 * フィット結果を読める一文にする。世界全体なら空文字。
 * @param {{label: Object|null}|null} fit
 * @param {(k: string, p?: Object) => string} t
 */
export function fitNoteText(fit, t) {
  const label = fit?.label;
  if (!label) return '';
  const name =
    label.type === 'region' ? t(regionLabelKey(label.region)) : label.name;
  return name ? t('map.fittedTo', { name }) : '';
}
