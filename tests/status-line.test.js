import { describe, expect, it } from 'vitest';

import { shownStatusText } from '../src/ui/status-line.js';
import { createTranslator, STRINGS } from '../src/ui/i18n.js';

const t = createTranslator();

/**
 * ウィジェット側の呼び方（凡例が無いので丸の基準を文中に出す）。
 * `sizeMode` は既定に頼らず明示する。既定が変わっても文言の固定が崩れないようにする。
 */
const widget = (extra) =>
  shownStatusText(
    {
      shown: 26,
      total: 138,
      includeSizeBasis: true,
      sizeMode: 'papers',
      ...extra,
    },
    t,
  );

describe('状態表示の文言（状態ごとの固定）', () => {
  it('絞り込みなし: 丸の基準と 表示中 / 総数', () => {
    expect(widget()).toBe(
      'Pin area is proportional to papers, not to head count. Showing 26 of 138 co-authors.',
    );
  });

  it('min で絞った: 何本以上かと 該当数 / 総数', () => {
    expect(widget({ minPapers: 3 })).toBe(
      'Pin area is proportional to papers, not to head count. Showing co-authors with 3 or more joint papers: 26 of 138.',
    );
  });

  it('手で除外した人がいる: 隠した人数を添える', () => {
    expect(widget({ hiddenCount: 4 })).toBe(
      'Pin area is proportional to papers, not to head count. Showing 26 of 138 co-authors. 4 co-authors are hidden by hand.',
    );
  });

  it('手で除外した人が 1 人のときは単数形', () => {
    expect(widget({ hiddenCount: 1 })).toContain(
      '1 co-author is hidden by hand.',
    );
    expect(widget({ hiddenCount: 1 })).not.toContain('co-authors are hidden');
  });

  it('min と手動除外の両方', () => {
    expect(widget({ minPapers: 2, hiddenCount: 3 })).toBe(
      'Pin area is proportional to papers, not to head count. Showing co-authors with 2 or more joint papers: 26 of 138. 3 co-authors are hidden by hand.',
    );
  });

  it('年で絞った: 対象年の範囲を添える', () => {
    expect(widget({ years: { from: 2015, to: 2024 } })).toBe(
      'Pin area is proportional to papers, not to head count. Showing 26 of 138 co-authors. Years 2015–2024.',
    );
  });

  it('全部そろった状態', () => {
    expect(
      widget({ minPapers: 3, hiddenCount: 2, years: { from: 2019, to: 2026 } }),
    ).toBe(
      'Pin area is proportional to papers, not to head count. Showing co-authors with 3 or more joint papers: 26 of 138. 2 co-authors are hidden by hand. Years 2019–2026.',
    );
  });
});

describe('丸の基準', () => {
  it('size が co-authors のときは人数基準だと言う', () => {
    expect(widget({ sizeMode: 'coauthors' })).toBe(
      'Pin area is proportional to the number of co-authors. Showing 26 of 138 co-authors.',
    );
  });

  it('uniform のときは基準の記述を出さない', () => {
    expect(widget({ sizeMode: 'uniform' })).toBe(
      'Showing 26 of 138 co-authors.',
    );
    expect(widget({ sizeMode: 'uniform' })).not.toContain('Pin area');
  });

  it('凡例があるページ（index.html）では基準を二重に出さない', () => {
    expect(
      shownStatusText({ shown: 26, total: 138, includeSizeBasis: false }, t),
    ).toBe('Showing 26 of 138 co-authors.');
  });

  it('未知の size でも基準を捏造しない', () => {
    expect(widget({ sizeMode: 'nope' })).toBe('Showing 26 of 138 co-authors.');
  });
});

describe('数の扱い', () => {
  it('どの状態でも 表示中 / 全体 の関係が残る', () => {
    const cases = [
      {},
      { minPapers: 5 },
      { hiddenCount: 9 },
      { sizeMode: 'uniform' },
      { years: { from: 2000, to: 2001 } },
    ];
    for (const extra of cases) {
      expect(widget(extra)).toMatch(/26 of 138/);
    }
  });

  it('4 桁以上は桁区切りが入り、年には入らない', () => {
    const line = shownStatusText(
      { shown: 1200, total: 13800, years: { from: 1990, to: 2026 } },
      t,
    );
    expect(line).toContain('1,200 of 13,800');
    expect(line).toContain('Years 1990–2026.');
    expect(line).not.toContain('1,990');
  });

  it('min が 1 以下・壊れた値のときは絞っていない扱い', () => {
    for (const minPapers of [1, 0, -3, null, undefined, NaN, 'x']) {
      expect(widget({ minPapers })).toContain('Showing 26 of 138 co-authors.');
    }
  });

  it('隠した人数が 0・壊れた値のときは何も足さない', () => {
    for (const hiddenCount of [0, -1, null, undefined, NaN, 'x']) {
      expect(widget({ hiddenCount })).not.toContain('hidden by hand');
    }
  });

  it('年が片方欠けていたら年は出さない', () => {
    expect(widget({ years: { from: 2015, to: null } })).not.toContain('Years');
    expect(widget({ years: null })).not.toContain('Years');
  });

  it('引数なしでも壊れず、キー文字列を生で出さない', () => {
    expect(shownStatusText(undefined, t)).toBe('Showing 0 of 0 co-authors.');
  });
});

describe('文言の置き場所', () => {
  const KEYS = [
    'shown.basisPapers',
    'shown.basisCoauthors',
    'shown.all',
    'shown.min',
    'shown.hiddenOne',
    'shown.hidden',
    'shown.years',
  ];

  it('使うキーはすべて i18n.js に英語文言を持っている', () => {
    for (const key of KEYS) {
      expect(STRINGS[key]).toBeTypeOf('string');
      expect(STRINGS[key].trim().length).toBeGreaterThan(0);
      expect(STRINGS[key]).not.toBe(key);
    }
  });

  it('埋め込み幅 272px を考えて、文はどれも短く保つ', () => {
    for (const key of KEYS) expect(STRINGS[key].length).toBeLessThan(80);
  });
});
