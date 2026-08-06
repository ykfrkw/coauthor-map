/**
 * 見た目の設定（ラベル / 凡例 / 年範囲 / 自動リサイズ）の凍結。
 *
 * ここで見るのは**集計の数字に依存しない**ものだけ。
 * 集計結果は別の作業で動きうるので、この一式はそれに巻き込まれないようにする。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  DEFAULTS,
  YEAR_OPEN_KEYWORD,
  clampYearRange,
  formatYearRange,
  isEndYearOpen,
  isStartYearOpen,
  readStateFromUrl,
  stateToQuery,
} from '../src/ui/controls.js';
import {
  assertSnippetIsSafe,
  buildSnippet,
  originOf,
} from '../src/ui/embed-snippet.js';
import { STRINGS, createTranslator } from '../src/ui/i18n.js';

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

/**
 * **この地図は今後も自動で伸びるのか**を、URL と画面の両方で凍結する。
 *
 * 終了年をデータの最大年に置いたままなら URL に `to` は書かれず、
 * 論文が増えれば次のアクセスで反映される。壊れやすいのは
 * 「URL には書かれていないのに、画面は 2026 で止まったように見える」ズレなので、
 * URL 側と表示側を同じ describe に並べて一緒に見る。
 */
describe('終了年を固定しない状態', () => {
  it('スライダー未操作なら to= も from= も URL に出ない', () => {
    const state = readStateFromUrl('');
    expect(state.from).toBe(null);
    expect(state.to).toBe(null);
    const query = stateToQuery(state, BOUNDS);
    expect(query).not.toContain('to=');
    expect(query).not.toContain('from=');
  });

  it('端まで動かしただけ（= 境界と同じ値）でも URL には焼き込まない', () => {
    // 画面を触ると state.from / state.to には実数が入る。
    // 境界と同じなら「動かしていない」のと同じ扱いにする
    const query = stateToQuery(
      { ...readStateFromUrl(''), from: 2019, to: 2026 },
      BOUNDS,
    );
    expect(query).not.toContain('to=');
    expect(query).not.toContain('from=');
  });

  it('終了年を下げると to= が出て、最大に戻すと消える', () => {
    const state = readStateFromUrl('');
    state.to = 2024;
    expect(stateToQuery(state, BOUNDS)).toContain('to=2024');
    state.to = BOUNDS.to;
    expect(stateToQuery(state, BOUNDS)).not.toContain('to=');
  });

  it('開始年を上げると from= が出て、最小に戻すと消える', () => {
    const state = readStateFromUrl('');
    state.from = 2022;
    expect(stateToQuery(state, BOUNDS)).toContain('from=2022');
    state.from = BOUNDS.from;
    expect(stateToQuery(state, BOUNDS)).not.toContain('from=');
  });

  it('isEndYearOpen / isStartYearOpen が URL の書き出し条件と一致する', () => {
    for (const [from, to] of [
      [null, null],
      [2019, 2026],
      [2022, 2026],
      [2019, 2024],
      [2022, 2024],
    ]) {
      const state = { ...readStateFromUrl(''), from, to };
      const query = stateToQuery(state, BOUNDS);
      expect(isStartYearOpen(state, BOUNDS)).toBe(!query.includes('from='));
      expect(isEndYearOpen(state, BOUNDS)).toBe(!query.includes('to='));
    }
  });

  it('?to=latest は to 未指定と同じ状態になる', () => {
    expect(readStateFromUrl('?to=latest').to).toBe(null);
    expect(readStateFromUrl('?to=latest')).toEqual(readStateFromUrl(''));
    // 大文字・前後の空白でも同じ
    expect(readStateFromUrl('?to=LATEST').to).toBe(null);
    expect(readStateFromUrl('?to=%20latest%20').to).toBe(null);
  });

  it('?from=earliest も from 未指定と同じ状態になる', () => {
    expect(readStateFromUrl('?from=earliest').from).toBe(null);
    expect(readStateFromUrl('?from=earliest')).toEqual(readStateFromUrl(''));
    expect(readStateFromUrl('?from=EARLIEST').from).toBe(null);
  });

  it('語は読むだけで書き出さない（URL を短く保つ）', () => {
    const query = stateToQuery(
      readStateFromUrl('?from=earliest&to=latest'),
      BOUNDS,
    );
    expect(query).not.toContain('latest');
    expect(query).not.toContain('earliest');
    expect(query).not.toContain('to=');
    expect(query).not.toContain('from=');
  });

  it('語は互いに入れ替わらない（to=earliest / from=latest は年ではないので落とす）', () => {
    // どちらも数字にならないので null = 未指定に倒れる。
    // 「反対側の語を書いたら別の意味になる」余地を作らない
    expect(readStateFromUrl('?to=earliest').to).toBe(null);
    expect(readStateFromUrl('?from=latest').from).toBe(null);
  });

  it('表示は、開いているときは年ではなく latest になる', () => {
    // 開いている: 右端は年を出さない
    expect(formatYearRange(2019, 2026, BOUNDS, 'latest')).toBe('2019 – latest');
    expect(formatYearRange(2022, 2026, BOUNDS, 'latest')).toBe('2022 – latest');
    // 固定している: 従来どおり年
    expect(formatYearRange(2019, 2024, BOUNDS, 'latest')).toBe('2019 – 2024');
    // 開始側は最小年でも数字のまま（`2019 – present` と同じ読み方に揃える）
    expect(formatYearRange(2019, 2026, BOUNDS, 'latest')).not.toContain(
      'earliest',
    );
    // つまみの value は文字列で来るので、型が違っても判定できること
    expect(formatYearRange('2019', '2026', BOUNDS, 'latest')).toBe(
      '2019 – latest',
    );
  });

  it('画面に出す語と URL に書ける語が同じ（利用者が結び付けられる）', () => {
    expect(STRINGS['ctrl.yearLatest']).toBe(YEAR_OPEN_KEYWORD.to);
    expect(readStateFromUrl(`?to=${STRINGS['ctrl.yearLatest']}`).to).toBe(null);
  });

  it('読み上げも「2026」ではなく latest になる', () => {
    const t = createTranslator();
    expect(t('ctrl.yearLatest')).toBe('latest');
    // aria-label 側も「開いている」意味を持つ
    expect(t('ctrl.yearToOpen')).toMatch(/open/i);
    expect(t('ctrl.yearToOpen')).not.toBe(t('ctrl.yearTo'));
  });

  it('埋め込みパネルの 1 行が、開いているときと固定したときで別のことを言う', () => {
    const t = createTranslator();
    const open = t('embed.keepsGrowing');
    const frozen = t('embed.frozenAt', { year: 2024 });
    expect(open).not.toBe(frozen);
    // 開いている: 自動で載ることを言う
    expect(open).toMatch(/by itself|automatic/i);
    // 固定: 何年で止まるかと、戻し方を言う
    expect(frozen).toContain('2024');
    expect(frozen).not.toContain('2,024'); // 年に桁区切りを付けない
    expect(frozen).toMatch(/drag/i);
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

describe('丸の大きさの基準', () => {
  it('既定は共著者数（人が主役の地図なので）', () => {
    expect(DEFAULTS.size).toBe('coauthors');
    expect(readStateFromUrl('').size).toBe('coauthors');
    expect(stateToQuery(readStateFromUrl(''), BOUNDS)).not.toContain('size=');
  });

  it('size=papers は既定と違うので URL に載って往復する', () => {
    const state = readStateFromUrl('?size=papers');
    expect(state.size).toBe('papers');
    const query = stateToQuery(state, BOUNDS);
    expect(query).toContain('size=papers');
    expect(readStateFromUrl(`?${query}`).size).toBe('papers');
  });
});

describe('ウィジェットのクレジット行', () => {
  const widgetHtml = readFileSync(
    new URL('../widget.html', import.meta.url),
    'utf8',
  );

  it('既定は hidden で、単体表示のときだけ出す', () => {
    // iframe の内側のリンクは埋め込み先からの被リンクにならない。
    // 効くのはスニペットが親ページに置く行だけなので、埋め込み時は出さない。
    expect(widgetHtml).toMatch(/id="widget-credit"[^>]*\shidden/);
    expect(widgetHtml).toContain('window.parent === window');
  });

  it('外部リンクは 1 本だけで yukifurukawa.jp/coauthor-map/ を指す', () => {
    const hrefs = [...widgetHtml.matchAll(/href="(https?:\/\/[^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(hrefs).toEqual(['https://yukifurukawa.jp/coauthor-map/']);
  });
});
