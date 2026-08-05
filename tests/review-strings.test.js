/**
 * レビューモードの文言。本体と同じく **US 英語 1 言語**。
 * 画面に出る文字列に日本語が混ざっていないことを見張る。
 */
import { describe, expect, it } from 'vitest';

import {
  REVIEW_STRINGS,
  TAG_LABEL_KEYS,
  reviewText,
  tagLabel,
} from '../src/review/strings.js';
import { TAGS } from '../src/review/store.js';

describe('レビューモードの文言', () => {
  it('すべて空でない文字列', () => {
    for (const [key, value] of Object.entries(REVIEW_STRINGS)) {
      expect(typeof value, key).toBe('string');
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('日本語が混ざっていない', () => {
    const japanese = /[぀-ヿ㐀-鿿＀-￯　-〿]/;
    for (const [key, value] of Object.entries(REVIEW_STRINGS)) {
      expect(value, key).not.toMatch(japanese);
    }
  });

  it('{name} を差し込める。渡されなかった箇所はそのまま残す', () => {
    expect(reviewText('rev.count', { n: 3 })).toBe('3 comments');
    expect(reviewText('rev.pinAria', { n: 1, body: 'too small' })).toBe(
      'Review comment 1: too small',
    );
    expect(reviewText('rev.count')).toBe('{n} comments');
  });

  it('知らないキーは Object.prototype 由来を含めて素通しする', () => {
    expect(reviewText('rev.nope')).toBe('rev.nope');
    expect(reviewText('constructor')).toBe('constructor');
    expect(reviewText('toString')).toBe('toString');
  });

  it('種別はすべてラベルを持つ', () => {
    expect(Object.keys(TAG_LABEL_KEYS).sort()).toEqual([...TAGS].sort());
    for (const tag of TAGS) {
      expect(tagLabel(tag)).toBe(REVIEW_STRINGS[TAG_LABEL_KEYS[tag]]);
      expect(tagLabel(tag)).not.toMatch(/^rev\./);
    }
    // 知らない種別は design のラベルに落ちる
    expect(tagLabel('nope')).toBe(REVIEW_STRINGS['rev.tag.design']);
  });
});
