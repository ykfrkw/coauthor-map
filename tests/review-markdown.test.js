/**
 * Markdown 書き出し。開発側がそのまま読める形になっているかを見る。
 */
import { describe, expect, it } from 'vitest';

import { headline, toMarkdown } from '../src/review/markdown.js';

const base = {
  page: 'index',
  url: 'https://ykfrkw.github.io/coauthor-map/?orcid=0000-0003-1317-0220&theme=dark&review=1',
  viewport: { width: 1440, height: 900 },
  display: {
    orcid: '0000-0003-1317-0220',
    rm: 'yk_frkw',
    from: 2011,
    to: 2026,
    proj: 'equalEarth',
    scope: 'auto',
    grain: 10,
    size: 'papers',
    center: 140,
    theme: 'dark',
    themeApplied: 'dark',
    merge: true,
  },
  exportedAt: '2026-08-05T09:00:00.000Z',
};

const comment = {
  id: 'a',
  tag: 'design',
  body: 'The legend is too small.\nBump it to 13px.',
  selector: '#legend',
  elementText: 'Pin area is proportional to papers',
  rx: 0.12,
  ry: 0.78,
  pageX: 120,
  pageY: 1180,
};

describe('headline', () => {
  it('本文の 1 行目を見出しにする。空なら (no text)', () => {
    expect(headline('  \nfirst line\nsecond')).toBe('first line');
    expect(headline('')).toBe('(no text)');
    expect(headline(null)).toBe('(no text)');
    expect(headline('x'.repeat(100))).toHaveLength(73);
  });
});

describe('toMarkdown', () => {
  it('見出しに画面幅・URL・表示状態を載せる', () => {
    const md = toMarkdown({ ...base, comments: [comment] });
    expect(md).toContain('# Co-author map review — index');
    expect(md).toContain(`- URL: ${base.url}`);
    expect(md).toContain('- Viewport: 1440 x 900 px');
    expect(md).toContain('- Years: 2011–2026');
    expect(md).toContain('- Projection: equalEarth');
    expect(md).toContain('- Extent: auto');
    expect(md).toContain('- Grouping: 10');
    expect(md).toContain('- Pin size: papers');
    expect(md).toContain('- Theme setting: dark');
    expect(md).toContain('- Theme in use: dark');
    expect(md).toContain('- Merge co-author records: on');
    expect(md).toContain('- Exported: 2026-08-05T09:00:00.000Z');
    expect(md).toContain('- Comments: 1 (design 1)');
  });

  it('各コメントに連番・種別・本文・セレクタ・要素テキスト・相対位置が出る', () => {
    const md = toMarkdown({ ...base, comments: [comment] });
    expect(md).toContain('## 1. [design] The legend is too small.');
    expect(md).toContain('The legend is too small.\nBump it to 13px.');
    expect(md).toContain('- Element: `#legend`');
    expect(md).toContain(
      '- Element text: "Pin area is proportional to papers"',
    );
    expect(md).toContain('- Position in element: 12% across, 78% down');
  });

  it('連番は配列の順で 1 から振り直す', () => {
    const md = toMarkdown({
      ...base,
      comments: [
        { ...comment, id: 'a', body: 'one' },
        { ...comment, id: 'b', body: 'two', tag: 'bug' },
      ],
    });
    expect(md).toContain('## 1. [design] one');
    expect(md).toContain('## 2. [bug] two');
    expect(md).toContain('- Comments: 2 (bug 1, design 1)');
  });

  it('要素が見つからなかったコメントはその旨とページ座標を書く', () => {
    const md = toMarkdown({
      ...base,
      comments: [{ ...comment, anchored: false }],
    });
    expect(md).toContain('- Element: not found on this page (was `#legend`)');
    expect(md).toContain('- Page coordinates: 120, 1180');
    expect(md).not.toContain('- Position in element:');
  });

  it('コメントが 0 件でも壊れない', () => {
    const md = toMarkdown({ ...base, comments: [] });
    expect(md).toContain('- Comments: 0');
    expect(md).toContain('_No comments yet._');
  });

  it('引数なしでも例外を投げない', () => {
    expect(() => toMarkdown()).not.toThrow();
  });

  it('日本語が混ざらない', () => {
    const japanese = /[぀-ヿ㐀-鿿＀-￯　-〿]/;
    expect(toMarkdown({ ...base, comments: [comment] })).not.toMatch(japanese);
  });
});
