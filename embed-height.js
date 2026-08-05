/**
 * 親フレームへの高さ通知。既存ブログの埋め込み標準に合わせてある。
 *
 *  - iframe の中にいるときだけ動く
 *  - postMessage({ type: 'embed:height', height: <整数px> }, '*')
 *  - ResizeObserver と MutationObserver で監視する
 *  - 高さは documentElement.scrollHeight ではなく **body の子要素から実測**する
 *    （scrollHeight は縮んだときに追従しない。margin 折り畳みでも過大に出る）
 */

if (window.parent !== window) {
  let lastHeight = 0;

  /** body の子要素の下端の最大値を実測する */
  const measure = () => {
    let bottom = 0;
    for (const child of document.body.children) {
      const rect = child.getBoundingClientRect();
      const style = window.getComputedStyle(child);
      if (style.display === 'none' || style.position === 'fixed') continue;
      const marginBottom = Number.parseFloat(style.marginBottom) || 0;
      bottom = Math.max(bottom, rect.bottom + window.scrollY + marginBottom);
    }
    return Math.ceil(bottom);
  };

  const send = () => {
    const height = measure();
    if (!height || height === lastHeight) return;
    lastHeight = height;
    window.parent.postMessage({ type: 'embed:height', height }, '*');
  };

  // 連続発火を 1 フレームにまとめる。
  // requestAnimationFrame は画面外・背面タブでは止まるので
  // （lazy 読み込みの iframe はまさにその状態で始まる）タイマーの保険を併走させる。
  // 二重に走っても send() が同じ高さを弾くので実害はない。
  let queued = false;
  const flush = () => {
    queued = false;
    send();
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    if (typeof requestAnimationFrame === 'function')
      requestAnimationFrame(flush);
    setTimeout(flush, 120);
  };

  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
    for (const child of document.body.children) ro.observe(child);
  }

  const mo = new MutationObserver(schedule);
  mo.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
  });

  window.addEventListener('load', schedule);
  window.addEventListener('resize', schedule);
  schedule();
}
