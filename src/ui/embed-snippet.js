/**
 * 埋め込みコードの生成。
 *
 * 出力する HTML の形は既存ブログの標準に厳密に合わせてある。
 * **`<style>` の中に CSS コメント（スラッシュ+アスタリスク）と子結合子（大なり記号）を
 * 絶対に入れないこと。** WordPress の WAF がその2つを見て 403 を返す。
 * assertSnippetIsSafe() で毎回検査してから表示する。
 *
 * クレジット行の外部リンクは**ちょうど1本**に保つ。
 * Google のリンクスパム方針が名指ししているのは「ウィジェットに埋めて配布するリンク」で、
 * 可視のブランド名アンカー1本は違反ではない。ただし配布先が増えたときに
 * 同一パターンの外部リンクが2本並ぶフットプリントは避けたいので TOOL_URL は載せない。
 * アンカーテキストは `coauthor-map`、リンク先は AUTHOR_URL に統一する
 * （人名がツールページを指すねじれもこれで消える）。
 * クレジット行は `Made with coauthor-map` だけにする。**人名は入れない**
 * （配布先の記事に書き手の名前が残ると、書き手が誰なのか読み手が取り違える）。
 */
import { h, copyText } from './dom.js';
import { stateToQuery } from './controls.js';

export const WIDGET_BASE = 'https://ykfrkw.github.io/coauthor-map/widget.html';
/** 自サイト内の表示（index.html のフッタなど）用。スニペットには載せない */
export const TOOL_URL = 'https://ykfrkw.github.io/coauthor-map/';
/** スニペットのクレジット行が指す唯一のリンク先 */
export const AUTHOR_URL = 'https://yukifurukawa.jp/coauthor-map/';

const CLASS_NAME = 'coauthor-map-embed';

/**
 * この長さを超えたら警告を出す。IE 以外のブラウザはもっと通すが、
 * 途中の CMS・WAF・メールクライアントが 2000 前後で切ることがある。
 * **黙って切り捨てず**、絞り込みを勧める。
 */
export const URL_WARN_LENGTH = 1800;

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
 * 高さ通知を受ける親側スクリプトの出どころ。widget.html は
 * `postMessage({type:'embed:height'}, '*')` を投げるので、
 * **受け側で origin と source の両方を確かめる**。
 *  - origin: 別サイトの iframe が高さを詐称して枠を伸ばすのを防ぐ
 *  - source: 1 ページに地図を 2 つ貼ったとき、投げた枠だけを伸ばす
 *
 * `<style>` の外なので、比較演算子の大なり記号は WAF の検査対象にならない。
 * @param {string} origin  widget.html の origin
 */
function autoResizeScript(origin) {
  return `  <script>
    (function () {
      if (window.coauthorMapEmbedResize) return;
      window.coauthorMapEmbedResize = true;
      var ORIGIN = '${origin}';
      window.addEventListener('message', function (event) {
        if (event.origin !== ORIGIN) return;
        var data = event.data;
        if (!data || data.type !== 'embed:height') return;
        var height = parseInt(data.height, 10);
        if (!height || height < 100 || height > 5000) return;
        var frames = document.querySelectorAll('iframe.${CLASS_NAME}');
        for (var i = 0; i < frames.length; i++) {
          if (frames[i].contentWindow === event.source) {
            frames[i].style.height = height + 'px';
          }
        }
      });
    })();
  <\/script>
`;
}

/**
 * スニペットの src から origin を取り出す。読めない src が来ても
 * 配布先の URL を落とさないよう、既定の widget の origin に倒す。
 * @param {string} src
 */
export function originOf(src) {
  try {
    return new URL(src, WIDGET_BASE).origin;
  } catch {
    return new URL(WIDGET_BASE).origin;
  }
}

/**
 * スニペット本体。
 *
 * **自動リサイズは既定で入る。** 固定高さだけの版は WordPress 等で
 * script が落とされる場合の逃げ道として残してある（`autoResize: false`）。
 * `style` は自動リサイズが効くまでの初期高さとしても働くので、
 * どちらの版でも書いておく。
 *
 * @param {string} src     widget.html の URL
 * @param {number} height  iframe の高さ（px）
 * @param {{autoResize?: boolean}} [options]
 */
export function buildSnippet(src, height = 720, { autoResize = true } = {}) {
  const px = Math.max(240, Math.round(Number(height) || 720));
  const snippet = `<div style="margin:28px 0;">
  <style>
    .${CLASS_NAME}{display:block;width:100%;border:none;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.08);}
  </style>
  <iframe class="${CLASS_NAME}" title="Co-author map" src="${src}" style="height:${px}px" loading="lazy"></iframe>
  <p style="font-size:13px;margin-top:6px;">Made with <a href="${AUTHOR_URL}">coauthor-map</a></p>
${autoResize ? autoResizeScript(originOf(src)) : ''}</div>`;
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

  const lengthWarning = h('p', { class: 'notice is-error', hidden: true });

  // 自動リサイズが既定。外したい人のためにチェックボックスを 1 つだけ置く
  const autoResizeToggle = h('input', {
    type: 'checkbox',
    id: 'embed-auto-resize',
    checked: true,
  });
  const heightNote = h('span', { class: 'hint' });

  function refresh() {
    const { state, bounds } = getState();
    const autoResize = autoResizeToggle.checked;
    heightNote.textContent = autoResize ? '' : t('embed.fixedHeightNote');
    try {
      const src = buildWidgetUrl(state, bounds);
      textarea.value = buildSnippet(src, heightInput.value, { autoResize });
      // 手直しを URL に載せる以上、長くなりすぎることがある。黙って切らずに知らせる
      const tooLong = src.length > URL_WARN_LENGTH;
      lengthWarning.hidden = !tooLong;
      lengthWarning.textContent = tooLong
        ? t('embed.tooLong', { n: src.length })
        : '';
    } catch (err) {
      textarea.value = '';
      status.textContent = String(err.message ?? err);
    }
  }

  heightInput.addEventListener('input', refresh);
  autoResizeToggle.addEventListener('change', refresh);

  container.append(
    h('p', { class: 'hint', text: t('embed.intro') }),
    h('div', { class: 'controls' }, [
      h('div', { class: 'field' }, [
        h('label', { for: 'embed-height', text: t('embed.height') }),
        heightInput,
        heightNote,
      ]),
      h('div', { class: 'field' }, [
        h('label', { class: 'check-row', for: 'embed-auto-resize' }, [
          autoResizeToggle,
          h('span', { text: t('embed.autoResizeLabel') }),
        ]),
        h('span', { class: 'hint', text: t('embed.autoResizeHint') }),
      ]),
    ]),
    textarea,
    lengthWarning,
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
  );

  return { refresh };
}
