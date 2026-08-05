/**
 * アンカー（セレクタ + 相対位置）の検証。
 *
 * この repo には jsdom を入れていないので、anchor.js が実際に触る API
 * （getAttribute / getAttributeNames / getBoundingClientRect / querySelector）
 * だけを持つ最小の偽 DOM を立てて確かめる。
 */
import { describe, expect, it } from 'vitest';

import {
  buildSelector,
  classNames,
  createAnchor,
  dataAttrSelector,
  elementLabel,
  elementSegment,
  idSelector,
  nthOfType,
  pointInRect,
  quoteAttrValue,
  relativePoint,
  resolveAnchor,
  stableClasses,
} from '../src/review/anchor.js';

/** 偽の要素。attrs は属性名 -> 値 */
function el(tag, attrs = {}, options = {}) {
  const node = {
    tagName: String(tag).toUpperCase(),
    parentElement: null,
    children: [],
    textContent: options.text ?? '',
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    getAttributeNames: () => Object.keys(attrs),
    getBoundingClientRect: () =>
      options.rect ?? { left: 0, top: 0, width: 0, height: 0 },
  };
  if (attrs.class != null) node.className = attrs.class;
  for (const child of options.children ?? []) {
    child.parentElement = node;
    node.children.push(child);
  }
  return node;
}

/** 与えた集合に入っているセレクタだけ一意とみなす */
function uniqueOracle(...selectors) {
  const set = new Set(selectors);
  return (selector) => set.has(selector);
}

describe('セレクタ片の組み立て', () => {
  it('id は #id、書けない文字が混ざれば属性セレクタに逃げる', () => {
    expect(idSelector('legend')).toBe('#legend');
    expect(idSelector('map-wrap_2')).toBe('#map-wrap_2');
    expect(idSelector('2col')).toBe('[id="2col"]');
    expect(idSelector('a b')).toBe('[id="a b"]');
    expect(idSelector('')).toBe('');
  });

  it('属性値の引用符とバックスラッシュを逃がす', () => {
    expect(quoteAttrValue('a"b')).toBe('"a\\"b"');
    expect(quoteAttrValue('a\\b')).toBe('"a\\\\b"');
  });

  it('classList でも className 文字列でも読める', () => {
    expect(classNames({ className: 'a b  c' })).toEqual(['a', 'b', 'c']);
    expect(classNames({ classList: ['x', 'y'] })).toEqual(['x', 'y']);
    expect(classNames({})).toEqual([]);
  });

  it('状態クラス・自動生成っぽいクラスは避け、先頭 2 つまで採る', () => {
    expect(
      stableClasses({ className: 'notice is-error map-legend extra' }),
    ).toEqual(['notice', 'map-legend']);
    expect(
      stableClasses({ className: 'is-open has-focus js-hook _priv' }),
    ).toEqual([]);
    // 連番が末尾に付いたクラスは次の描画で変わりうるので使わない
    expect(stableClasses({ className: 'row-10428 card' })).toEqual(['card']);
  });

  it('data-* は優先表の順に 1 つだけ採り、長すぎる値は使わない', () => {
    expect(dataAttrSelector(el('h2', { 'data-i18n': 'app.title' }))).toBe(
      '[data-i18n="app.title"]',
    );
    // 優先表に無いものは登場順で拾う
    expect(dataAttrSelector(el('div', { 'data-slot': 'legend' }))).toBe(
      '[data-slot="legend"]',
    );
    expect(dataAttrSelector(el('div', { 'data-x': 'y'.repeat(80) }))).toBe('');
    expect(dataAttrSelector(el('div', {}))).toBe('');
  });

  it('セレクタ片はタグ + data-* + クラス。id があれば id だけ', () => {
    expect(elementSegment(el('div', { class: 'map-legend' }))).toBe(
      'div.map-legend',
    );
    expect(
      elementSegment(el('h2', { id: 'h-map', class: 'visually-hidden' })),
    ).toBe('#h-map');
    expect(
      elementSegment(el('p', { class: 'lede', 'data-i18n': 'app.about' })),
    ).toBe('p[data-i18n="app.about"].lede');
  });

  it(':nth-of-type は同じタグの兄弟の中で数える', () => {
    const a = el('li');
    const span = el('span');
    const b = el('li');
    el('ul', {}, { children: [a, span, b] });
    expect(nthOfType(a)).toBe(1);
    expect(nthOfType(b)).toBe(2);
    expect(nthOfType(span)).toBe(1);
    // 親が無ければ 1
    expect(nthOfType(el('div'))).toBe(1);
  });
});

describe('buildSelector', () => {
  it('id が一意ならそれだけで終わる', () => {
    const node = el('div', { id: 'legend', class: 'map-legend' });
    expect(
      buildSelector(node, { isUnique: uniqueOracle('#legend'), doc: {} }),
    ).toBe('#legend');
  });

  it('id が無くても自分の片が一意ならそれを使う', () => {
    const node = el('div', { class: 'map-legend' });
    expect(
      buildSelector(node, {
        isUnique: uniqueOracle('div.map-legend'),
        doc: {},
      }),
    ).toBe('div.map-legend');
  });

  it('一意でなければ祖先を左に足す', () => {
    const leaf = el('span', { class: 'stat' });
    el('div', { id: 'stats' }, { children: [leaf] });
    const selector = buildSelector(leaf, {
      isUnique: uniqueOracle('#stats > span.stat'),
      doc: {},
    });
    expect(selector).toBe('#stats > span.stat');
  });

  it('祖先を足しても一意にならなければ葉を :nth-of-type で絞る', () => {
    const first = el('li');
    const second = el('li');
    el('ol', { id: 'list' }, { children: [first, second] });
    const selector = buildSelector(second, {
      isUnique: uniqueOracle('#list > li:nth-of-type(2)'),
      doc: {},
    });
    expect(selector).toBe('#list > li:nth-of-type(2)');
  });

  it('どうしても一意にできなくても文字列は返す（座標に落ちる前の最善）', () => {
    const node = el('div', { class: 'card' });
    const selector = buildSelector(node, { isUnique: () => false, doc: {} });
    expect(selector).toBe('div.card');
  });

  it('要素が無ければ空文字', () => {
    expect(buildSelector(null, { isUnique: () => true, doc: {} })).toBe('');
  });
});

