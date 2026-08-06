/**
 * 手直し（除外・追加・統合）のパネル。**UI だけ**を持つ。
 *
 * 永続化・正規化・入出力はすべてデータ層の src/curation.js に任せる。
 * DOI の整形も src/doi.js を使う（同じ規則を二重に持たない）。
 *
 * 適用のタイミング:
 *  - 除外と統合は手元の Dataset に即適用する（derive.js の applyCuration）
 *  - addDois だけは論文を新しく取ってくる必要があるので、データ層の再実行を促す
 */
import { h, replaceChildren, downloadBlob } from './dom.js';
import {
  emptyCuration,
  loadLocalCuration,
  saveLocalCuration,
  exportCuration,
  importCuration,
  normalizeCuration,
} from '../curation.js';
import { normalizeDoi, isDoiLike } from '../doi.js';

/**
 * 一覧に出す名前。**OpenAlex は名前が null のレコードを返すことがある**
 * （実例: ORCID 0000-0002-4934-4352 の共著者と機関）。素の `.name` で
 * localeCompare を呼ぶとそこで例外になり、**手直しパネルどころか
 * 地図の構築ごと落ちる**（build() の try が拾って「地図を作れません」になる）。
 * 並べ替えと表示の両方をここ 1 か所に通す。authors.js と同じ倒し方。
 */
const displayName = (record) => String(record?.name ?? '—');

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {(k: string, p?: Object) => string} opts.t
 * @param {string} opts.seedKey                 localStorage のキー（seed ごとに分ける）
 * @param {() => Object} opts.getDataset        手直し前の Dataset
 * @param {(curation: Object, meta: {needsRebuild: boolean}) => void} opts.onChange
 * @param {() => (true|'orcid'|false)} [opts.getMerge]  共著者レコード統合の現在値
 * @param {(value: boolean) => void} [opts.onMergeChange]  統合の ON/OFF が変わった
 */
