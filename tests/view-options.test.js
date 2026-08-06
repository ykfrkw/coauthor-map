/**
 * 見た目の設定（ラベル / 凡例 / 年範囲 / 自動リサイズ）の凍結。
 *
 * ここで見るのは**集計の数字に依存しない**ものだけ。
 * 集計結果は別の作業で動きうるので、この一式はそれに巻き込まれないようにする。
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULTS,
  clampYearRange,
  formatYearRange,
  readStateFromUrl,
  stateToQuery,
} from '../src/ui/controls.js';
import {
  assertSnippetIsSafe,
  buildSnippet,
  originOf,
} from '../src/ui/embed-snippet.js';

const SRC = 'https://ykfrkw.github.io/coauthor-map/widget.html?orcid=0000-0002';
const BOUNDS = { from: 2019, to: 2026 };

/** `<style>` ブロックの中身を取り出す（無ければ null） */
function styleBody(snippet) {
  const hit = snippet.match(/<style>([\s\S]*?)<\/style>/);
  return hit ? hit[1] : null;
}

describe('年範囲のつまみ', () => {
  it('交差しない。動かしたほうが相手の位置で止まる', () => {
    // 開始を右に動かしすぎたら、終了の位置で止まる（終了は動かさない）
    expect(clampYearRange(2024, 2020, 'from')).toEqual({
      from: 2020,
      to: 2020,
    });
    // 終了を左に動かしすぎたら、開始の位置で止まる（開始は動かさない）
    expect(clampYearRange(2024, 2020, 'to')).toEqual({
      from: 2024,
      to: 2024,
    });
  });

  it('正しい並びのときは何もしない。同じ年に寄せるのは許す', () => {
    expect(clampYearRange(2019, 2026, 'from')).toEqual({
      from: 2019,
      to: 2026,
    });
    expect(clampYearRange(2021, 2021, 'to')).toEqual({
      from: 2021,
      to: 2021,
    });
  });

  it('どちらを動かしても from <= to が保たれる', () => {
    for (const from of [1990, 2000, 2013, 2026]) {
      for (const to of [1990, 2000, 2013, 2026]) {
        for (const moved of ['from', 'to']) {
          const out = clampYearRange(from, to, moved);
          expect(out.from).toBeLessThanOrEqual(out.to);
        }
      }
    }
  });

  it('表示は en dash でつなぐ', () => {
    expect(formatYearRange(2019, 2026)).toBe('2019 – 2026');
  });
});

describe('都市名ラベルの設定', () => {
  it('既定は非表示（丸に重なって読みにくくなるため）', () => {
    expect(DEFAULTS.labels).toBe(false);
    expect(readStateFromUrl('').labels).toBe(false);
    expect(stateToQuery(readStateFromUrl(''), BOUNDS)).not.toContain('labels=');
  });

  it('labels=on で出て、その状態は URL に載って往復する', () => {
    const state = readStateFromUrl('?labels=on');
    expect(state.labels).toBe(true);
    const query = stateToQuery(state, BOUNDS);
    expect(query).toContain('labels=on');
    expect(readStateFromUrl(`?${query}`).labels).toBe(true);
  });

  it('labels=off と書かれていても既定と同じなので URL には残さない', () => {
    const state = readStateFromUrl('?labels=off');
    expect(state.labels).toBe(false);
    expect(stateToQuery(state, BOUNDS)).not.toContain('labels=');
  });
});

describe('凡例の設定', () => {
  it('既定は null = ページ側の既定に従う（index は出す / widget は出さない）', () => {
    expect(DEFAULTS.legend).toBe(null);
    expect(readStateFromUrl('').legend).toBe(null);
    expect(stateToQuery(readStateFromUrl(''), BOUNDS)).not.toContain('legend=');
  });

  it('明示したときだけ URL に載って、往復しても消えない', () => {
    for (const [raw, value, param] of [
      ['?legend=on', true, 'legend=on'],
      ['?legend=off', false, 'legend=off'],
    ]) {
      const state = readStateFromUrl(raw);
      expect(state.legend).toBe(value);
      const query = stateToQuery(state, BOUNDS);
      expect(query).toContain(param);
      expect(readStateFromUrl(`?${query}`).legend).toBe(value);
    }
  });
});

describe('埋め込みスニペットの自動リサイズ', () => {
  it('既定で親側スクリプトが入る', () => {
    const snippet = buildSnippet(SRC);
    expect(snippet).toContain('embed:height');
    expect(snippet).toContain('window.addEventListener');
    // 初期高さは残す（スクリプトが届くまでと、剥がされたときの保険）
    expect(snippet).toContain('style="height:720px"');
  });

  it('origin と source の両方を確かめている', () => {
    const snippet = buildSnippet(SRC);
    expect(snippet).toContain("var ORIGIN = 'https://ykfrkw.github.io';");
    expect(snippet).toContain('if (event.origin !== ORIGIN) return;');
    expect(snippet).toContain('frames[i].contentWindow === event.source');
  });

  it('ORIGIN は src から引く（配布先を書き換えても付いてくる）', () => {
    expect(originOf(SRC)).toBe('https://ykfrkw.github.io');
    expect(originOf('https://example.test/w/widget.html?a=1')).toBe(
      'https://example.test',
    );
    // 読めない src でも既定の widget の origin に倒す
    expect(originOf('')).toBe('https://ykfrkw.github.io');
  });

  it('1 ページに複数貼っても listener は 1 回しか付かない', () => {
    expect(buildSnippet(SRC)).toContain('window.coauthorMapEmbedResize');
  });

  it('autoResize: false なら script は出ない', () => {
    const snippet = buildSnippet(SRC, 720, { autoResize: false });
    expect(snippet).not.toContain('<script');
    expect(snippet).toContain('style="height:720px"');
  });

  it('script を足しても WAF 対策の検査を通る', () => {
    for (const autoResize of [true, false]) {
      const snippet = buildSnippet(SRC, 640, { autoResize });
      expect(() => assertSnippetIsSafe(snippet)).not.toThrow();
      const body = styleBody(snippet);
      // 検査対象は style ブロックだけ。ここに CSS コメントと子結合子を入れない
      expect(body).not.toContain('/*');
      expect(body).not.toContain('*/');
      expect(body).not.toContain('>');
    }
  });

  it('script の中の大なり記号は style ブロックの外にある', () => {
    const snippet = buildSnippet(SRC);
    // 比較演算子は script 側にだけ現れる
    expect(snippet).toContain('height > 5000');
    expect(styleBody(snippet)).not.toContain('>');
  });
});
