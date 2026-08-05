/**
 * レビューコメントの保存・書き出し・取り込み。
 * localStorage は差し替えられるようにしてあるので、偽ストレージで確かめる。
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TAG,
  PAGES,
  TAGS,
  clearComments,
  countByTag,
  createComment,
  exportJson,
  importJson,
  loadComments,
  newId,
  normalizeComment,
  normalizeComments,
  normalizePage,
  reviewStorageKey,
  saveComments,
} from '../src/review/store.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

const anchor = {
  selector: '#legend',
  elementText: 'Pin area',
  rx: 0.25,
  ry: 0.8,
  pageX: 200,
  pageY: 1280,
};

describe('キーとページ', () => {
  it('index / widget でキーを分ける。未知のページは index に落とす', () => {
    expect(PAGES).toEqual(['index', 'widget']);
    expect(normalizePage('widget')).toBe('widget');
    expect(normalizePage('nope')).toBe('index');
    expect(reviewStorageKey('index')).toBe('coauthor-map:review:v1:index');
    expect(reviewStorageKey('widget')).toBe('coauthor-map:review:v1:widget');
    expect(reviewStorageKey(undefined)).toBe('coauthor-map:review:v1:index');
  });

  it('id は毎回違う', () => {
    expect(newId()).not.toBe(newId());
  });
});

describe('normalizeComment', () => {
  it('未知のキーを捨て、型を揃える', () => {
    const comment = normalizeComment({
      id: 'abc',
      tag: 'bug',
      body: 'too small',
      selector: ' #legend ',
      elementText: 'Pin area',
      rx: '0.25',
      ry: 5,
      pageX: '200',
      pageY: 1280,
      createdAt: '2026-08-05T00:00:00.000Z',
      evil: '<script>',
    });
    expect(comment).toEqual({
      id: 'abc',
      tag: 'bug',
      body: 'too small',
      selector: '#legend',
      elementText: 'Pin area',
      rx: 0.25,
      ry: 1,
      pageX: 200,
      pageY: 1280,
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z',
    });
    expect(comment).not.toHaveProperty('evil');
  });

  it('知らない種別は既定の design に落とす', () => {
    expect(normalizeComment({ selector: '#a', tag: 'nope' }).tag).toBe(
      DEFAULT_TAG,
    );
    expect(DEFAULT_TAG).toBe('design');
    expect(TAGS).toEqual(['bug', 'design', 'copy', 'idea']);
  });

  it('中身の無い行は捨てる', () => {
    expect(normalizeComment(null)).toBeNull();
    expect(normalizeComment('x')).toBeNull();
    expect(normalizeComment([])).toBeNull();
    expect(normalizeComment({})).toBeNull();
  });

  it('配列でも保存形でも受け、id の重複は落とす', () => {
    const rows = [
      { id: 'a', selector: '#a' },
      { id: 'a', selector: '#b' },
      { id: 'b', selector: '#c' },
      null,
    ];
    expect(normalizeComments(rows).map((c) => c.id)).toEqual(['a', 'b']);
    expect(normalizeComments({ comments: rows }).map((c) => c.id)).toEqual([
      'a',
      'b',
    ]);
    expect(normalizeComments(undefined)).toEqual([]);
  });
});

describe('createComment', () => {
  it('アンカーからコメントを作る。既定の種別は design', () => {
    const comment = createComment({ anchor, now: '2026-08-05T01:02:03.000Z' });
    expect(comment).toMatchObject({
      tag: 'design',
      body: '',
      selector: '#legend',
      rx: 0.25,
      ry: 0.8,
      pageX: 200,
      pageY: 1280,
      createdAt: '2026-08-05T01:02:03.000Z',
      updatedAt: '2026-08-05T01:02:03.000Z',
    });
    expect(comment.id).toBeTruthy();
  });
});

describe('localStorage への保存', () => {
  it('保存して読み戻せる（リロードで消えない）', () => {
    const storage = fakeStorage();
    const comment = createComment({ anchor, now: '2026-08-05T00:00:00.000Z' });
    expect(saveComments('index', [comment], storage)).toBe(true);
    expect(storage.map.has('coauthor-map:review:v1:index')).toBe(true);
    expect(loadComments('index', storage)).toEqual([comment]);
    // ページが違えば混ざらない
    expect(loadComments('widget', storage)).toEqual([]);
  });

  it('消せる', () => {
    const storage = fakeStorage();
    saveComments('widget', [createComment({ anchor })], storage);
    expect(clearComments('widget', storage)).toBe(true);
    expect(loadComments('widget', storage)).toEqual([]);
  });

  it('localStorage が無くても落ちない', () => {
    expect(loadComments('index', null)).toEqual([]);
    expect(saveComments('index', [], null)).toBe(false);
    expect(clearComments('index', null)).toBe(false);
  });

  it('壊れた JSON が入っていても空で返す', () => {
    const storage = fakeStorage({
      'coauthor-map:review:v1:index': '{ not json',
    });
    expect(loadComments('index', storage)).toEqual([]);
  });

  it('書き込みが拒まれたら false（プライベートモード・容量超過）', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(saveComments('index', [createComment({ anchor })], storage)).toBe(
      false,
    );
  });
});

describe('JSON の書き出しと取り込み', () => {
  it('書き出しは version / page / comments を持つ整形済み JSON', () => {
    const comment = createComment({ anchor, now: '2026-08-05T00:00:00.000Z' });
    const json = exportJson('widget', [comment]);
    expect(json.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.page).toBe('widget');
    expect(parsed.comments).toHaveLength(1);
  });

  it('書き出した JSON をそのまま取り込める（引き継ぎ）', () => {
    const comment = createComment({ anchor, now: '2026-08-05T00:00:00.000Z' });
    expect(importJson(exportJson('index', [comment]))).toEqual([comment]);
  });

  it('形が壊れていれば Error', () => {
    expect(() => importJson('{ not json')).toThrow(/Could not parse/);
    expect(() => importJson(null)).toThrow(/must be an object/);
    expect(() => importJson({ nope: 1 })).toThrow(/no comments array/);
  });
});

describe('countByTag', () => {
  it('種別ごとに数える。全種別のキーが揃う', () => {
    const counts = countByTag([
      { tag: 'bug' },
      { tag: 'bug' },
      { tag: 'idea' },
      { tag: 'nope' },
      null,
    ]);
    expect(counts).toEqual({ bug: 2, design: 0, copy: 0, idea: 1 });
  });
});