export function createCurationPanel({
  container,
  t,
  seedKey,
  getDataset,
  onChange,
  getMerge,
  onMergeChange,
}) {
  let curation = loadLocalCuration(seedKey);

  const status = h('span', {
    class: 'hint',
    role: 'status',
    'aria-live': 'polite',
  });

  /** チェックボックスの一覧を作る（絞り込み付き） */
  function checkList({ items, selectedKey, idOf, labelOf }) {
    const filterInput = h('input', {
      type: 'search',
      placeholder: t('cur.filter'),
      'aria-label': t('cur.filter'),
    });
    const list = h('div', { class: 'check-list' });
    const count = h('span', { class: 'hint' });

    function paint() {
      const needle = filterInput.value.trim().toLowerCase();
      const selected = new Set(curation[selectedKey]);
      const rows = items
        .filter(
          (item) => !needle || labelOf(item).toLowerCase().includes(needle),
        )
        .slice(0, 400)
        .map((item) => {
          const id = idOf(item);
          const box = h('input', {
            type: 'checkbox',
            checked: selected.has(id),
          });
          box.addEventListener('change', () => {
            const set = new Set(curation[selectedKey]);
            if (box.checked) set.add(id);
            else set.delete(id);
            curation = { ...curation, [selectedKey]: [...set] };
            commit(false);
            count.textContent = t('cur.count', { n: set.size });
          });
          return h('label', {}, [box, h('span', { text: labelOf(item) })]);
        });
      replaceChildren(list, ...rows);
      count.textContent = t('cur.count', { n: selected.size });
    }

    filterInput.addEventListener('input', paint);
    paint();
    return {
      node: h('div', { class: 'field' }, [filterInput, list, count]),
      paint,
    };
  }

  function commit(needsRebuild) {
    saveLocalCuration(seedKey, curation);
    onChange(curation, { needsRebuild });
  }

  const body = h('div', { class: 'section' });

  /** データが差し替わるたびに一覧を組み直す */
  function rebuildLists() {
    const dataset = getDataset();
    if (!dataset) return;

    const works = [...dataset.works].sort(
      (a, b) => (b.year ?? 0) - (a.year ?? 0),
    );
    const coauthors = [...dataset.coauthors.values()].sort(
      (a, b) =>
        b.paperCount - a.paperCount ||
        displayName(a).localeCompare(displayName(b)),
    );
    const institutions = [...dataset.institutions.values()].sort((a, b) =>
      displayName(a).localeCompare(displayName(b)),
    );

    const papersList = checkList({
      items: works,
      selectedKey: 'excludeDois',
      idOf: (w) => w.doi,
      labelOf: (w) => `${w.year ?? '—'} · ${w.title ?? w.doi}`,
    });
    const authorsList = checkList({
      items: coauthors,
      selectedKey: 'excludeAuthorIds',
      idOf: (c) => c.id,
      labelOf: (c) => `${displayName(c)} (${c.paperCount})`,
    });
    const instList = checkList({
      items: institutions,
      selectedKey: 'excludeInstitutionIds',
      idOf: (i) => i.id,
      labelOf: (i) => `${displayName(i)}${i.city ? ` — ${i.city}` : ''}`,
    });

    // --- DOI の追加 ---
    const doiInput = h('input', {
      type: 'text',
      id: 'add-doi',
      placeholder: t('cur.addDoiPlaceholder'),
      spellcheck: 'false',
    });
    const addedChips = h('ul', { class: 'chip-list' });

    function paintAdded() {
      replaceChildren(
        addedChips,
        ...curation.addDois.map((doi) =>
          h('li', {}, [
            doi,
            h('button', {
              type: 'button',
              'aria-label': `remove ${doi}`,
              text: '×',
              onclick: () => {
                curation = {
                  ...curation,
                  addDois: curation.addDois.filter((d) => d !== doi),
                };
                paintAdded();
                commit(true);
              },
            }),
          ]),
        ),
      );
    }
    paintAdded();

    function addDoi() {
      const doi = normalizeDoi(doiInput.value);
      if (!doi || !isDoiLike(doi)) {
        status.textContent = t('cur.invalidDoi');
        return;
      }
      status.textContent = '';
      if (!curation.addDois.includes(doi)) {
        curation = { ...curation, addDois: [...curation.addDois, doi] };
        paintAdded();
        commit(true);
      }
      doiInput.value = '';
    }

    // --- 機関の統合 ---
    const options = institutions.map((i) =>
      h('option', { value: i.id }, [
        `${displayName(i)}${i.city ? ` — ${i.city}` : ''}`,
      ]),
    );
    const mergeFrom = h(
      'select',
      { 'aria-label': t('cur.mergeFrom') },
      options.map((o) => o.cloneNode(true)),
    );
    const mergeInto = h(
      'select',
      { 'aria-label': t('cur.mergeInto') },
      options.map((o) => o.cloneNode(true)),
    );
    const mergeChips = h('ul', { class: 'chip-list' });

    const nameOf = (id) => dataset.institutions.get(id)?.name ?? String(id);

    function paintMerges() {
      replaceChildren(
        mergeChips,
        ...Object.entries(curation.mergeInstitutions).map(([from, to]) =>
          h('li', {}, [
            `${nameOf(from)} → ${nameOf(to)}`,
            h('button', {
              type: 'button',
              'aria-label': `remove merge ${from}`,
              text: '×',
              onclick: () => {
                const next = { ...curation.mergeInstitutions };
                delete next[from];
                curation = { ...curation, mergeInstitutions: next };
                paintMerges();
                commit(false);
              },
            }),
          ]),
        ),
      );
    }
    paintMerges();

    // --- 共著者レコードの統合 ---
    // 誤統合を目視で確かめられるように、何を吸収したかを必ず一覧で見せる。
    const mergeBox = h('input', {
      type: 'checkbox',
      id: 'merge-coauthors',
      checked: (getMerge?.() ?? true) !== false,
    });
    mergeBox.addEventListener('change', () =>
      onMergeChange?.(mergeBox.checked),
    );

    const mergedRows = coauthors.filter((c) => (c.mergedIds?.length ?? 0) > 0);
    const mergedList = mergedRows.length
      ? h(
          'ul',
          { class: 'chip-list' },
          mergedRows.map((c) =>
            h('li', {
              text: t('cur.mergedRow', {
                name: c.name ?? c.id,
                n: c.mergedIds.length,
                by:
                  c.mergedBy === 'orcid'
                    ? t('cur.mergedByOrcid')
                    : t('cur.mergedByName'),
              }),
            }),
          ),
        )
      : h('p', { class: 'hint', text: t('cur.mergedNone') });

    // --- 入出力 ---
    const fileInput = h('input', {
      type: 'file',
      accept: 'application/json,.json',
      style: { display: 'none' },
    });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        curation = importCuration(await file.text());
        status.textContent = '';
        rebuildLists();
        commit(true);
      } catch {
        status.textContent = t('cur.importFailed');
      }
      fileInput.value = '';
    });

    replaceChildren(
      body,
      h('p', { class: 'hint', text: t('cur.intro') }),
      h('div', { class: 'controls' }, [
        h('div', { class: 'field' }, [
          h('span', { class: 'field-label', text: t('cur.excludePapers') }),
          papersList.node,
        ]),
        h('div', { class: 'field' }, [
          h('span', { class: 'field-label', text: t('cur.excludeCoauthors') }),
          authorsList.node,
        ]),
        h('div', { class: 'field' }, [
          h('span', {
            class: 'field-label',
            text: t('cur.excludeInstitutions'),
          }),
          instList.node,
        ]),
        h('div', { class: 'field' }, [
          h('label', { for: 'add-doi', text: t('cur.addDoi') }),
          doiInput,
          h('button', { type: 'button', text: t('cur.add'), onclick: addDoi }),
          h('span', { class: 'field-label', text: t('cur.added') }),
          addedChips,
        ]),
        h('div', { class: 'field' }, [
          h('span', { class: 'field-label', text: t('cur.merge') }),
          h('span', { class: 'hint', text: t('cur.mergeFrom') }),
          mergeFrom,
          h('span', { class: 'hint', text: t('cur.mergeInto') }),
          mergeInto,
          h('button', {
            type: 'button',
            text: t('cur.mergeAdd'),
            onclick: () => {
              if (
                !mergeFrom.value ||
                !mergeInto.value ||
                mergeFrom.value === mergeInto.value
              )
                return;
              curation = {
                ...curation,
                mergeInstitutions: {
                  ...curation.mergeInstitutions,
                  [mergeFrom.value]: mergeInto.value,
                },
              };
              paintMerges();
              commit(false);
            },
          }),
          h('span', { class: 'field-label', text: t('cur.merges') }),
          mergeChips,
        ]),
        h('div', { class: 'field' }, [
          h('span', { class: 'field-label', text: t('cur.mergeCoauthors') }),
          h('label', { for: 'merge-coauthors' }, [
            mergeBox,
            h('span', { text: t('cur.mergeCoauthorsLabel') }),
          ]),
          h('span', { class: 'hint', text: t('cur.mergeCoauthorsHint') }),
          h('span', { class: 'field-label', text: t('cur.mergedList') }),
          mergedList,
        ]),
        h('div', { class: 'field' }, [
          h('span', { class: 'field-label', text: 'JSON' }),
          h('div', { class: 'button-row' }, [
            h('button', {
              type: 'button',
              text: t('cur.export'),
              onclick: () =>
                downloadBlob(
                  new Blob([exportCuration(curation)], {
                    type: 'application/json',
                  }),
                  `coauthor-map-curation-${seedKey || 'seed'}.json`,
                ),
            }),
            h('button', {
              type: 'button',
              text: t('cur.import'),
              onclick: () => fileInput.click(),
            }),
            h('button', {
              type: 'button',
              text: t('cur.clear'),
              onclick: () => {
                curation = emptyCuration();
                rebuildLists();
                commit(true);
              },
            }),
          ]),
          fileInput,
          status,
        ]),
      ]),
    );
  }

  container.append(body);

  return {
    rebuildLists,
    get curation() {
      return curation;
    },
    /**
     * 外から手直しを差し込む（URL で運ばれてきた除外を重ねたときなど）。
     * localStorage にも書いて、次に開いたときに食い違わないようにする。
     * @param {Object} next
     */
    setCuration(next) {
      curation = normalizeCuration(next);
      saveLocalCuration(seedKey, curation);
      rebuildLists();
      return curation;
    },
    /** seed が変わったら別の保存領域に切り替える */
    setSeedKey(nextKey) {
      seedKey = nextKey;
      curation = loadLocalCuration(seedKey);
      rebuildLists();
      return curation;
    },
  };
}
