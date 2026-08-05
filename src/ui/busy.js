/**
 * 読み込み中インジケータの出し入れ。**DOM を持たない状態機械**にしてある。
 *
 * 決め事:
 *  - 出すのは「一定時間より長くかかったとき」だけ。キャッシュが効いて即座に描ける
 *    ときにちらつかせない（既定 200ms）
 *  - `stop()` は成功でも失敗でも必ず効く。待機中のタイマーも消すので、
 *    200ms 以内に落ちたときはそもそも出ない
 *  - 二重に `start()` しても表示は 1 つ（`show` は 1 回しか呼ばれない）
 */

/** 表示までの待ち時間（ms）。これより短く終わるなら出さない。 */
export const BUSY_DELAY_MS = 200;

/**
 * @param {Object} opts
 * @param {() => void} opts.show
 * @param {() => void} opts.hide
 * @param {number} [opts.delayMs]
 * @param {(fn: () => void, ms: number) => any} [opts.setTimeoutImpl]
 * @param {(handle: any) => void} [opts.clearTimeoutImpl]
 */
export function createBusyController({
  show,
  hide,
  delayMs = BUSY_DELAY_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  let timer = null;
  let visible = false;

  function start() {
    if (visible || timer !== null) return;
    timer = setTimeoutImpl(() => {
      timer = null;
      visible = true;
      show();
    }, delayMs);
  }

  function stop() {
    if (timer !== null) {
      clearTimeoutImpl(timer);
      timer = null;
    }
    if (!visible) return;
    visible = false;
    hide();
  }

  return {
    start,
    stop,
    get visible() {
      return visible;
    },
    get pending() {
      return timer !== null;
    },
  };
}
