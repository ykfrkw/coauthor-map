/**
 * 地図の下の集計テーブル。
 *
 * これが地図のテキスト代替も兼ねる。スクリーンリーダーでも、
 * 画像が出ない環境でも、ここを読めば地図と同じ内容が分かるようにする。
 *
 * 所属が取れなかった共著者は「所属不明 N名」として必ず明示する。黙って消さない。
 */
import { h, replaceChildren, copyText } from './dom.js';
import { countrySummary, institutionSummary, yearSummary } from './derive.js';
import { formatNumber } from './i18n.js';

/** 画面表示用の整形。年だけ桁区切りを付けない */
function display(column, value) {
  if (value == null) return '';
  if (typeof value !== 'number') return String(value);
  return column.key === 'year' ? String(value) : formatNumber(value);
}

const TABS = [
  { id: 'country', labelKey: 'table.byCountry' },
  { id: 'institution', labelKey: 'table.byInstitution' },
  { id: 'year', labelKey: 'table.byYear' },
];

/** 表の定義を作る。列の並びと合計行の出し方をここに集約する */
function buildTable(tabId, view, t) {
  if (tabId === 'country') {
    const rows = countrySummary(view.cities);
    return {
      columns: [
        { key: 'country', label: t('table.country'), num: false },
        { key: 'cities', label: t('table.cities'), num: true },
        { key: 'institutions', label: t('table.institutions'), num: true },
        { key: 'coauthors', label: t('table.coauthors'), num: true },
        { key: 'papers', label: t('table.papers'), num: true },
      ],
      rows,
      total: {
        country: t('table.total'),
        cities: view.summary.cities,
        institutions: view.summary.institutions,
        coauthors: view.summary.coauthors,
        papers: view.summary.papers,
      },
    };
  }

  if (tabId === 'institution') {
    const rows = institutionSummary(view.cities);
    return {
      columns: [
        { key: 'institution', label: t('table.institution'), num: false },
        { key: 'city', label: t('table.city'), num: false },
        { key: 'country', label: t('table.country'), num: false },
        { key: 'coauthors', label: t('table.coauthors'), num: true },
        { key: 'papers', label: t('table.papers'), num: true },
      ],
      rows,
      total: null,
    };
  }

  const rows = yearSummary(view);
  return {
    columns: [
      { key: 'year', label: t('table.year'), num: true },
      { key: 'newCoauthors', label: t('table.newCoauthors'), num: true },
      { key: 'countries', label: t('table.countries'), num: true },
      { key: 'cities', label: t('table.cities'), num: true },
      { key: 'papers', label: t('table.papers'), num: true },
    ],
    rows,
    total: {
      year: t('table.total'),
      newCoauthors: rows.reduce((s, r) => s + r.newCoauthors, 0),
      countries: view.summary.countries,
      cities: view.summary.cities,
      papers: view.summary.papers,
    },
  };
}

function toMarkdown({ columns, rows, total }) {
  const head = `| ${columns.map((c) => c.label).join(' | ')} |`;
  const sep = `| ${columns.map((c) => (c.num ? '---:' : '---')).join(' | ')} |`;
  const body = [...rows, ...(total ? [total] : [])].map(
    (r) => `| ${columns.map((c) => String(r[c.key] ?? '')).join(' | ')} |`,
  );
  return [head, sep, ...body].join('\n');
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv({ columns, rows, total }) {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const r of [...rows, ...(total ? [total] : [])]) {
    lines.push(columns.map((c) => csvCell(r[c.key])).join(','));
  }
  return lines.join('\n');
}

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {(k: string, p?: Object) => string} opts.t
 */
