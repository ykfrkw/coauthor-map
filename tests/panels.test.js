/**
 * `?controls=on` の有無でウィジェットに出る要素が変わることの凍結。
 *
 * この repo は jsdom を入れていないので、実 DOM で「出た / 出ない」は見られない。
 * 代わりに **app.js が唯一参照する判断表**（src/ui/panels.js）を直接固定する。
 * app.js 側が `panels.X` 以外の条件でパネルを組み始めたら、下の
 * 「app.js は判断表だけを見る」の検査が落ちる。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  FULL_VIEW_FIELDS,
  WIDGET_VIEW_FIELDS,
  resolvePanels,
} from '../src/ui/panels.js';
import {
  DEFAULTS,
  readStateFromUrl,
  stateToQuery,
} from '../src/ui/controls.js';
import { STRINGS } from '../src/ui/i18n.js';
import * as EMBED_SNIPPET_EXPORTS from '../src/ui/embed-snippet.js';

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/app.js', import.meta.url)),
  'utf8',
);

const EMBED_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/ui/embed-snippet.js', import.meta.url)),
  'utf8',
);

const WIDGET_HTML = readFileSync(
  fileURLToPath(new URL('../widget.html', import.meta.url)),
  'utf8',
);

const STYLE_CSS = readFileSync(
  fileURLToPath(new URL('../src/css/style.css', import.meta.url)),
  'utf8',
);

describe('controls フラグの読み書き', () => {
  it('既定は OFF。`controls=on` のときだけ ON になる', () => {
    expect(DEFAULTS.controls).toBe(false);
    expect(readStateFromUrl('').controls).toBe(false);
    expect(readStateFromUrl('?controls=on').controls).toBe(true);
    // 曖昧な値は既定（OFF）に倒す。`on` 以外は ON にしない
    for (const raw of ['off', '', '1', 'true', 'ON'])
      expect(readStateFromUrl(`?controls=${raw}`).controls).toBe(false);
  });

  it('ON のときだけ URL に書き戻る（枠を読み直しても操作 UI が残る）', () => {
    expect(stateToQuery({ ...DEFAULTS, controls: true })).toContain(
      'controls=on',
    );
    expect(stateToQuery({ ...DEFAULTS, controls: false })).not.toContain(
      'controls',
    );
  });
});

describe('widget.html の既定（controls なし）', () => {
  const panels = resolvePanels('widget', {});

  it('操作 UI を出さない（既存の埋め込みの見え方を変えない）', () => {
    expect(panels.controls).toBe(false);
    expect(panels.viewFields).toEqual([]);
  });

  it('補正パネル・集計テーブル・埋め込みコード生成・ダウンロードも出さない', () => {
    expect(panels.curation).toBe(false);
    expect(panels.table).toBe(false);
    expect(panels.embed).toBe(false);
    expect(panels.download).toBe(false);
    expect(panels.authors).toBe(false);
    expect(panels.mapActions).toBe(false);
    expect(panels.stats).toBe(false);
  });
});

describe('widget.html の `?controls=on`', () => {
  const panels = resolvePanels('widget', readStateFromUrl('?controls=on'));

  it('操作 UI が出る', () => {
    expect(panels.controls).toBe(true);
  });

  it('出す表示コントロールは主要な 6 つだけ', () => {
    expect(panels.viewFields).toEqual([
      'years',
      'grain',
      'size',
      'proj',
      'center',
      'theme',
    ]);
    // 記事の中に置く枠なので、長い注記と補助的なコントロールは落とす
    expect(panels.viewFields).not.toContain('labels');
    expect(panels.viewFields).not.toContain('scope');
    expect(panels.viewFields).not.toContain('grainHint');
  });

  // ここが今回の肝。**枠の中だけで話が終わる**ようにするため、
  // 補正（誰を載せるか + 手直し）・集計テーブル・埋め込みコード生成の 3 つを出す。
  // 3 つとも折りたたみなので、閉じているあいだは地図を押し下げない
  it('補正パネル・集計テーブル・埋め込みコード生成の 3 つがすべて出る', () => {
    expect(panels.authors).toBe(true);
    expect(panels.curation).toBe(true);
    expect(panels.table).toBe(true);
    expect(panels.embed).toBe(true);
  });

  it('画像のダウンロードと統計の並びは出さない（器を持たない）', () => {
    expect(panels.download).toBe(false);
    expect(panels.stats).toBe(false);
    expect(panels.mapActions).toBe(false);
  });

  it('フルツールへ飛ばす導線はもう無い', () => {
    expect(panels.openFullTool).toBeUndefined();
  });
});

describe('index.html', () => {
  const panels = resolvePanels('full', {});

  it('いままでどおり全部出る', () => {
    expect(panels.controls).toBe(true);
    expect(panels.viewFields).toEqual(FULL_VIEW_FIELDS);
    expect(panels.curation).toBe(true);
    expect(panels.table).toBe(true);
    expect(panels.embed).toBe(true);
    expect(panels.download).toBe(true);
    expect(panels.authors).toBe(true);
    expect(panels.mapActions).toBe(true);
  });

  it('`controls=on` が付いていても見え方は変わらない（常に全部出る）', () => {
    expect(resolvePanels('full', { controls: true })).toEqual(panels);
  });
});

describe('絞り込んだコントロールの整合', () => {
  it('ウィジェット用の並びはフル版に無い id を含まない', () => {
    for (const id of WIDGET_VIEW_FIELDS) expect(FULL_VIEW_FIELDS).toContain(id);
  });
});

describe('app.js は判断表だけを見る', () => {
  // パネルの出し分けが panels.js の外に散ると、上のテストが実物と食い違う。
  // 各パネルの container 取得が `panels.X ?` を通っていることを見る
  it('各パネルの container 取得に判断表が挟まっている', () => {
    for (const [id, key] of [
      ['controls', 'controls'],
      ['map-actions', 'mapActions'],
      ['authors', 'authors'],
      ['table', 'table'],
      ['curation', 'curation'],
      ['export', 'download'],
      ['embed', 'embed'],
    ]) {
      expect(APP_SOURCE, id).toContain(`panels.${key} ? el('${id}')`);
    }
  });

  // widget.html の 4 つの器は hidden な details の中にある。中身を組む側が
  // 開けないと、パネルは組まれているのに画面に出ない
  it('折りたたみに入るパネルを組むときは器の hidden を外す', () => {
    expect(APP_SOURCE).toContain(
      "const reveal = (node) => node?.closest('[hidden]')?.removeAttribute('hidden')",
    );
    for (const name of ['authorsEl', 'tableEl', 'curationEl', 'embedEl'])
      expect(APP_SOURCE, name).toContain(`reveal(${name})`);
  });

  it('mode を直接見る分岐が残っていない', () => {
    expect(APP_SOURCE).not.toContain("mode === 'full'");
  });
});

// 「Open the full tool ...」を消しきったことの凍結。**リンクも、それを組む関数も、
// 文言も、器も残さない。** どれか 1 つでも生き残ると、埋め込みの中で完結する
// という今回の作り替えが崩れる（読者が枠の外へ出る道が復活する）
describe('フルツールへの導線が残っていない', () => {
  it('文言の表に i18n キーが無い', () => {
    expect(Object.keys(STRINGS)).not.toContain('widget.openFullTool');
    for (const value of Object.values(STRINGS))
      expect(value).not.toContain('Open the full tool');
  });

  it('生成ロジックが embed-snippet.js に無い', () => {
    expect(EMBED_SOURCE).not.toContain('createOpenFullToolLink');
    expect(EMBED_SOURCE).not.toContain('buildToolUrl');
    expect(EMBED_SNIPPET_EXPORTS.createOpenFullToolLink).toBeUndefined();
    expect(EMBED_SNIPPET_EXPORTS.buildToolUrl).toBeUndefined();
  });

  it('app.js が導線を組まない', () => {
    expect(APP_SOURCE).not.toContain('openFullTool');
  });

  it('widget.html に器（#more）が無い', () => {
    expect(WIDGET_HTML).not.toContain('id="more"');
  });
});

describe('widget.html の器', () => {
  /** 折りたたみ 3 つの id と、その中に入る器の id */
  const PANEL_DETAILS = [
    ['corrections-panel', ['authors', 'curation']],
    ['tables-panel', ['table']],
    ['embed-panel', ['embed']],
  ];

  it('操作パネルの枠は hidden で置いてある（空の箱を出さない）', () => {
    expect(WIDGET_HTML).toContain('id="controls" hidden');
  });

  it('補正・集計テーブル・埋め込みコード生成の器が 3 つとも置いてある', () => {
    for (const [detailsId, inner] of PANEL_DETAILS) {
      expect(WIDGET_HTML, detailsId).toContain(`id="${detailsId}"`);
      for (const id of inner) expect(WIDGET_HTML, id).toContain(`id="${id}"`);
    }
  });

  // 開いた状態で置くと、地図とコントロールが 1000px 以上押し下げられる。
  // `open` 属性を付けないことが「既定は閉じている」の実装そのもの
  it('3 つとも折りたたみで、既定は閉じている（地図を押し下げない）', () => {
    for (const [detailsId] of PANEL_DETAILS) {
      const details = WIDGET_HTML.match(
        new RegExp(`<details[^>]*id="${detailsId}"[^>]*>`, 's'),
      );
      expect(details, detailsId).not.toBeNull();
      expect(details[0], detailsId).not.toContain('open');
      expect(details[0].startsWith('<details'), detailsId).toBe(true);
    }
  });

  // `?controls=on` が無いときは 3 つとも空のまま。開ける側（app.js）が
  // 動かない以上、hidden のまま残る
  it('3 つとも hidden で置いてある（表示専用の埋め込みの高さを動かさない）', () => {
    for (const [detailsId] of PANEL_DETAILS) {
      const details = WIDGET_HTML.match(
        new RegExp(`<details[^>]*id="${detailsId}"[^>]*>`, 's'),
      );
      expect(details[0], detailsId).toContain('hidden');
      expect(details[0], detailsId).toContain('widget-panel-card');
    }
  });

  it('画像のダウンロードの器はそもそも無い', () => {
    expect(WIDGET_HTML).not.toContain('id="export"');
  });

  // `.card` の display: grid は [hidden] に勝つ。打ち消しを消すと、中身が空でも
  // 枠と余白だけが残り、**表示専用の埋め込みが高くなる**（操作パネル 1 枚で
  // 実測 460 → 486。折りたたみ 3 枚ならその 3 倍が積まれる）。
  it('空の操作パネルは display も落としてある（既存の埋め込みの高さを動かさない）', () => {
    expect(STYLE_CSS).toMatch(
      /\.widget-controls-card\[hidden\]\s*\{\s*display:\s*none;/,
    );
  });

  it('空の折りたたみ 3 つも display を落としてある', () => {
    expect(STYLE_CSS).toMatch(
      /\.widget-panel-card\[hidden\]\s*\{\s*display:\s*none;/,
    );
  });
});

