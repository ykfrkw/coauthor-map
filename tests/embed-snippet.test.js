import { describe, expect, it } from 'vitest';

import {
  AUTHOR_URL,
  CONTROLS_EMBED_HEIGHT,
  DEFAULT_EMBED_HEIGHT,
  IFRAME_ALLOW,
  TOOL_URL,
  assertSnippetIsSafe,
  buildSnippet,
  buildToolUrl,
  defaultHeightFor,
} from '../src/ui/embed-snippet.js';
import { DEFAULTS } from '../src/ui/controls.js';

const SRC = 'https://ykfrkw.github.io/coauthor-map/widget.html?orcid=0000-0002';
const CONTROLS_SRC = `${SRC}&controls=on`;

/** スニペット中の `<a href="...">テキスト</a>` を全部拾う */
function anchors(snippet) {
  return [...snippet.matchAll(/<a\s+href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map(
    ([, href, text]) => ({ href, text }),
  );
}

describe('スニペットのクレジット行', () => {
  it('外部リンクはちょうど1本で、その href は yukifurukawa.jp/coauthor-map/', () => {
    const found = anchors(buildSnippet(SRC));
    expect(found).toHaveLength(1);
    expect(found[0].href).toBe('https://yukifurukawa.jp/coauthor-map/');
    expect(found[0].href).toBe(AUTHOR_URL);
  });

  it('アンカーテキストは coauthor-map のみ', () => {
    expect(anchors(buildSnippet(SRC))[0].text).toBe('coauthor-map');
  });

  // 配布先の記事に書き手の名前が残ると、記事の書き手が誰なのか読み手が取り違える。
  it('クレジット行は Made with coauthor-map だけで、人名を含まない', () => {
    const snippet = buildSnippet(SRC);
    expect(snippet).toContain(
      `Made with <a href="${AUTHOR_URL}">coauthor-map</a></p>`,
    );
    expect(snippet).not.toContain('Yuki Furukawa');
    expect(snippet).not.toContain('by Yuki');
  });

  it('自動リサイズを外した版でも人名は入らず、外部リンクは1本のまま', () => {
    const snippet = buildSnippet(SRC, 720, { autoResize: false });
    expect(snippet).not.toContain('Yuki Furukawa');
    const found = anchors(snippet);
    expect(found).toHaveLength(1);
    expect(found[0].href).toBe(AUTHOR_URL);
  });

  // 配布先で同じ外部リンクが2本並ぶフットプリントを避けるため、
  // GitHub Pages 側の URL はスニペットに載せない。
  it('GitHub Pages 側の TOOL_URL はクレジット行に出ない', () => {
    const snippet = buildSnippet(SRC);
    const credit = snippet.slice(snippet.indexOf('<p style='));
    expect(credit).not.toContain(TOOL_URL);
  });

  it('iframe の src はクレジット行のリンクとは別扱いで、そのまま入る', () => {
    expect(buildSnippet(SRC)).toContain(`src="${SRC}"`);
  });
});

/**
 * クロスオリジンの iframe では、親が `clipboard-write` を委譲しない限り
 * `navigator.clipboard.writeText()` が拒否される。`controls=on` の埋め込みは
 * 枠の中で埋め込みコードを作れるので、これが無いとコピーが黙って落ちる。
 */
describe('クリップボードの委譲', () => {
  it('iframe に allow="clipboard-write" が入る', () => {
    expect(IFRAME_ALLOW).toBe('clipboard-write');
    expect(buildSnippet(SRC)).toContain('allow="clipboard-write"');
    expect(buildSnippet(CONTROLS_SRC)).toContain('allow="clipboard-write"');
  });

  it('自動リサイズを外した版にも入る', () => {
    expect(buildSnippet(CONTROLS_SRC, 850, { autoResize: false })).toContain(
      'allow="clipboard-write"',
    );
  });

  // 読み取りまで渡すと、親ページのクリップボードを覗ける経路が開く。
  // 書き込みだけに絞る
  it('clipboard-read は委譲しない', () => {
    expect(buildSnippet(CONTROLS_SRC)).not.toContain('clipboard-read');
  });

  it('allow は iframe だけに付く（1 か所）', () => {
    const snippet = buildSnippet(CONTROLS_SRC);
    expect(snippet.match(/allow="/g)).toHaveLength(1);
    expect(snippet).toMatch(/<iframe[^>]*allow="clipboard-write"[^>]*>/);
  });
});

describe('WAF 対策の検査', () => {
  it('生成したスニペットは検査を通る', () => {
    expect(() => assertSnippetIsSafe(buildSnippet(SRC))).not.toThrow();
  });

  it('style ブロックの CSS コメントを弾く', () => {
    const bad = '<style>\n  .a{color:red;} /* note */\n</style>';
    expect(() => assertSnippetIsSafe(bad)).toThrow(/CSS comment/);
  });

  it('style ブロックの子結合子を弾く', () => {
    const bad = '<style>\n  .a .b{color:red;}\n</style>'.replace(
      ' .b',
      ' > .b',
    );
    expect(() => assertSnippetIsSafe(bad)).toThrow(/child combinator/);
  });

  it('高さは 240px を下回らない', () => {
    expect(buildSnippet(SRC, 10)).toContain('style="height:240px"');
    expect(buildSnippet(SRC, 900)).toContain('style="height:900px"');
  });
});

describe('初期高さ', () => {
  // 720 のままだと本文幅 780px で 250px 以上の空白が地図の下に出て、
  // スニペットが親ページに置くクレジット行との間が大きく空く。
  // 実測（幅 776px → 458px / 783px → 462px）に合わせた値を既定にする。
  it('既定は実測に合わせた 460px', () => {
    expect(DEFAULT_EMBED_HEIGHT).toBe(460);
    expect(buildSnippet(SRC)).toContain('style="height:460px"');
  });

  it('空・不正な入力でも既定の高さに落ちる', () => {
    for (const value of ['', 'abc', null, undefined]) {
      expect(buildSnippet(SRC, value)).toContain(
        `style="height:${DEFAULT_EMBED_HEIGHT}px"`,
      );
    }
  });

  // 自動リサイズ後の高さは本文幅で決まる（地図が幅 × 0.52 で描かれるため）。
  // 既定値との差が 50px 以内に収まる幅の帯を凍結する。
  it('本文幅 690〜870px なら最終高さとの差が 50px 以内', () => {
    // 実測した内訳: 上下の余白 8px + 地図 + 8px + 状態行 30px + 8px。
    // 地図は幅 × 0.52（上限 520px）。端数の丸めで ±1px ずれる。
    const modeled = (frameWidth) =>
      Math.min(520, Math.round((frameWidth - 16) * 0.52)) + 62;

    // ブラウザで実測した値（iframe に入れて embed:height を受けたもの）。
    for (const [width, actual] of [
      [360, 322],
      [640, 387],
      [700, 419],
      [776, 458],
      [783, 462],
      [800, 471],
      [1200, 584],
    ]) {
      // 幅が狭いと状態行が 3 行に折り返して伸びるので、下側だけ緩く見る。
      if (width >= 640)
        expect(Math.abs(modeled(width) - actual)).toBeLessThanOrEqual(2);
    }

    for (const width of [690, 700, 780, 800, 870]) {
      expect(
        Math.abs(modeled(width) - DEFAULT_EMBED_HEIGHT),
      ).toBeLessThanOrEqual(50);
    }
  });
});

describe('`controls=on` の初期高さ', () => {
  it('表示専用と操作 UI 付きで出し分ける', () => {
    expect(defaultHeightFor(SRC)).toBe(DEFAULT_EMBED_HEIGHT);
    expect(defaultHeightFor(CONTROLS_SRC)).toBe(CONTROLS_EMBED_HEIGHT);
    // クエリの先頭に来ても拾う
    expect(
      defaultHeightFor('https://example.test/widget.html?controls=on'),
    ).toBe(CONTROLS_EMBED_HEIGHT);
    // 値が違うものを取り違えない
    expect(defaultHeightFor(`${SRC}&controls=off`)).toBe(DEFAULT_EMBED_HEIGHT);
    expect(defaultHeightFor('')).toBe(DEFAULT_EMBED_HEIGHT);
  });

  it('高さを渡さないスニペットは src に見合う高さになる', () => {
    expect(buildSnippet(SRC)).toContain(
      `style="height:${DEFAULT_EMBED_HEIGHT}px"`,
    );
    expect(buildSnippet(CONTROLS_SRC)).toContain(
      `style="height:${CONTROLS_EMBED_HEIGHT}px"`,
    );
  });

  // ブラウザで実際に iframe に入れて embed:height を受けた値（**折りたたみは
  // 閉じたまま**）。初期高さとの差が 50px を超えると、読み込み直後に枠が飛び跳ねて見える。
  it('本文幅 700〜870px の実測（閉じた状態）との差が 50px 以内', () => {
    for (const [width, actual] of [
      [700, 882],
      [780, 905],
      [870, 934],
    ]) {
      expect(
        Math.abs(CONTROLS_EMBED_HEIGHT - actual),
        `width ${width}`,
      ).toBeLessThanOrEqual(50);
    }
  });

  // 配布先の本文幅そのもの。ここだけは実測に一致させる
  it('本文幅 780px の実測に一致する', () => {
    expect(CONTROLS_EMBED_HEIGHT).toBe(905);
  });

  // 開いた状態（780px で実測 1297px）を初期高さにすると、読者が一度も
  // 開かないまま 390px の空白を抱えることになる。**閉じた状態を既定にする**
  it('開いた状態の高さは既定にしない', () => {
    expect(CONTROLS_EMBED_HEIGHT).toBeLessThan(1297);
  });

  it('表示専用より高い（操作パネルの分だけ枠が要る）', () => {
    expect(CONTROLS_EMBED_HEIGHT).toBeGreaterThan(DEFAULT_EMBED_HEIGHT);
  });
});

describe('遅延読み込みプラグインへの耐性', () => {
  const snippet = buildSnippet(CONTROLS_SRC);

  it('data-src しか無い枠を src に戻すフォールバックが入っている', () => {
    expect(snippet).toContain("getAttribute('data-src')");
    expect(snippet).toContain("setAttribute('src', lazy)");
    // 読み込みが終わってから差し込むプラグインにも間に合わせる
    expect(snippet).toContain("window.addEventListener('load', adoptDataSrc)");
  });

  it('自分の origin の data-src しか採用しない', () => {
    expect(snippet).toContain("lazy.indexOf(ORIGIN + '/') !== 0");
  });

  it('既にある src を上書きしない', () => {
    expect(snippet).toContain("if (!lazy || frames[i].getAttribute('src'))");
  });

  it('高さ通知の origin と source の検証は残っている', () => {
    expect(snippet).toContain('if (event.origin !== ORIGIN) return;');
    expect(snippet).toContain('frames[i].contentWindow === event.source');
  });

  it('枠の特定はクラス名で行う（lazyload クラスが足されても拾える）', () => {
    expect(snippet).toContain(
      "document.querySelectorAll('iframe.coauthor-map-embed')",
    );
  });
});

describe('フルツールへの導線', () => {
  it('index.html を指し、いまの表示状態を引き継ぐ', () => {
    const url = buildToolUrl({ ...DEFAULTS, orcid: '0000-0002-4934-4352' });
    expect(url.startsWith(TOOL_URL)).toBe(true);
    expect(url).toContain('orcid=0000-0002-4934-4352');
  });

  it('`controls` は落とす（フルツールは常に操作パネルを持つ）', () => {
    const url = buildToolUrl({ ...DEFAULTS, controls: true, theme: 'dark' });
    expect(url).not.toContain('controls');
    expect(url).toContain('theme=dark');
  });
});
