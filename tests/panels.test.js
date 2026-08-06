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

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/app.js', import.meta.url)),
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
    expect(panels.openFullTool).toBe(false);
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

  it('操作 UI とフルツールへの導線が出る', () => {
    expect(panels.controls).toBe(true);
    expect(panels.openFullTool).toBe(true);
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

  // スニペット作りだけのためにフルツールへ飛ばさない。
  // 折りたたみで置くので、閉じているあいだは地図を押し下げない
  it('埋め込みコード生成が出る', () => {
    expect(panels.embed).toBe(true);
  });

  it('補正パネル・集計テーブル・ダウンロードは `controls=on` でも出ない', () => {
    expect(panels.curation).toBe(false);
    expect(panels.table).toBe(false);
    expect(panels.download).toBe(false);
    expect(panels.authors).toBe(false);
    expect(panels.stats).toBe(false);
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

  it('フルツール自身にはフルツールへの導線を出さない', () => {
    expect(panels.openFullTool).toBe(false);
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
      ['more', 'openFullTool'],
    ]) {
      expect(APP_SOURCE, id).toContain(`panels.${key} ? el('${id}')`);
    }
  });

  // widget.html の #embed は hidden な details の中にある。中身を組む側が
  // 開けないと、パネルは組まれているのに画面に出ない
  it('埋め込みパネルを組むときは器の hidden を外す', () => {
    expect(APP_SOURCE).toContain(
      "embedEl.closest('[hidden]')?.removeAttribute('hidden')",
    );
  });

  it('mode を直接見る分岐が残っていない', () => {
    expect(APP_SOURCE).not.toContain("mode === 'full'");
  });
});

describe('widget.html の器', () => {
  it('操作パネルと導線の枠は hidden で置いてある（空の箱を出さない）', () => {
    expect(WIDGET_HTML).toContain('id="controls" hidden');
    expect(WIDGET_HTML).toContain('id="more" hidden');
  });

  it('埋め込みコード生成の器も hidden の折りたたみで置いてある', () => {
    expect(WIDGET_HTML).toContain('id="embed-panel" hidden');
    expect(WIDGET_HTML).toContain('id="embed"');
  });

  // 開いた状態で置くと、地図とコントロールが 300px 以上押し下げられる。
  // `open` 属性を付けないことが「既定は閉じている」の実装そのもの
  it('折りたたみは既定で閉じている（地図を押し下げない）', () => {
    const details = WIDGET_HTML.match(/<details[^>]*id="embed-panel"[^>]*>/);
    expect(details).not.toBeNull();
    expect(details[0]).not.toContain('open');
    expect(details[0].startsWith('<details')).toBe(true);
  });

  it('補正・集計テーブル・ダウンロードの器はそもそも無い', () => {
    for (const id of ['curation', 'table', 'export', 'authors'])
      expect(WIDGET_HTML).not.toContain(`id="${id}"`);
  });

  // `.card` の display: grid は [hidden] に勝つ。打ち消しを消すと、中身が空でも
  // 枠と余白だけが残り、**表示専用の埋め込みが 26px 高くなる**（実測 460 → 486）。
  it('空の操作パネルは display も落としてある（既存の埋め込みの高さを動かさない）', () => {
    expect(STYLE_CSS).toMatch(
      /\.widget-controls-card\[hidden\]\s*\{\s*display:\s*none;/,
    );
  });

  it('空の埋め込みパネルも display を落としてある', () => {
    expect(STYLE_CSS).toMatch(
      /\.widget-embed-card\[hidden\]\s*\{\s*display:\s*none;/,
    );
  });
});