// 埋め込みは本文幅 780px、iframe の中はさらに狭い。**溢れるものは
// 自分の中でスクロールさせる。** 器の外へ出た瞬間、枠ごと横スクロールする
describe('狭い枠での収まり', () => {
  it('集計テーブルは自分の器の中でスクロールする', () => {
    const rule = STYLE_CSS.match(/\.table-scroll\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/overflow:\s*auto;/);
    expect(rule[1]).toMatch(/min-width:\s*0;/);
  });

  // 共著者は 145 名になりうる。一覧そのものに上限が無いと、
  // 開いた折りたたみが embed-height.js の上限（5000px）を押し上げる
  it('チェックボックス一覧に最大高さとスクロールが付いている（320px 以下）', () => {
    const rule = STYLE_CSS.match(/\.check-list\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/overflow:\s*auto;/);
    const max = rule[1].match(/max-height:\s*(\d+)px;/);
    expect(max).not.toBeNull();
    expect(Number(max[1])).toBeLessThanOrEqual(320);
  });

  // grid item の既定は min-width: auto。入れ子の grid に 0 を入れておかないと、
  // 中身が器を押し広げてページごと横スクロールする
  it('入れ子の grid が中身に押し広げられない', () => {
    for (const selector of [
      '.section',
      '.controls',
      '.widget-panel-card > \\*',
    ]) {
      const rule = STYLE_CSS.match(
        new RegExp(`\\n${selector}\\s*\\{([^}]*)\\}`),
      );
      expect(rule, selector).not.toBeNull();
      expect(rule[1], selector).toMatch(/min-width:\s*0;/);
    }
  });
});
