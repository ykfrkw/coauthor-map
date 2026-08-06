import { describe, expect, it } from 'vitest';

import {
  AUTHOR_URL,
  DEFAULT_EMBED_HEIGHT,
  TOOL_URL,
  assertSnippetIsSafe,
  buildSnippet,
} from '../src/ui/embed-snippet.js';

const SRC = 'https://ykfrkw.github.io/coauthor-map/widget.html?orcid=0000-0002';

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
