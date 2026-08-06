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
import { stateToQuery, isEndYearOpen } from './controls.js';

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

/**
 * 自動リサイズが効くまでの初期高さ（px）。
 *
 * **実測値に合わせてある。** ウィジェットの中身は
 * 上下 8px の余白 + 地図 + 8px + 状態行（2 行 = 30px）+ 8px で、
 * 地図の高さは（枠幅 − 16）× 0.52（上限 520px）。埋め込み時はウィジェット内の
 * クレジットを出さないので、その分は入らない。
 *
 * 配布先の本文幅は 780px 前後（Kadence の 1290px コンテナ + 右サイドバー +
 * boxed 余白）で、そこでの実測は 458〜462px だった。720px のままだと
 * 250px 以上の空白が地図の下に出て、スニペットが親ページに置く
 * `Made with coauthor-map` との間が大きく空く。
 *
 * 幅 690〜870px の範囲なら、自動リサイズ後の最終高さとの差が 50px 以内に収まる。
 */
export const DEFAULT_EMBED_HEIGHT = 460;

/**
 * `?controls=on` を付けた埋め込みの初期高さ（px）。**実測値**。
 *
 * 表示専用の中身に加えて、種の入力欄（ORCID / researchmap / Load this researcher）と
 * 表示コントロール 6 つを載せた操作パネルが地図の上に乗り、地図の下に
 * 埋め込みコード生成の折りたたみ（閉じた状態で summary 1 行）が付く。
 *
 * ブラウザで iframe に入れて `embed:height` を受けた実測（自動リサイズ後の最終高さ、
 * **折りたたみは閉じたまま**）:
 *   幅 700px → 882 / 780px → 905 / 870px → 934。
 * 配布先の本文幅は 780px 前後なので、そこでの実測に合わせて 905 を既定にする。
 * 折りたたみを足す前は 847（780px）だったので、閉じた状態の増分は 58px。
 *
 * 開くと 780px で 1297px まで伸びるが、**開いた高さは既定に載せない**。
 * 開くのは読者が自分でスニペットを取りに行ったときだけで、そこでは
 * embed-height.js の再通知が親の枠を伸ばす（開閉のたびに通知が飛ぶことは
 * ブラウザで確認済み: 905 → 1297 → 905）。
 *
 * 幅 700px を切ると `.widget-controls-card` の 3 列が 2 列に落ちて操作パネルが
 * 1 行分伸びる（690px で 1016px）。**保証するのは本文幅 700〜870px の帯**で、
 * それより狭い枠は自動リサイズに任せる。
 */
export const CONTROLS_EMBED_HEIGHT = 905;

/** widget.html の URL を今の表示状態から組む */
export function buildWidgetUrl(state, bounds, base = WIDGET_BASE) {
  const query = stateToQuery(state, bounds);
  return query ? `${base}?${query}` : base;
}

/**
 * index.html（フルツール）の URL を今の表示状態から組む。
 *
 * `controls` は widget.html だけの話なので落とす。index.html は常に
 * 操作パネルを持っており、付いていても意味が無いうえに URL が長くなる。
 */
export function buildToolUrl(state, bounds, base = TOOL_URL) {
  const query = stateToQuery({ ...state, controls: false }, bounds);
  return query ? `${base}?${query}` : base;
}

/**
 * その src に見合う初期高さを返す。**表示専用と `controls=on` で出し分ける。**
 * @param {string} src
 * @returns {number}
 */
