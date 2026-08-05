/**
 * 「誰を地図に載せるか」のパネル。**UI だけ**を持つ。
 *
 * 2 つの絞り込みを扱う:
 *  1. Main collaborations … 共著論文数の下限。1 = 全員
 *  2. 共著者の個別選択     … 既定は全員チェック済み。外した人が地図から消える
 *
 * 外した人は `Curation.excludeAuthorIds` に入れる（既存の手直しと同じ入れ物）。
 * 統合済みレコードは代表 1 件を外せば吸収された片割れごと消える（集計側の仕様）。
 */
import { h, replaceChildren } from './dom.js';

/** 最初に見せる人数。145 人を全部並べると縦に伸びすぎる。 */
export const VISIBLE_LIMIT = 25;

/** 下限の目安として添える閾値。 */
const HINT_THRESHOLDS = [2, 3, 5];

/**
 * 共著者の除外キー。OpenAlex の著者 ID が無い行は ORCID、それも無ければ氏名。
 * **集計側（aggregate.js）のキーの作り方と一致させること。**
 * @param {{id: string|null, orcid: string|null, name: string|null}} coauthor
 * @returns {string|null}
 */
export function coauthorKey(coauthor) {
  return (
    coauthor?.id ??
    coauthor?.orcid ??
    (coauthor?.name ? `name:${coauthor.name}` : null)
  );
}

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {(k: string, p?: Object) => string} opts.t
 * @param {(patch: {min?: number, excludeAuthorIds?: string[]}) => void} opts.onChange
 */
