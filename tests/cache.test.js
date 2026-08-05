import { afterEach, describe, expect, it } from 'vitest';

import {
  clearCache,
  isCacheAvailable,
  makeCacheKey,
  readCache,
  withCache,
  writeCache,
} from '../src/cache.js';

/**
 * sessionStorage の最小実装。Node には無いので差し込む。
 */
function installSessionStorage(impl) {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: impl,
    configurable: true,
    writable: true,
  });
}

function memoryStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
  };
}

afterEach(() => {
  delete globalThis.sessionStorage;
});

describe('cache', () => {
  it('sessionStorage が無い環境では黙って no-op になる', async () => {
    expect(isCacheAvailable()).toBe(false);
    expect(readCache(makeCacheKey(['x']))).toBeUndefined();
    expect(writeCache(makeCacheKey(['x']), 1)).toBe(false);
    expect(clearCache()).toBe(0);

    let calls = 0;
    const loader = async () => {
      calls += 1;
      return 'value';
    };
    expect(await withCache(['seed', 'orcid'], loader)).toBe('value');
    expect(await withCache(['seed', 'orcid'], loader)).toBe('value');
    expect(calls).toBe(2); // キャッシュが効かないだけで動く
  });

  it('保存に失敗しても致命エラーにしない', async () => {
    installSessionStorage({
      ...memoryStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(isCacheAvailable()).toBe(false); // 書き込み試験に落ちるので使えないと判定
    await expect(withCache(['x'], async () => 1)).resolves.toBe(1);
  });

  it('24 時間はキャッシュが効き、超えると再取得する', async () => {
    installSessionStorage(memoryStorage());
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return { works: calls };
    };

    const now = 1_700_000_000_000;
    expect(await withCache(['seed', 'orcid', '0000'], loader, { now })).toEqual(
      { works: 1 },
    );
    expect(
      await withCache(['seed', 'orcid', '0000'], loader, { now: now + 1000 }),
    ).toEqual({
      works: 1,
    });
    expect(calls).toBe(1);

    // 24 時間 + 1ms
    const later = now + 24 * 60 * 60 * 1000 + 1;
    expect(
      await withCache(['seed', 'orcid', '0000'], loader, { now: later }),
    ).toEqual({
      works: 2,
    });
    expect(calls).toBe(2);
  });

  it('キーはプロパティの並び順に依存しない', () => {
    expect(makeCacheKey({ a: 1, b: 2 })).toBe(makeCacheKey({ b: 2, a: 1 }));
    expect(makeCacheKey(['a', 'b'])).not.toBe(makeCacheKey(['b', 'a']));
  });

  it('clearCache は自分の名前空間だけ消す', () => {
    installSessionStorage(memoryStorage());
    writeCache(makeCacheKey(['x']), 1);
    globalThis.sessionStorage.setItem('other-app', '1');
    expect(clearCache()).toBe(1);
    expect(globalThis.sessionStorage.getItem('other-app')).toBe('1');
  });
});
