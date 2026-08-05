/**
 * 操作パネルと URL 同期。
 *
 * 表示状態はすべて URL クエリに載せる。リロードで復元でき、そのまま共有もできる:
 *   ?orcid=&rm=&from=&to=&proj=&center=&grain=&theme=&size=&scope=&merge=
 *
 * UI は US 英語 1 言語なので `lang` は持たない。
 *
 * 既定値と同じパラメータは書かない（URL を短く保つ）。
 * パラメータ無しで開いたときはオーナー自身の地図を出す。
 */
import { h, selectEl } from './dom.js';
import {
  PROJECTIONS,
  CENTER_PRESETS,
  DEFAULT_PROJECTION,
  getProjectionSpec,
  normalizeLongitude,
} from '../map/projections.js';
import {
  THEMES,
  THEME_AUTO,
  DEFAULT_THEME,
  isValidTheme,
} from '../map/themes.js';
import {
  GRAIN_MAX,
  GRAIN_COUNTRY,
  DEFAULT_GRAIN,
  parseGrain,
  grainToParam,
  grainToSlider,
  sliderToGrain,
} from '../map/cluster.js';
import { SCOPE_OPTIONS, DEFAULT_SCOPE, parseScope } from '../map/scope.js';
import { normalizeMergeMode } from '../aggregate.js';

/** パラメータ無しで開いたときの既定 = オーナー自身の地図 */
export const DEFAULTS = Object.freeze({
  orcid: '0000-0003-1317-0220',
  rm: 'yk_frkw',
  from: null, // null = データの最小年
  to: null, // null = データの最大年
  proj: DEFAULT_PROJECTION,
  center: 140, // 日本中心。オーナーの地図が既定なので日本を真ん中に置く
  grain: DEFAULT_GRAIN,
  theme: DEFAULT_THEME,
  size: 'papers',
  scope: DEFAULT_SCOPE, // auto = 国 / 地域 / 全世界を共著者の分布から決める
  // OpenAlex の名寄せが分裂させた共著者レコードを統合するか。既定 ON
  merge: true,
});

/**
 * `merge=` の値を URL に載せる形にする。既定（true）は書かない。
 * @param {true|'orcid'|false} value
 * @returns {string}
 */
export function mergeToParam(value) {
  return value === false ? 'off' : String(value);
}

export const SIZE_MODES = [
  { id: 'papers', labelKey: 'ctrl.size.papers' },
  { id: 'coauthors', labelKey: 'ctrl.size.coauthors' },
  { id: 'uniform', labelKey: 'ctrl.size.uniform' },
];

const SIZE_IDS = new Set(SIZE_MODES.map((s) => s.id));

