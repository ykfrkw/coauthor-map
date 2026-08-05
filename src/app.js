/**
 * 画面の組み立て。index.html / widget.html / dev.html はすべてここを通る。
 *
 * データ層との接点は `loadDataset` の 1 引数だけ。
 * 本番は src/main.js が pipeline.js の buildDataset を渡し、
 * 開発中は src/dev.js が fixture の snapshot を渡す。
 */
import { createMapRenderer, renderLegend } from './map/render.js';
import { applyTheme, watchSystemTheme, THEME_AUTO } from './map/themes.js';
import { createTranslator, formatNumber } from './ui/i18n.js';
import { h, replaceChildren } from './ui/dom.js';
import { readStateFromUrl, syncUrl, createControls } from './ui/controls.js';
import { normalizeDataset, applyCuration, filterDataset } from './ui/derive.js';
import { createTableView } from './ui/table.js';
import { createCurationPanel } from './ui/curation.js';
import {
  loadLocalCuration,
  mergeCurations,
  loadCommittedCuration,
} from './curation.js';
import { createExportPanel } from './ui/export.js';
import { createEmbedPanel } from './ui/embed-snippet.js';

/** data-i18n が付いた静的要素に文言を流し込む */
export function applyStaticI18n(root, t) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  }
}

const STAT_KEYS = [
  ['papers', 'stat.papers'],
  ['coauthors', 'stat.coauthors'],
  ['institutions', 'stat.institutions'],
  ['cities', 'stat.cities'],
  ['countries', 'stat.countries'],
];

/**
 * @param {Object} opts
 * @param {(options: Object) => Promise<Object>} opts.loadDataset  BuildOptions => Dataset
 * @param {'full'|'widget'} [opts.mode]
 */