describe('相対位置', () => {
  it('矩形の中の割合に直し、0〜1 に丸める', () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 };
    expect(relativePoint(rect, 150, 100)).toEqual({ rx: 0.25, ry: 0.5 });
    expect(relativePoint(rect, 0, 0)).toEqual({ rx: 0, ry: 0 });
    expect(relativePoint(rect, 9999, 9999)).toEqual({ rx: 1, ry: 1 });
  });

  it('幅も高さも 0 の要素は中央に置く', () => {
    expect(
      relativePoint({ left: 0, top: 0, width: 0, height: 0 }, 5, 5),
    ).toEqual({ rx: 0.5, ry: 0.5 });
  });

  it('割合から座標へ戻せる', () => {
    const rect = { left: 10, top: 20, width: 100, height: 50 };
    expect(pointInRect(rect, 0.5, 0.2)).toEqual({ x: 60, y: 30 });
  });
});

describe('elementLabel', () => {
  it('空白をつぶし、長ければ省略する', () => {
    expect(elementLabel({ textContent: '  Papers\n  1–10  ' })).toBe(
      'Papers 1–10',
    );
    expect(elementLabel({ textContent: 'x'.repeat(200) })).toHaveLength(73);
    expect(elementLabel({})).toBe('');
  });
});

describe('createAnchor / resolveAnchor', () => {
  const rect = { left: 100, top: 200, width: 400, height: 100 };
  const node = el(
    'div',
    { id: 'legend' },
    { rect, text: 'Pin area is proportional to papers' },
  );
  const doc = {
    querySelector: (selector) => (selector === '#legend' ? node : null),
    querySelectorAll: (selector) => (selector === '#legend' ? [node] : []),
  };

  it('クリック地点をセレクタ + 相対位置 + ページ座標で持つ', () => {
    const anchor = createAnchor(
      node,
      { clientX: 200, clientY: 280 },
      { doc, scrollX: 0, scrollY: 1000 },
    );
    expect(anchor.selector).toBe('#legend');
    expect(anchor.rx).toBeCloseTo(0.25);
    expect(anchor.ry).toBeCloseTo(0.8);
    expect(anchor.pageX).toBe(200);
    expect(anchor.pageY).toBe(1280);
    expect(anchor.elementText).toBe('Pin area is proportional to papers');
  });

  it('要素の幅が変わってもピンは同じ相対位置に付いてくる', () => {
    const anchor = createAnchor(
      node,
      { clientX: 200, clientY: 280 },
      { doc, scrollX: 0, scrollY: 0 },
    );

    // ウィンドウを広げて要素の矩形が変わった状況
    const wide = el(
      'div',
      { id: 'legend' },
      {
        rect: { left: 50, top: 100, width: 800, height: 60 },
      },
    );
    const wideDoc = {
      querySelector: (selector) => (selector === '#legend' ? wide : null),
    };

    const spot = resolveAnchor(anchor, {
      doc: wideDoc,
      scrollX: 0,
      scrollY: 0,
    });
    expect(spot.found).toBe(true);
    expect(spot.x).toBeCloseTo(50 + 800 * 0.25);
    expect(spot.y).toBeCloseTo(100 + 60 * 0.8);
    expect(spot.element).toBe(wide);
  });

  it('要素が見つからなければページ座標に落ち、found=false で分かるようにする', () => {
    const anchor = {
      selector: '#gone',
      rx: 0.5,
      ry: 0.5,
      pageX: 300,
      pageY: 1200,
    };
    const spot = resolveAnchor(anchor, {
      doc: { querySelector: () => null },
      scrollX: 0,
      scrollY: 400,
    });
    expect(spot).toEqual({ x: 300, y: 800, found: false, element: null });
  });

  it('壊れたセレクタでも例外を投げずに座標へ落ちる', () => {
    const spot = resolveAnchor(
      { selector: '###', rx: 0, ry: 0, pageX: 1, pageY: 2 },
      {
        doc: {
          querySelector: () => {
            throw new SyntaxError('bad selector');
          },
        },
        scrollX: 0,
        scrollY: 0,
      },
    );
    expect(spot.found).toBe(false);
    expect(spot.x).toBe(1);
  });

  it('幅も高さも 0 に潰れた要素は見つからなかった扱いにする', () => {
    const hidden = el(
      'div',
      { id: 'legend' },
      {
        rect: { left: 0, top: 0, width: 0, height: 0 },
      },
    );
    const spot = resolveAnchor(
      { selector: '#legend', rx: 0.5, ry: 0.5, pageX: 7, pageY: 9 },
      {
        doc: { querySelector: () => hidden },
        scrollX: 0,
        scrollY: 0,
      },
    );
    expect(spot.found).toBe(false);
    expect(spot).toMatchObject({ x: 7, y: 9 });
  });
});