export function createAuthorPanel({ container, t, onChange }) {
  /** @type {Array<Object>} paperCount 降順 */
  let coauthors = [];
  /** @type {Set<string>} 外した人 */
  let excluded = new Set();
  let minPapers = 1;
  let showAll = false;
  let needle = '';

  const minInput = h('input', {
    type: 'range',
    id: 'min-papers',
    min: '1',
    max: '10',
    step: '1',
    value: '1',
    'aria-describedby': 'min-papers-out',
  });
  const minOut = h('output', {
    id: 'min-papers-out',
    for: 'min-papers',
    class: 'hint',
  });
  const minHint = h('p', { class: 'hint' });

  minInput.addEventListener('input', () => {
    minPapers = Math.max(1, Number(minInput.value) || 1);
    paintMin();
    paintList();
    onChange({ min: minPapers });
  });

  const search = h('input', {
    type: 'search',
    id: 'author-search',
    placeholder: t('auth.search'),
    'aria-label': t('auth.search'),
    autocomplete: 'off',
  });
  search.addEventListener('input', () => {
    needle = search.value.trim().toLowerCase();
    paintList();
  });

  const list = h('div', { class: 'check-list' });
  const listNote = h('span', { class: 'hint' });

  const toggleButton = h('button', {
    type: 'button',
    text: t('auth.showAll', { n: 0 }),
    onclick: () => {
      showAll = !showAll;
      paintList();
    },
  });
  const resetButton = h('button', {
    type: 'button',
    text: t('auth.includeAll'),
    onclick: () => {
      if (excluded.size === 0) return;
      excluded = new Set();
      paintList();
      onChange({ excludeAuthorIds: [] });
    },
  });

  /** 下限で残る人数 */
  function countAtLeast(n) {
    return coauthors.filter((c) => (c.paperCount ?? 0) >= n).length;
  }

  /**
   * 地図に出た実数。描画のあとに app 側から渡される（所属不明の人は地図に載らないので、
   * ここで数えた「残る人数」と 1〜2 人ずれる。画面に 2 つの数字を出さないため、
   * 届いていればそちらを正とする）。
   * @type {{shown: number, total: number}|null}
   */
  let reported = null;

  /** いま地図に出る人数（下限とチェックの両方を当てたあと） */
  function shownCount() {
    return coauthors.filter(
      (c) => (c.paperCount ?? 0) >= minPapers && !excluded.has(coauthorKey(c)),
    ).length;
  }

  function paintMin() {
    minOut.textContent = t(
      minPapers > 1 ? 'auth.minLabel' : 'auth.minLabelAll',
      {
        n: minPapers,
        shown: reported?.shown ?? shownCount(),
        total: reported?.total ?? coauthors.length,
      },
    );
    // 実測値を目安として添える。閾値を動かす前に効き目が読める
    const parts = HINT_THRESHOLDS.filter((n) => n <= Number(minInput.max)).map(
      (n) => t('auth.minStep', { n, count: countAtLeast(n) }),
    );
    minHint.textContent = parts.join(' · ');
  }

  function paintList() {
    const matching = coauthors.filter(
      (c) =>
        (c.paperCount ?? 0) >= minPapers &&
        (!needle ||
          String(c.name ?? '')
            .toLowerCase()
            .includes(needle)),
    );
    const visible = showAll ? matching : matching.slice(0, VISIBLE_LIMIT);

    replaceChildren(
      list,
      ...visible.map((coauthor) => {
        const key = coauthorKey(coauthor);
        const box = h('input', {
          type: 'checkbox',
          checked: !excluded.has(key),
          disabled: key === null,
        });
        box.addEventListener('change', () => {
          if (key === null) return;
          const next = new Set(excluded);
          if (box.checked) next.delete(key);
          else next.add(key);
          excluded = next;
          paintMin();
          listNote.textContent = noteText(matching.length);
          onChange({ excludeAuthorIds: [...excluded] });
        });
        return h('label', {}, [
          box,
          h('span', {
            text: `${coauthor.name ?? '—'} (${coauthor.paperCount ?? 0})`,
          }),
        ]);
      }),
    );

    toggleButton.textContent = showAll
      ? t('auth.showFewer')
      : t('auth.showAll', { n: matching.length });
    toggleButton.hidden = matching.length <= VISIBLE_LIMIT;
    listNote.textContent = noteText(matching.length);
    paintMin();
  }

  function noteText(matching) {
    return t('auth.listNote', {
      visible: showAll ? matching : Math.min(VISIBLE_LIMIT, matching),
      matching,
      excluded: excluded.size,
    });
  }

  container.append(
    h('p', { class: 'hint', text: t('auth.intro') }),
    h('div', { class: 'controls' }, [
      h('div', { class: 'field' }, [
        h('label', { for: 'min-papers', text: t('auth.min') }),
        minInput,
        minOut,
        minHint,
      ]),
      h('div', { class: 'field' }, [
        h('label', { for: 'author-search', text: t('auth.select') }),
        search,
        list,
        listNote,
        h('div', { class: 'button-row' }, [toggleButton, resetButton]),
      ]),
    ]),
  );

  return {
    /**
     * データと現在の絞り込みを流し込む。
     * @param {Object} input
     * @param {Array<Object>} input.coauthors  paperCount 降順に並べ替えて渡さなくてよい
     * @param {number} [input.min]
     * @param {string[]} [input.excludeAuthorIds]
     */
    update({ coauthors: next, min, excludeAuthorIds }) {
      coauthors = [...(next ?? [])].sort(
        (a, b) =>
          (b.paperCount ?? 0) - (a.paperCount ?? 0) ||
          String(a.name ?? '').localeCompare(String(b.name ?? '')),
      );
      if (min != null) minPapers = Math.max(1, Number(min) || 1);
      if (excludeAuthorIds) excluded = new Set(excludeAuthorIds);
      // 下限の上限は実データの最大共著本数に合わせる（動かない範囲を出さない）
      const max = Math.max(2, ...coauthors.map((c) => c.paperCount ?? 0));
      minInput.max = String(max);
      minInput.value = String(Math.min(minPapers, max));
      showAll = false;
      paintList();
    },
    /**
     * 描画のあとに「実際に地図へ出た人数」を教える。表示の数字を 1 つに揃えるため。
     * @param {number} shown
     * @param {number} total
     */
    setShown(shown, total) {
      reported = { shown, total };
      paintMin();
    },
    get minPapers() {
      return minPapers;
    },
    get excludedIds() {
      return [...excluded];
    },
  };
}
