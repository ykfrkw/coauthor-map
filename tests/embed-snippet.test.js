import { describe, expect, it } from 'vitest';

import {
  AUTHOR_URL,
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

  it('アンカーテキストは coauthor-map のみで、人名はリンクにしない', () => {
    const snippet = buildSnippet(SRC);
    expect(anchors(snippet)[0].text).toBe('coauthor-map');
    expect(snippet).toContain('by Yuki Furukawa</p>');
    expect(snippet).not.toMatch(/<a[^>]*>[^<]*Yuki Furukawa/);
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
    const bad = '<style>\n  .a .b{color:red;}\n</style>'.replace(' .b', ' > .b');
    expect(() => assertSnippetIsSafe(bad)).toThrow(/child combinator/);
  });

  it('高さは 240px を下回らない', () => {
    expect(buildSnippet(SRC, 10)).toContain('style="height:240px"');
    expect(buildSnippet(SRC, 900)).toContain('style="height:900px"');
  });
});