export function defaultHeightFor(src) {
  return /[?&]controls=on(&|$)/.test(String(src ?? ''))
    ? CONTROLS_EMBED_HEIGHT
    : DEFAULT_EMBED_HEIGHT;
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
 *
 * **遅延読み込みプラグイン対策も同じ script が持つ。** 配布先のブログには
 * 配信時に `src` を `data-src` に移して `lazyload` クラスを足すプラグインが
 * 入っている。枠の特定は `.coauthor-map-embed` クラスで行っているので
 * リサイズ自体は書き換わっても動くが、プラグインの JS が落ちると
 * `data-src` のまま `src` が入らず地図が出ない。その場合に備えて
 * **自分の origin の data-src だけ** src に移す。iframe には `loading="lazy"` が
 * 付いたままなので、src を戻しても実際の取得は表示域に近づくまで起きない。
 *
 * @param {string} origin  widget.html の origin
 */
function autoResizeScript(origin) {
  return `  <script>
    (function () {
      if (window.coauthorMapEmbedResize) return;
      window.coauthorMapEmbedResize = true;
      var ORIGIN = '${origin}';
      function adoptDataSrc() {
        var frames = document.querySelectorAll('iframe.${CLASS_NAME}');
        for (var i = 0; i < frames.length; i++) {
          var lazy = frames[i].getAttribute('data-src');
          if (!lazy || frames[i].getAttribute('src')) continue;
          if (lazy.indexOf(ORIGIN + '/') !== 0) continue;
          frames[i].setAttribute('src', lazy);
        }
      }
      adoptDataSrc();
      window.addEventListener('load', adoptDataSrc);
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
 * iframe の Permissions Policy 委譲。
 *
 * **`controls=on` の埋め込みは枠の中で埋め込みコードを作れる。** その「Copy」は
 * `navigator.clipboard.writeText()` を呼ぶが、**クロスオリジンの iframe では
 * 親から `clipboard-write` を委譲されない限り既定で拒否される**
 * （Permissions Policy の既定の許可リストが `self` のため）。委譲が無いと
 * コピーが黙って失敗し、読者はスニペットを取り出せない。
 *
 * 表示専用の埋め込みには要らない権限だが、**スニペットは 1 種類に保つ**。
 * 出し分けると、読者が後から `controls=on` に変えたときに `allow` が
 * 落ちたままになる。`clipboard-write` は書き込みだけで、読み取り
 * （`clipboard-read`）は委譲しないので、親ページのクリップボードを
 * 覗かれる経路は開かない。
 */
export const IFRAME_ALLOW = 'clipboard-write';

/**
 * スニペット本体。
 *
 * **自動リサイズは既定で入る。** 固定高さだけの版は WordPress 等で
 * script が落とされる場合の逃げ道として残してある（`autoResize: false`）。
 * `style` は自動リサイズが効くまでの初期高さとしても働くので、
 * どちらの版でも書いておく。
 *
 * @param {string} src     widget.html の URL
 * @param {number} [height]  iframe の高さ（px）。省くと src に見合う既定に落ちる
 * @param {{autoResize?: boolean}} [options]
 */
export function buildSnippet(src, height, { autoResize = true } = {}) {
  const fallback = defaultHeightFor(src);
  const px = Math.max(240, Math.round(Number(height) || fallback));
  const snippet = `<div style="margin:28px 0;">
  <style>
    .${CLASS_NAME}{display:block;width:100%;border:none;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.08);}
  </style>
  <iframe class="${CLASS_NAME}" title="Co-author map" src="${src}" style="height:${px}px" loading="lazy" allow="${IFRAME_ALLOW}"></iframe>
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
    value: String(DEFAULT_EMBED_HEIGHT),
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

  // **貼った地図が将来も伸びるのかどうか**を 1 行で出す。
  // 終了年を下げたまま配ると、その年で凍った地図が配布先に残る。
  // 気付ける場所はここしかない（スニペットの見た目からは分からない）
  const growthNote = h('p', { class: 'hint', role: 'status' });

  // 自動リサイズが既定。外したい人のためにチェックボックスを 1 つだけ置く
  const autoResizeToggle = h('input', {
    type: 'checkbox',
    id: 'embed-auto-resize',
    checked: true,
  });
  const heightNote = h('span', { class: 'hint' });

  // 読者が自分の ID を入れて自分の地図を作れる版（`controls=on`）にするか。
  // 既定は表示専用のまま（記事に貼る枠は小さいほうが本文のリズムを壊さない）
  const controlsToggle = h('input', {
    type: 'checkbox',
    id: 'embed-controls',
  });

  /** 高さ欄に既定値が入ったままか（手で書き換えていたら尊重する） */
  const isDefaultHeight = () =>
    heightInput.value === String(DEFAULT_EMBED_HEIGHT) ||
    heightInput.value === String(CONTROLS_EMBED_HEIGHT);

  function refresh() {
    const { state, bounds } = getState();
    const autoResize = autoResizeToggle.checked;
    heightNote.textContent = autoResize ? '' : t('embed.fixedHeightNote');
    growthNote.textContent = isEndYearOpen(state, bounds)
      ? t('embed.keepsGrowing')
      : t('embed.frozenAt', { year: state.to });
    try {
      const src = buildWidgetUrl(
        { ...state, controls: controlsToggle.checked },
        bounds,
      );
      // 操作 UI の有無で必要な高さが 300px 以上変わる。既定のままなら追従させる
      if (isDefaultHeight()) heightInput.value = String(defaultHeightFor(src));
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
  controlsToggle.addEventListener('change', refresh);

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
      h('div', { class: 'field' }, [
        h('label', { class: 'check-row', for: 'embed-controls' }, [
          controlsToggle,
          h('span', { text: t('embed.controlsLabel') }),
        ]),
        h('span', { class: 'hint', text: t('embed.controlsHint') }),
      ]),
    ]),
    growthNote,
    textarea,
    lengthWarning,
    h('div', { class: 'button-row' }, [
      h('button', {
        type: 'button',
        class: 'primary',
        text: t('embed.copy'),
        onclick: async () => {
          const ok = await copyText(textarea.value);
          if (ok) {
            status.textContent = t('table.copied');
            return;
          }
          // **このパネルは埋め込み枠の中でも動く。** クロスオリジンの iframe では
          // 親が `allow="clipboard-write"` を付けていないとクリップボードへの
          // 書き込みが拒否される（execCommand のフォールバックごと落ちることもある）。
          // 黙って終わらせると、読者は押したのに何も起きない画面を見ることになるので、
          // **全選択した状態にして手で取れる形にしてから**そう伝える
          textarea.focus();
          textarea.select();
          status.textContent = t('embed.copyFailed');
        },
      }),
      status,
    ]),
  );

  return { refresh };
}

/**
 * `?controls=on` の埋め込みの末尾に置く、フルツールへの導線。**1 本だけ。**
 *
 * 埋め込みでは出さないもの（補正・集計テーブル・ダウンロード・出典一覧）に
 * 行ける唯一の道なので、**いまの表示状態を引き継いで**飛ばす。
 * 引き継がないと、読者が枠の中で組んだ地図がリンクを踏んだ瞬間に消える。
 * 埋め込みコード生成は枠の中に入ったので、この導線が担う仕事から外れた。
 *
 * 別タブで開く。埋め込み枠の中で遷移すると、記事を読んでいた場所に戻れなくなる。
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {(k: string, p?: Object) => string} opts.t
 */
export function createOpenFullToolLink({ container, t }) {
  const link = h('a', {
    href: TOOL_URL,
    target: '_blank',
    rel: 'noopener',
    text: t('widget.openFullTool'),
  });
  container.append(h('p', { class: 'hint' }, [link]));

  return {
    /**
     * @param {Object} state
     * @param {{from: number, to: number}} [bounds]
     */
    refresh(state, bounds) {
      link.href = buildToolUrl(state, bounds);
    },
  };
}
