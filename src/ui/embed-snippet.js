/**
 * 埋め込みコードの生成。
 *
 * 出力する HTML の形は既存ブログの標準に厳密に合わせてある。
 * **`<style>` の中に CSS コメント（スラッシュ+アスタリスク）と子結合子（大なり記号）を
 * 絶対に入れないこと。** WordPress の WAF がその2つを見て 403 を返す。
 * assertSnippetIsSafe() で毎回検査してから表示する。
 *
 * クレジット行は必ず含める。ここが被リンクの経路なので外さない。
 */
import { h, copyText } from './dom.js';
import { stateToQuery } from './controls.js';

export const WIDGET_BASE = 'https://ykfrkw.github.io/coauthor-map/widget.html';
export const TOOL_URL = 'https://ykfrkw.github.io/coauthor-map/';
export const AUTHOR_URL = 'https://yukifurukawa.jp/coauthor-map/';

const CLASS_NAME = 'coauthor-map-embed';

/** widget.html の URL を今の表示状態から組む */
export function buildWidgetUrl(state, bounds, base = WIDGET_BASE) {
  const query = stateToQuery(state, bounds);
  return query ? `${base}?${query}` : base;
}

/**
 * WAF に引っかかる文字が style ブロックに混じっていないか確かめる。
 * 混じっていたら生成側のバグなので投げる。
 */
export function assertSnippetIsSafe(snippet) {
  const style = snippet.match(/<style>([\s\S]*?)<\/style>/);
  if (!style) return snippet;
  const body = style[1];
  if (body.includes('/*') || body.includes('*/')) {
    throw new Error(
      'The style block contains a CSS comment; a WAF would answer 403.',
    );
  }
  if (body.includes('>')) {
    throw new Error(
      'The style block contains a child combinator; a WAF would answer 403.',
    );
  }
  return snippet;
}

/**
 * スニペット本体。
 * @param {string} src     widget.html の URL
 * @param {number} height  iframe の高さ（px）
 */
export function buildSnippet(src, height = 720) {
  const px = Math.max(240, Math.round(Number(height) || 720));
  const snippet = `<div style="margin:28px 0;">
  <style>
    .${CLASS_NAME}{display:block;width:100%;border:none;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.08);}
  </style>
  <iframe class="${CLASS_NAME}" title="Co-author map" src="${src}" style="height:${px}px" loading="lazy"></iframe>
  <p style="font-size:13px;margin-top:6px;">Made with <a href="${TOOL_URL}">coauthor-map</a> by <a href="${AUTHOR_URL}">Yuki Furukawa</a></p>
</div>`;
  return assertSnippetIsSafe(snippet);
}

/**
 * 埋め込みコードのパネル。
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {(k: string, p?: Object) => string} opts.t
 * @param {() => {state: Object, bounds: Object}} opts.getState
 */
export function createEmbedPanel({ container, t, getState }) {
  const heightInput = h('input', {
    type: 'text',
    id: 'embed-height',
    value: '720',
    inputmode: 'numeric',
    size: '5',
  });
  const textarea = h('textarea', {
    class: 'snippet',
    readonly: true,
    spellcheck: 'false',
    'aria-label': t('embed.heading'),
  });
  const status = h('span', {
    class: 'hint',
    role: 'status',
    'aria-live': 'polite',
  });

  function refresh() {
    const { state, bounds } = getState();
    try {
      textarea.value = buildSnippet(
        buildWidgetUrl(state, bounds),
        heightInput.value,
      );
    } catch (err) {
      textarea.value = '';
      status.textContent = String(err.message ?? err);
    }
  }

  heightInput.addEventListener('input', refresh);

  container.append(
    h('p', { class: 'hint', text: t('embed.intro') }),
    h('div', { class: 'field' }, [
      h('label', { for: 'embed-height', text: t('embed.height') }),
      heightInput,
    ]),
    textarea,
    h('div', { class: 'button-row' }, [
      h('button', {
        type: 'button',
        class: 'primary',
        text: t('embed.copy'),
        onclick: async () => {
          const ok = await copyText(textarea.value);
          status.textContent = ok ? t('table.copied') : t('table.copyFailed');
        },
      }),
      status,
    ]),
    h('p', { class: 'hint', text: t('embed.autoResize') }),
  );

  return { refresh };
}
