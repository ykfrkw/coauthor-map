/**
 * 画面の組み立て。index.html / widget.html / dev.html はすべてここを通る。
 *
 * データ層との接点は `loadDataset` の 1 引数だけ。
 * 本番は src/main.js が pipeline.js の buildDataset を渡し、
 * 開発中は src/dev.js が fixture の snapshot を渡す。
 */
import { createMapRenderer, renderLegend, fitNoteText } from './map/render.js';
import { applyTheme, watchSystemTheme, THEME_AUTO } from './map/themes.js';
import { createTranslator, formatNumber, progressLabel } from './ui/i18n.js';
import { h, replaceChildren } from './ui/dom.js';
import {
  readStateFromUrl,
  syncUrl,
  createControls,
  createMapActions,
  curationFromState,
  applyCurationToState,
} from './ui/controls.js';
import { normalizeDataset, applyCuration, filterDataset } from './ui/derive.js';
import { normalizeAffiliationTypeMode } from './aggregate.js';
import { createTableView } from './ui/table.js';
import { createCurationPanel } from './ui/curation.js';
import { createAuthorPanel, coauthorKey } from './ui/authors.js';
import { shownStatusText } from './ui/status-line.js';
import { createBusyController } from './ui/busy.js';
import {
  loadLocalCuration,
  mergeCurations,
  loadCommittedCuration,
} from './curation.js';
import { createExportPanel } from './ui/export.js';
import { createEmbedPanel } from './ui/embed-snippet.js';
import { resolvePanels } from './ui/panels.js';

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
  // `afftype=off` は UI に出さない逃げ道（主所属の種別優先を切る）。
  // controls.js の状態同期には載せないので、ここで直接読む。
  // `readStateFromUrl` が `afftype` を返すようになったらそちらを優先する。
  if (state.afftype === undefined) {
    state.afftype = normalizeAffiliationTypeMode(
      new URLSearchParams(window.location.search).get('afftype'),
    );
  }
  // どのパネルを出すかの判断はここ 1 か所（src/ui/panels.js）に閉じる
  const panels = resolvePanels(mode, state);
  const t = createTranslator();
  applyTheme(state.theme);
  applyStaticI18n(document, t);

  const el = (id) => document.getElementById(id);

  /**
   * 折りたたみの器ごと hidden で置いてあるパネルを表に出す。
   *
   * widget.html の #authors / #curation / #table / #embed は `<details hidden>` の
   * 中にある。**中身を組むと決めた側だけが器を開ける**（`?controls=on` が無ければ
   * 空の折りたたみが 3 本並ぶだけになる）。index.html の器は hidden な祖先を
   * 持たないので、この関数はそこでは何もしない。
   */
  const reveal = (node) => node?.closest('[hidden]')?.removeAttribute('hidden');

  const mapEl = el('map');
  const legendEl = el('legend');
  const statusEl = el('status');
  const statsEl = el('stats');
  const shownEl = el('shown');

  // 凡例はページごとに既定が違う。widget では出さない
  // （埋め込み先では丸の目盛りより地図そのものに面積を割く）。
  // URL に `legend=on` / `legend=off` があればそれが勝つ
  const showLegend = state.legend ?? mode !== 'widget';
  if (legendEl) legendEl.hidden = !showLegend;

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
  let mapActions = null;
  let curationPanel = null;
  let authorPanel = null;
  let embedPanel = null;
  let tableView = null;

  // 読み込み中インジケータ。地図の骨格（同梱の topojson）は先に描いてあるので、
  // 待たせるのはピンだけ。200ms 未満で終わるときは出さない
  const spinner = h('div', { class: 'map-busy', 'aria-hidden': 'true' }, [
    h('span', { class: 'spinner' }),
  ]);
  const busy = createBusyController({
    show: () => mapEl?.append(spinner),
    hide: () => spinner.remove(),
  });

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
    const merged = rawDataset?.stats?.coauthorsMerged ?? 0;
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
      // 統合した件数は「共著者数が減った理由」なので、黙って飲み込まず出す。
      merged > 0
        ? h('div', { class: 'stat' }, [
            h('b', { text: formatNumber(merged) }),
            h('span', { text: t('stat.merged') }),
          ])
        : null,
    );
  }

  /**
   * 手で外した共著者の実数。URL や確定版から来た「いまのデータに居ない ID」は数えない。
   * 判定は著者パネルのチェックと同じ coauthorKey で行う。
   */
  function hiddenCoauthorCount() {
    const ids = new Set(curation?.excludeAuthorIds ?? []);
    if (!ids.size || !rawDataset) return 0;
    let n = 0;
    for (const c of rawDataset.coauthors.values())
      if (ids.has(coauthorKey(c))) n += 1;
    return n;
  }

  /**
   * 「145 名中 53 名を表示中」。全体と表示中の関係が分かる表示はここ 1 箇所に出す。
   *
   * 数だけでは何で絞った結果か分からないので、絞り込みの条件と丸の基準も同じ行に載せる。
   * 丸の基準は**凡例が出ていないページでだけ**添える（index.html は凡例が持っている）。
   * 年は統計パネルが持っているので、統計パネルが無くて実際に絞ったときだけ添える。
   */
  function paintShown() {
    if (!view) return;
    const total = view.summary.coauthorsTotal ?? view.summary.coauthors;
    // 絞り込みパネルにも同じ数字を渡す（画面に食い違う 2 つの数を出さない）
    authorPanel?.setShown(view.summary.coauthors, total);
    if (!shownEl) return;
    const b = bounds();
    const narrowed = view.range.from > b.from || view.range.to < b.to;
    replaceChildren(
      shownEl,
      h('p', {
        class: 'hint',
        text: shownStatusText(
          {
            shown: view.summary.coauthors,
            total,
            minPapers: view.minPapers,
            hiddenCount: hiddenCoauthorCount(),
            sizeMode: state.size,
            includeSizeBasis: !showLegend,
            years: !statsEl && narrowed ? view.range : null,
          },
          t,
        ),
      }),
    );
  }

  /** 凡例と自動フィットの注記を描き直す */
  function paintLegend(drawn) {
    if (!legendEl || !showLegend || !drawn) return;
    renderLegend(legendEl, {
      sizeMode: state.size,
      maxValue: drawn.maxValue,
      maxRadius: drawn.maxRadius,
      pinCount: drawn.pinCount,
      fitNote: fitNoteText(drawn.fit, t),
      t,
    });
  }

  /** 年フィルタから下だけを描き直す（データ取得はしない） */
  function refreshView() {
    if (!curatedDataset) return;
    const b = bounds();
    const range = {
      from: state.from ?? b.from,
      to: state.to ?? b.to,
    };
    view = filterDataset(curatedDataset, range, { minPapers: state.min });

    const drawn = renderer.update({
      cities: view.cities,
      grain: state.grain,
      projectionId: state.proj,
      centerLon: state.center,
      centerExplicit: state.centerExplicit === true,
      rotateLat: state.rotateLat ?? 0,
      sizeMode: state.size,
      scope: state.scope,
      showLabels: state.labels !== false,
      ariaLabel: ariaLabel(),
    });

    paintLegend(drawn);
    paintStats();
    paintShown();
    tableView?.update(view, rawDataset.stats);
    embedPanel?.refresh();
    if (!view.cities.length) setStatus('info', t('map.empty'));
    else setStatus(null, '');
    syncUrl(state, b);
  }

  /**
   * データが来る前に地図の骨格だけ描く。国境の topojson は同梱なので即座に出せる。
   * 真っ白な四角を見せず、ピンだけを待たせる。
   */
  function drawSkeleton() {
    renderer.update({
      cities: [],
      grain: state.grain,
      projectionId: state.proj,
      centerLon: state.center,
      centerExplicit: state.centerExplicit === true,
      rotateLat: state.rotateLat ?? 0,
      sizeMode: state.size,
      scope: state.scope,
      showLabels: state.labels !== false,
      ariaLabel: t('app.title'),
    });
  }

  /** 手直しを当て直してから refreshView */
  function reapplyCuration() {
    if (!rawDataset) return;
    // 手直しは URL にも載せる。載せないと埋め込みウィジェットに伝わらない
    applyCurationToState(state, curation);
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
    busy.start();

    try {
      // commit 済みの確定版 → このブラウザの下書き → URL で運ばれてきた手直し、の順に重ねる。
      // URL を最後に置くのは、共有されたリンクの見え方をそのまま再現するため
      const committed = state.orcid
        ? await loadCommittedCuration(state.orcid)
        : null;
      curation = mergeCurations(
        committed,
        loadLocalCuration(seedKey()),
        curationFromState(state),
      );
      const dataset = await loadDataset({
        seeds,
        curation,
        mergeCoauthors: state.merge,
        pinMode: state.pin,
        useOrcidAffiliations: state.orcidaff !== false,
        preferOccupationalTypes: state.afftype !== false,
        // データ層が渡すのは安定キー。表示文言に直すのはここだけの仕事
        onProgress: (key, done, total) => {
          const suffix =
            Number.isFinite(total) && total > 0 ? ` (${done}/${total})` : '';
          setStatus('info', `${progressLabel(key)}${suffix}`);
        },
      });
      rawDataset = normalizeDataset(dataset);

      const b = bounds();
      // URL の年が範囲外なら丸める
      state.from = Math.max(b.from, Math.min(b.to, state.from ?? b.from));
      state.to = Math.max(b.from, Math.min(b.to, state.to ?? b.to));
      if (state.from > state.to) [state.from, state.to] = [b.from, b.to];
      controls?.setYearBounds(b.from, b.to, { from: state.from, to: state.to });

      // 手直しパネルは localStorage の下書きを持つ。確定版と URL 側の除外を重ねてから使う
      const local = curationPanel?.setSeedKey(seedKey());
      if (local) {
        curation = mergeCurations(committed, local, curationFromState(state));
        curationPanel.setCuration(curation);
      }
      authorPanel?.update({
        coauthors: [...rawDataset.coauthors.values()],
        min: state.min,
        excludeAuthorIds: curation.excludeAuthorIds,
      });
      reapplyCuration();

      for (const warning of rawDataset.warnings ?? [])
        setStatus('info', warning);
    } catch (err) {
      setStatus(
        'error',
        `${t('load.failed')} ${err?.message ?? err}`,
        t('load.hintNetwork'),
      );
      // 失敗したときは同じ ID でも読み直せるようにする。
      // 「入力が反映済み = 無効」のままだと、通信が一度こけただけで
      // 押せるボタンがひとつも無くなってしまう
      controls?.setLoadedSeeds(null);
    } finally {
      // 成功でも失敗でも必ず消す。出っぱなしにしない
      busy.stop();
    }
  }

  // ---- 操作パネル ----
  // index.html は全部、widget.html は `?controls=on` のときだけ主要なものを出す
  {
    const controlsEl = panels.controls ? el('controls') : null;
    if (controlsEl) {
      controlsEl.hidden = false;
      controls = createControls({
        container: controlsEl,
        t,
        state,
        viewFields: panels.viewFields,
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
      });
    }

    // 「表示を初期に戻す」は地図の真下に置く。
    // データを取り直す上のボタンとは別物だと、置き場所で見せる
    const mapActionsEl = panels.mapActions ? el('map-actions') : null;
    if (mapActionsEl) {
      mapActions = createMapActions({
        container: mapActionsEl,
        t,
        onResetView: () => {
          // リセットは自動フィットに戻す操作。中心経度の明示も解除する
          state.centerExplicit = false;
          paintLegend(renderer.resetView());
        },
      });
      // 描き直しのたびに「動いているか」を見て、押せる / 押せないを切り替える
      renderer.onNodes(() => mapActions.setMoved(renderer.viewMoved));
      mapActions.setMoved(renderer.viewMoved);
    }

    const authorsEl = panels.authors ? el('authors') : null;
    if (authorsEl) {
      reveal(authorsEl);
      authorPanel = createAuthorPanel({
        container: authorsEl,
        t,
        onChange: (patch) => {
          if (patch.min != null) {
            state.min = patch.min;
            refreshView();
            return;
          }
          // 外した人は既存の手直し（excludeAuthorIds）に入れる。
          // 統合済みレコードは代表を外せば片割れごと消える（集計側の仕様）
          curation = {
            ...curation,
            excludeAuthorIds: patch.excludeAuthorIds ?? [],
          };
          curationPanel?.setCuration(curation);
          reapplyCuration();
        },
      });
    }

    const tableEl = panels.table ? el('table') : null;
    if (tableEl) {
      reveal(tableEl);
      tableView = createTableView({ container: tableEl, t });
    }

    const curationEl = panels.curation ? el('curation') : null;
    if (curationEl) {
      reveal(curationEl);
      curationPanel = createCurationPanel({
        container: curationEl,
        t,
        seedKey: seedKey(),
        getDataset: () => rawDataset,
        onChange: (next, meta) => {
          curation = next;
          if (meta.needsRebuild) {
            build();
            return;
          }
          // 手直しパネルで外した人は、著者一覧のチェックにも映す
          if (rawDataset) {
            authorPanel?.update({
              coauthors: [...rawDataset.coauthors.values()],
              min: state.min,
              excludeAuthorIds: curation.excludeAuthorIds,
            });
          }
          reapplyCuration();
        },
        getMerge: () => state.merge,
        // 統合は集計の段階で効くので、取り直しが要る（seed も論文も
        // sessionStorage に載っているので通信は起きない）
        onMergeChange: (value) => {
          state.merge = value;
          build();
        },
      });
    }

    const exportEl = panels.download ? el('export') : null;
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

    const embedEl = panels.embed ? el('embed') : null;
    if (embedEl) {
      reveal(embedEl);
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
    // 手で回した中心は自動フィットの重心より優先する
    state.centerExplicit = true;
    controls?.syncFromState({ center: centerLon });
    embedPanel?.refresh();
    syncUrl(state, bounds());
  });

  // auto のあいだだけ OS のテーマ設定に追従する
  watchSystemTheme(() => {
    if (state.theme === THEME_AUTO) applyTheme(state.theme);
  });

  // 骨格を先に描いてから取りに行く（真っ白な待ち時間を作らない）
  drawSkeleton();
  build();

  return {
    build,
    refreshView,
    get state() {
      return state;
    },
  };
}
