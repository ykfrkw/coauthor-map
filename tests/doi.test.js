import { describe, expect, it } from 'vitest';

import { isDoiLike, normalizeDoi, uniqueDois } from '../src/doi.js';

describe('normalizeDoi', () => {
  it('接頭辞・大文字・前後の空白を吸収して同じ値になる', () => {
    const expected = '10.1016/j.eclinm.2026.103988';
    const variants = [
      'https://doi.org/10.1016/j.eclinm.2026.103988',
      'http://doi.org/10.1016/J.ECLINM.2026.103988',
      'https://dx.doi.org/10.1016/j.eclinm.2026.103988',
      'DOI:10.1016/j.eclinm.2026.103988',
      '  10.1016/j.eclinm.2026.103988  ',
      '10.1016/j.eclinm.2026.103988',
    ];
    for (const variant of variants) {
      expect(normalizeDoi(variant)).toBe(expected);
    }
    expect(new Set(variants.map(normalizeDoi)).size).toBe(1);
  });

  it('二重接頭辞も剥がす', () => {
    expect(normalizeDoi('doi:https://doi.org/10.1/x')).toBe('10.1/x');
  });

  it('空・非文字列は null', () => {
    expect(normalizeDoi('')).toBeNull();
    expect(normalizeDoi('   ')).toBeNull();
    expect(normalizeDoi(null)).toBeNull();
    expect(normalizeDoi(undefined)).toBeNull();
    expect(normalizeDoi(42)).toBeNull();
  });
});

describe('isDoiLike', () => {
  it('10. で始まりスラッシュを含むものだけ通す', () => {
    expect(isDoiLike('https://doi.org/10.1/x')).toBe(true);
    expect(isDoiLike('978-4-7581-0000-0')).toBe(false);
    expect(isDoiLike('10.1016')).toBe(false);
  });
});

describe('uniqueDois', () => {
  it('正規化して重複を落とし、登場順を保つ', () => {
    expect(
      uniqueDois([
        '10.2/B',
        'https://doi.org/10.1/a',
        '10.1/A',
        null,
        '10.2/b',
      ]),
    ).toEqual(['10.2/b', '10.1/a']);
  });
});