export function createApp({ loadDataset, mode = 'full' }) {
  const state = readStateFromUrl();
  const t = createTranslator();
  applyTheme(state.theme);
  applyStaticI18n(document, t);

  const el = (id) => document.getElementById(id);
  const mapEl = el('map');
  const legendEl = el('legend');
  const statusEl = el('status');
  const statsEl = el('stats');

  const renderer = createMapRenderer({
    container: mapEl,
    t,
    compact: mode === 'widget',
  });

  /** 手直し前 / 適用後 / 年で切った後 */
  let rawDataset = null;
  let curatedDataset = null;
  let view = null;
  let curation = null;
  let controls = null;
  let curationPanel = null;
  let embedPanel = null;
  let tableView = null;

  const seedKey = () => `${state.orcid || '-'}|${state.rm || '-'}`;
  const bounds = () => ({
    from: rawDataset?.stats?.yearMin ?? state.from ?? 1990,
    to: rawDataset?.stats?.yearMax ?? state.to ?? new Date().getFullYear(),
  });

  function setStatus(kind, text, extra) {
    if (!statusEl) return;
    if (!text) {
      replaceChildren(statusEl);
      return;
    }
    replaceChildren(
      statusEl,
      h('p', { class: kind === 'error' ? 'notice is-error' : 'notice' }, [
        text,
        extra ? h('span', { class: 'hint', text: ` ${extra}` }) : null,
      ]),
    );
  }

  function ariaLabel() {
    if (!view) return t('app.title');
    return t('map.aria', {
      cities: view.summary.cities,
      countries: view.summary.countries,
      coauthors: view.summary.coauthors,
      papers: view.summary.papers,
      from: view.range.from,
      to: view.range.to,
    });
  }

  function paintStats() {
    if (!statsEl || !view) return;
    replaceChildren(
      statsEl,
      ...STAT_KEYS.map(([key, labelKey]) =>
        h('div', { class: 'stat' }, [
          h('b', { text: formatNumber(view.summary[key]) }),
          h('span', { text: t(labelKey) }),
        ]),
      ),
      h('div', { class: 'stat' }, [
        h('b', { text: `${view.range.from}–${view.range.to}` }),
        h('span', { text: t('stat.years') }),
      ]),
    );
  }

  /** 年フィルタから下だけを描き直す（データ取得はしない） */
  function refreshView() {
    if (!curatedDataset) return;
    const b = bounds();
    const range = {
      from: state.from ?? b.from,
      to: state.to ?? b.to,
    };
    view = filterDataset(curatedDataset, range);

    const drawn = renderer.update({
      cities: view.cities,
      grain: state.grain,
      projectionId: state.proj,
      centerLon: state.center,
      rotateLat: state.rotateLat ?? 0,
      sizeMode: state.size,
      ariaLabel: ariaLabel(),
    });

    if (legendEl && drawn) {
      renderLegend(legendEl, {
        sizeMode: state.size,
        maxValue: drawn.maxValue,
        maxRadius: drawn.maxRadius,
        pinCount: drawn.pinCount,
        t,
      });
    }
    paintStats();
    tableView?.update(view, rawDataset.stats);
    embedPanel?.refresh();
    if (!view.cities.length) setStatus('info', t('map.empty'));
    else setStatus(null, '');
    syncUrl(state, b);
  }

  /** 手直しを当て直してから refreshView */
  function reapplyCuration() {
    if (!rawDataset) return;
    curatedDataset = applyCuration(rawDataset, curation);
    refreshView();
  }

  /** データ層を呼ぶ。ここだけが通信する */
  async function build() {
    const seeds = [];
    if (state.orcid) seeds.push({ kind: 'orcid', value: state.orcid });
    if (state.rm) seeds.push({ kind: 'researchmap', value: state.rm });
    if (!seeds.length) {
      setStatus('error', t('seed.needOne'));
      return;
    }

    setStatus('info', t('load.start'));

    try {
      // リポジトリに commit 済みの確定版と、このブラウザの下書きを重ねる
      const committed = state.orcid
        ? await loadCommittedCuration(state.orcid)
        : null;
      curation = mergeCurations(committed, loadLocalCuration(seedKey()));
      const dataset = await loadDataset({
        seeds,
        curation,
        onProgress: (msg, done, total) => {
          const suffix =
            Number.isFinite(total) && total > 0 ? ` (${done}/${total})` : '';
          setStatus('info', `${msg}${suffix}`);
        },
      });
      rawDataset = normalizeDataset(dataset);

      const b = bounds();
      // URL の年が範囲外なら丸める
      state.from = Math.max(b.from, Math.min(b.to, state.from ?? b.from));
      state.to = Math.max(b.from, Math.min(b.to, state.to ?? b.to));
      if (state.from > state.to) [state.from, state.to] = [b.from, b.to];
      controls?.setYearBounds(b.from, b.to, { from: state.from, to: state.to });

      curationPanel?.setSeedKey(seedKey());
      curation = curationPanel?.curation ?? curation;
      reapplyCuration();

      for (const warning of rawDataset.warnings ?? [])
        setStatus('info', warning);
    } catch (err) {
      setStatus(
        'error',
        `${t('load.failed')} ${err?.message ?? err}`,
        t('load.hintNetwork'),
      );
    }
  }

  // ---- 操作パネル（widget では出さない） ----
  if (mode === 'full') {
    const controlsEl = el('controls');
    if (controlsEl) {
      controls = createControls({
        container: controlsEl,
        t,
        state,
        onChange: (patch) => {
          Object.assign(state, patch);
          if (patch.theme) applyTheme(state.theme);
          if (patch.from != null || patch.to != null || patch.grain != null)
            refreshView();
          else refreshView();
        },
        onRebuild: (seeds) => {
          Object.assign(state, seeds);
          state.from = null;
          state.to = null;
          build();
        },
        onResetView: () => {
          const drawn = renderer.resetView();
          if (legendEl && drawn) {
            renderLegend(legendEl, {
              sizeMode: state.size,
              maxValue: drawn.maxValue,
              maxRadius: drawn.maxRadius,
              pinCount: drawn.pinCount,
              t,
            });
          }
        },
      });
    }

    const tableEl = el('table');
    if (tableEl) tableView = createTableView({ container: tableEl, t });

    const curationEl = el('curation');
    if (curationEl) {
      curationPanel = createCurationPanel({
        container: curationEl,
        t,
        seedKey: seedKey(),
        getDataset: () => rawDataset,
        onChange: (next, meta) => {
          curation = next;
          if (meta.needsRebuild) build();
          else reapplyCuration();
        },
      });
    }

    const exportEl = el('export');
    if (exportEl) {
      createExportPanel({
        container: exportEl,
        t,
        getSvg: () => renderer.svgNode,
        getTitle: () => ariaLabel(),
        getFilenameBase: () =>
          `coauthor-map-${state.orcid || state.rm || 'map'}-${view?.range.from ?? ''}-${
            view?.range.to ?? ''
          }`,
      });
    }

    const embedEl = el('embed');
    if (embedEl) {
      embedPanel = createEmbedPanel({
        container: embedEl,
        t,
        getState: () => ({ state, bounds: bounds() }),
      });
    }
  }

  // 正射図法をドラッグで回したら中心経度を state に戻す
  renderer.onRotate(({ centerLon, rotateLat }) => {
    state.center = centerLon;
    state.rotateLat = rotateLat;
    controls?.syncFromState({ center: centerLon });
    embedPanel?.refresh();
    syncUrl(state, bounds());
  });

  // auto のあいだだけ OS のテーマ設定に追従する
  watchSystemTheme(() => {
    if (state.theme === THEME_AUTO) applyTheme(state.theme);
  });

  build();

  return {
    build,
    refreshView,
    get state() {
      return state;
    },
  };
}