function intOrNull(raw) {
  if (raw == null || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** ORCID は数字とハイフンとチェックディジット X だけ。緩めに整える */
export function cleanOrcid(raw) {
  const s = String(raw ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.)?orcid\.org\//i, '')
    .toUpperCase();
  return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(s)
    ? s
    : s.replace(/[^\dX-]/g, '');
}

/** researchmap の permalink。URL を貼られても拾う */
export function cleanPermalink(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^https?:\/\/researchmap\.jp\//i, '')
    .replace(/[/?#].*$/, '');
}

/** URL クエリから状態を読む */
export function readStateFromUrl(search = window.location.search) {
  const q = new URLSearchParams(search);
  const theme = q.get('theme');
  const proj = q.get('proj');
  const size = q.get('size');

  return {
    orcid: q.has('orcid') ? cleanOrcid(q.get('orcid')) : DEFAULTS.orcid,
    rm: q.has('rm') ? cleanPermalink(q.get('rm')) : DEFAULTS.rm,
    from: intOrNull(q.get('from')),
    to: intOrNull(q.get('to')),
    proj: PROJECTIONS.some((p) => p.id === proj) ? proj : DEFAULTS.proj,
    center: q.has('center')
      ? normalizeLongitude(q.get('center'))
      : DEFAULTS.center,
    // center を書いた URL は「中心を明示した」とみなし、自動フィットの重心より優先する
    centerExplicit: q.has('center'),
    grain: q.has('grain') ? parseGrain(q.get('grain')) : DEFAULTS.grain,
    theme: isValidTheme(theme) ? theme : DEFAULTS.theme,
    size: SIZE_IDS.has(size) ? size : DEFAULTS.size,
    scope: q.has('scope') ? parseScope(q.get('scope')) : DEFAULTS.scope,
    merge: q.has('merge') ? normalizeMergeMode(q.get('merge')) : DEFAULTS.merge,
    rotateLat: 0, // 回転は共有しない（center だけ URL に載せる）
  };
}

/**
 * 状態を URL クエリ文字列にする。既定値は省く。
 * @param {Object} state
 * @param {{from: number, to: number}} [bounds] データの年範囲。同じなら省く
 */
export function stateToQuery(state, bounds) {
  const q = new URLSearchParams();
  if (state.orcid) q.set('orcid', state.orcid);
  if (state.rm) q.set('rm', state.rm);
  if (state.from != null && state.from !== bounds?.from)
    q.set('from', String(state.from));
  if (state.to != null && state.to !== bounds?.to)
    q.set('to', String(state.to));
  if (state.proj !== DEFAULTS.proj) q.set('proj', state.proj);
  // 明示された中心は既定値と同じでも書く。書かないと再読み込みで
  // 「明示した」情報が落ち、自動フィットの重心に乗っ取られてしまう
  if (state.centerExplicit || Math.round(state.center) !== DEFAULTS.center)
    q.set('center', String(Math.round(state.center)));
  if (state.grain !== DEFAULTS.grain) q.set('grain', grainToParam(state.grain));
  if (state.theme !== DEFAULTS.theme) q.set('theme', state.theme);
  if (state.size !== DEFAULTS.size) q.set('size', state.size);
  if (state.scope && state.scope !== DEFAULTS.scope)
    q.set('scope', state.scope);
  if (state.merge !== undefined && state.merge !== DEFAULTS.merge)
    q.set('merge', mergeToParam(state.merge));
  return q.toString();
}

/** アドレスバーを書き換える（履歴は積まない） */
export function syncUrl(state, bounds) {
  const query = stateToQuery(state, bounds);
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', url);
}

/**
 * 操作パネルを組み立てる。
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {(k: string, p?: Object) => string} opts.t
 * @param {Object} opts.state
 * @param {(patch: Object) => void} opts.onChange   表示だけ変わる操作
 * @param {(seeds: {orcid: string, rm: string}) => void} opts.onRebuild  データを取り直す操作
 * @param {() => void} opts.onResetView
 */
export function createControls({
  container,
  t,
  state,
  onChange,
  onRebuild,
  onResetView,
}) {
  let bounds = {
    from: state.from ?? 1990,
    to: state.to ?? new Date().getFullYear(),
  };

  const orcidInput = h('input', {
    type: 'text',
    id: 'seed-orcid',
    value: state.orcid ?? '',
    placeholder: '0000-0000-0000-0000',
    inputmode: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const rmInput = h('input', {
    type: 'text',
    id: 'seed-rm',
    value: state.rm ?? '',
    placeholder: 'yk_frkw',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const seedError = h('p', { class: 'hint', role: 'alert' });

  function submitSeeds(event) {
    event?.preventDefault();
    const orcid = cleanOrcid(orcidInput.value);
    const rm = cleanPermalink(rmInput.value);
    if (!orcid && !rm) {
      seedError.textContent = t('seed.needOne');
      return;
    }
    seedError.textContent = '';
    orcidInput.value = orcid;
    rmInput.value = rm;
    onRebuild({ orcid, rm });
  }

  const seedForm = h('form', { class: 'controls', onsubmit: submitSeeds }, [
    h('div', { class: 'field' }, [
      h('label', { for: 'seed-orcid', text: t('seed.orcid') }),
      orcidInput,
      h('span', { class: 'hint', text: t('seed.orcidHint') }),
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'seed-rm', text: t('seed.rm') }),
      rmInput,
      h('span', { class: 'hint', text: t('seed.rmHint') }),
    ]),
    h('div', { class: 'field' }, [
      h('span', { class: 'field-label', text: ' ' }),
      h('button', { type: 'submit', class: 'primary', text: t('seed.build') }),
    ]),
    h('div', { class: 'field-wide' }, [seedError]),
  ]);

  // ---- 年範囲 ----
  const yearFrom = h('input', { type: 'range', id: 'year-from' });
  const yearTo = h('input', { type: 'range', id: 'year-to' });
  const yearOut = h('output', { for: 'year-from year-to', class: 'hint' });

  function pushYears() {
    let from = Number(yearFrom.value);
    let to = Number(yearTo.value);
    if (from > to) {
      // 追い越したら押し戻す
      if (document.activeElement === yearFrom) to = from;
      else from = to;
      yearFrom.value = String(from);
      yearTo.value = String(to);
    }
    yearOut.textContent = `${from} – ${to}`;
    onChange({ from, to });
  }
  yearFrom.addEventListener('input', pushYears);
  yearTo.addEventListener('input', pushYears);

  // ---- 粒度（国 ←→ 都市） ----
  const grainSlider = h('input', {
    type: 'range',
    id: 'grain',
    min: '0',
    max: String(GRAIN_MAX),
    step: '1',
    value: String(grainToSlider(state.grain)),
    'aria-describedby': 'grain-out',
  });
  const grainOut = h('output', {
    id: 'grain-out',
    for: 'grain',
    class: 'hint',
  });

  function grainText(grain) {
    if (grain === GRAIN_COUNTRY) return t('grain.countryMode');
    if (grain === 0) return t('grain.cityMode');
    return t('grain.radius', { n: grain });
  }
  grainSlider.addEventListener('input', () => {
    const grain = sliderToGrain(grainSlider.value);
    grainOut.textContent = grainText(grain);
    onChange({ grain });
  });

  // ---- 大きさの基準 ----
  const sizeButtons = SIZE_MODES.map((mode) =>
    h('button', {
      type: 'button',
      'aria-pressed': String(state.size === mode.id),
      text: t(mode.labelKey),
      onclick: () => {
        for (const b of sizeButtons) b.setAttribute('aria-pressed', 'false');
        const idx = SIZE_MODES.findIndex((m) => m.id === mode.id);
        sizeButtons[idx].setAttribute('aria-pressed', 'true');
        onChange({ size: mode.id });
      },
    }),
  );

  // ---- 投影法 ----
  const projSelect = selectEl({
    id: 'proj',
    value: state.proj,
    options: PROJECTIONS.map((p) => ({ value: p.id, label: t(p.labelKey) })),
    onChange: (value) => {
      onChange({ proj: value });
      updateHints(value);
    },
  });

  // ---- 表示範囲（自動フィット） ----
  const scopeSelect = selectEl({
    id: 'scope',
    value: state.scope ?? DEFAULTS.scope,
    options: SCOPE_OPTIONS.map((s) => ({ value: s.id, label: t(s.labelKey) })),
    onChange: (value) => onChange({ scope: value }),
  });

  // ---- 中心経度 ----
  const centerPreset = selectEl({
    id: 'center-preset',
    value: presetIdFor(state.center),
    options: [
      ...CENTER_PRESETS.map((p) => ({ value: p.id, label: t(p.labelKey) })),
      { value: 'custom', label: t('center.custom') },
    ],
    onChange: (value) => {
      const preset = CENTER_PRESETS.find((p) => p.id === value);
      if (!preset) return;
      centerSlider.value = String(preset.lon);
      centerOut.textContent = formatLon(preset.lon);
      // 手で選んだ中心は自動フィットの重心より優先する
      onChange({ center: preset.lon, centerExplicit: true });
    },
  });
  const centerSlider = h('input', {
    type: 'range',
    id: 'center',
    min: '-180',
    max: '180',
    step: '1',
    value: String(Math.round(state.center)),
  });
  const centerOut = h('output', { for: 'center', class: 'hint' });
  centerSlider.addEventListener('input', () => {
    const lon = normalizeLongitude(centerSlider.value);
    centerOut.textContent = formatLon(lon);
    centerPreset.value = presetIdFor(lon);
    onChange({ center: lon, centerExplicit: true });
  });

  // ---- テーマ ----
  const themeSelect = selectEl({
    id: 'theme',
    value: state.theme,
    options: [
      { value: THEME_AUTO, label: t('theme.auto') },
      ...THEMES.map((th) => ({ value: th.id, label: t(th.labelKey) })),
    ],
    onChange: (value) => onChange({ theme: value }),
  });

  const projHint = h('span', { class: 'hint' });
  function updateHints(projId) {
    const spec = getProjectionSpec(projId);
    projHint.textContent = spec.rotatable
      ? t('ctrl.rotateHint')
      : t('ctrl.panHint');
  }
  updateHints(state.proj);

  const viewForm = h('div', { class: 'controls' }, [
    h('div', { class: 'field' }, [
      h('span', { class: 'field-label', text: t('ctrl.years') }),
      yearFrom,
      yearTo,
      yearOut,
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'grain', text: t('ctrl.grain') }),
      h('div', { class: 'map-legend' }, [
        h('span', { text: t('grain.country') }),
        h('span', { text: '←→' }),
        h('span', { text: t('grain.city') }),
      ]),
      grainSlider,
      grainOut,
    ]),
    h('div', { class: 'field' }, [
      h('span', { class: 'field-label', text: t('ctrl.size') }),
      h('div', { class: 'segmented' }, sizeButtons),
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'proj', text: t('ctrl.projection') }),
      projSelect,
      projHint,
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'scope', text: t('ctrl.scope') }),
      scopeSelect,
      h('span', { class: 'hint', text: t('ctrl.scopeHint') }),
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'center', text: t('ctrl.center') }),
      centerPreset,
      centerSlider,
      centerOut,
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'theme', text: t('ctrl.theme') }),
      themeSelect,
      h('button', {
        type: 'button',
        text: t('ctrl.reset'),
        onclick: () => onResetView?.(),
      }),
    ]),
    h('div', { class: 'field-wide' }, [
      h('p', { class: 'hint', text: t('grain.hint') }),
    ]),
  ]);

  container.append(seedForm, viewForm);

  function presetIdFor(lon) {
    const hit = CENTER_PRESETS.find(
      (p) => Math.round(p.lon) === Math.round(lon),
    );
    return hit ? hit.id : 'custom';
  }

  function formatLon(lon) {
    const n = Math.round(lon);
    if (n === 0) return '0°';
    return n > 0 ? `${n}°E` : `${-n}°W`;
  }

  /** データが来たら年スライダーの範囲を実データに合わせる */
  function setYearBounds(min, max, current) {
    bounds = { from: min, to: max };
    for (const el of [yearFrom, yearTo]) {
      el.min = String(min);
      el.max = String(max);
      el.step = '1';
    }
    yearFrom.value = String(current?.from ?? min);
    yearTo.value = String(current?.to ?? max);
    yearOut.textContent = `${yearFrom.value} – ${yearTo.value}`;
    return { from: Number(yearFrom.value), to: Number(yearTo.value) };
  }

  /** 外から状態を戻す（回転で center が動いたときなど） */
  function syncFromState(next) {
    if (next.center != null) {
      centerSlider.value = String(Math.round(next.center));
      centerOut.textContent = formatLon(next.center);
      centerPreset.value = presetIdFor(next.center);
    }
    if (next.grain != null) {
      grainSlider.value = String(grainToSlider(next.grain));
      grainOut.textContent = grainText(next.grain);
    }
  }

  // 初期表示
  centerOut.textContent = formatLon(state.center);
  grainOut.textContent = grainText(state.grain);

  return {
    setYearBounds,
    syncFromState,
    submitSeeds,
    get bounds() {
      return bounds;
    },
  };
}