export function createTableView({ container, t }) {
  let activeTab = TABS[0].id;
  let view = null;
  let stats = {};
  let table = null;

  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const tabButtons = TABS.map((tab) =>
    h('button', {
      type: 'button',
      role: 'tab',
      id: `tab-${tab.id}`,
      'aria-controls': 'table-panel',
      'aria-selected': String(tab.id === activeTab),
      'aria-pressed': String(tab.id === activeTab),
      text: t(tab.labelKey),
      onclick: () => {
        activeTab = tab.id;
        for (const b of tabButtons) {
          const on = b.id === `tab-${tab.id}`;
          b.setAttribute('aria-selected', String(on));
          b.setAttribute('aria-pressed', String(on));
        }
        render();
      },
    }),
  );
  tabBar.append(...tabButtons);

  const panel = h('div', {
    class: 'table-scroll',
    id: 'table-panel',
    role: 'tabpanel',
    tabindex: '0',
  });
  const notes = h('div', { class: 'section' });
  const copyStatus = h('span', {
    class: 'hint',
    role: 'status',
    'aria-live': 'polite',
  });

  async function copy(kind) {
    if (!table) return;
    const text = kind === 'csv' ? toCsv(table) : toMarkdown(table);
    const ok = await copyText(text);
    copyStatus.textContent = ok ? t('table.copied') : t('table.copyFailed');
  }

  const buttons = h('div', { class: 'button-row' }, [
    h('button', {
      type: 'button',
      text: t('table.copyMarkdown'),
      onclick: () => copy('md'),
    }),
    h('button', {
      type: 'button',
      text: t('table.copyCsv'),
      onclick: () => copy('csv'),
    }),
    copyStatus,
  ]);

  container.append(tabBar, panel, buttons, notes);

  function render() {
    copyStatus.textContent = '';
    if (!view) return;
    table = buildTable(activeTab, view, t);

    const thead = h('thead', {}, [
      h(
        'tr',
        {},
        table.columns.map((c) =>
          h('th', { scope: 'col', class: c.num ? 'num' : null }, [c.label]),
        ),
      ),
    ]);
    const tbody = h(
      'tbody',
      {},
      table.rows.map((r) =>
        h(
          'tr',
          {},
          table.columns.map((c, i) =>
            h(
              i === 0 ? 'th' : 'td',
              { scope: i === 0 ? 'row' : null, class: c.num ? 'num' : null },
              [display(c, r[c.key])],
            ),
          ),
        ),
      ),
    );
    const children = [thead, tbody];
    if (table.total) {
      children.push(
        h('tfoot', {}, [
          h(
            'tr',
            {},
            table.columns.map((c, i) =>
              h(
                i === 0 ? 'th' : 'td',
                { scope: i === 0 ? 'row' : null, class: c.num ? 'num' : null },
                [display(c, table.total[c.key])],
              ),
            ),
          ),
        ]),
      );
    }

    replaceChildren(panel, h('table', {}, children));

    // 落としたものを明示する
    const noteEls = [];
    const missingCoauthors = stats.coauthorsWithoutInstitution ?? 0;
    const missingRows = stats.authorshipsWithoutInstitution ?? 0;
    if (missingCoauthors > 0 || missingRows > 0) {
      noteEls.push(
        h('p', {
          class: 'notice',
          text: t('table.unknownAffiliation', {
            coauthors: missingCoauthors,
            rows: missingRows,
          }),
        }),
      );
    }
    const unmatched = stats.unmatchedDois?.length ?? 0;
    if (unmatched > 0) {
      noteEls.push(
        h('p', {
          class: 'notice',
          text: t('table.unmatched', { n: unmatched }),
        }),
      );
    }
    // 期間内の論文のうち、ピンに寄与しなかったもの。差を黙って飲み込まない
    const missingPapers = view.works.length - view.summary.papers;
    if (missingPapers > 0) {
      noteEls.push(
        h('p', {
          class: 'notice',
          text: t('table.papersWithoutLocation', {
            n: missingPapers,
            total: view.works.length,
          }),
        }),
      );
    }
    replaceChildren(notes, ...noteEls);
  }

  return {
    /**
     * @param {Object} nextView  filterDataset の戻り
     * @param {Object} nextStats DatasetStats
     */
    update(nextView, nextStats) {
      view = nextView;
      stats = nextStats ?? {};
      render();
    },
  };
}
