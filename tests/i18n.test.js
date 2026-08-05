import { describe, expect, it } from 'vitest';

import {
  PROGRESS_FALLBACK,
  PROGRESS_STRINGS,
  progressLabel,
} from '../src/ui/i18n.js';

/**
 * データ層が発火してよい進捗キーの**唯一の正解表**。
 * 新しいキーを足したらここと src/ui/i18n.js の両方を直すことになる。
 * 片方を忘れたらこのファイルが落ちる。
 */
const PROGRESS_KEYS = [
  'seeds',
  'seeds:orcid',
  'seeds:researchmap',
  'seeds:openalex',
  'works',
  'institutions',
  'aggregate',
];

describe('進捗キーの文言', () => {
  it('キー集合が正解表と完全一致する（訳し忘れ・消し忘れの検出）', () => {
    expect(Object.keys(PROGRESS_STRINGS).sort()).toEqual(
      [...PROGRESS_KEYS].sort(),
    );
  });

  it('すべてのキーに空でない文言が入っている', () => {
    for (const key of PROGRESS_KEYS) {
      expect(progressLabel(key)).toBe(PROGRESS_STRINGS[key]);
      expect(progressLabel(key).trim().length).toBeGreaterThan(0);
    }
  });

  it('文言に日本語が混ざっていない', () => {
    const japanese = /[぀-ヿ㐀-鿿＀-￯　-〿]/;
    for (const value of Object.values(PROGRESS_STRINGS)) {
      expect(value).not.toMatch(japanese);
    }
    expect(PROGRESS_FALLBACK).not.toMatch(japanese);
  });

  it('未知のキーは汎用文言に落ち、キー文字列を生で出さない', () => {
    expect(progressLabel('not-a-real-key')).toBe(PROGRESS_FALLBACK);
    expect(progressLabel('')).toBe(PROGRESS_FALLBACK);
    expect(progressLabel(undefined)).toBe(PROGRESS_FALLBACK);
    // Object.prototype 由来のキーを拾わないこと
    expect(progressLabel('constructor')).toBe(PROGRESS_FALLBACK);
    expect(progressLabel('toString')).toBe(PROGRESS_FALLBACK);
  });
});
