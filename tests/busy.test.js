/**
 * 読み込み中インジケータの出し入れ。
 *
 * 押さえるのは 2 つ:
 *   1. 200ms 未満で終わるなら**出さない**（キャッシュが効いたときのちらつき防止）
 *   2. `stop()` は成功でも失敗でも必ず効く。**エラーで出っぱなしにならない**
 */
import { describe, expect, it } from 'vitest';

import { BUSY_DELAY_MS, createBusyController } from '../src/ui/busy.js';

/** 手で進める偽タイマー */
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeoutImpl(fn, ms) {
      const id = nextId;
      nextId += 1;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeoutImpl(id) {
      pending.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, entry] of [...pending]) {
        if (entry.at > now) continue;
        pending.delete(id);
        entry.fn();
      }
    },
    get pendingCount() {
      return pending.size;
    },
  };
}

function setup() {
  const timers = fakeTimers();
  const calls = { show: 0, hide: 0 };
  const busy = createBusyController({
    show: () => {
      calls.show += 1;
    },
    hide: () => {
      calls.hide += 1;
    },
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });
  return { timers, calls, busy };
}

describe('createBusyController', () => {
  it('既定の待ち時間は 200ms', () => {
    expect(BUSY_DELAY_MS).toBe(200);
  });

  it('200ms より早く終われば一度も出ない', () => {
    const { timers, calls, busy } = setup();
    busy.start();
    timers.advance(150);
    busy.stop();
    timers.advance(1000);
    expect(calls.show).toBe(0);
    expect(calls.hide).toBe(0);
    expect(busy.visible).toBe(false);
    expect(timers.pendingCount).toBe(0);
  });

  it('200ms を越えたら出て、完了で消える', () => {
    const { timers, calls, busy } = setup();
    busy.start();
    timers.advance(BUSY_DELAY_MS);
    expect(calls.show).toBe(1);
    expect(busy.visible).toBe(true);
    busy.stop();
    expect(calls.hide).toBe(1);
    expect(busy.visible).toBe(false);
  });

  it('エラーで抜けても消える（出っぱなしにならない）', () => {
    const { timers, calls, busy } = setup();
    try {
      busy.start();
      timers.advance(BUSY_DELAY_MS);
      throw new Error('network down');
    } catch {
      // 呼び出し側の finally と同じ
      busy.stop();
    }
    expect(calls.show).toBe(1);
    expect(calls.hide).toBe(1);
    expect(busy.visible).toBe(false);
  });

  it('二重に start しても表示は 1 つ', () => {
    const { timers, calls, busy } = setup();
    busy.start();
    busy.start();
    timers.advance(BUSY_DELAY_MS);
    busy.start();
    timers.advance(BUSY_DELAY_MS);
    expect(calls.show).toBe(1);
    busy.stop();
    expect(calls.hide).toBe(1);
  });

  it('出ていないのに stop しても hide は呼ばれない', () => {
    const { calls, busy } = setup();
    busy.stop();
    expect(calls.hide).toBe(0);
  });

  it('stop のあと start し直せる', () => {
    const { timers, calls, busy } = setup();
    busy.start();
    timers.advance(BUSY_DELAY_MS);
    busy.stop();
    busy.start();
    timers.advance(BUSY_DELAY_MS);
    expect(calls.show).toBe(2);
    busy.stop();
    expect(calls.hide).toBe(2);
  });
});
