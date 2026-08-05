/**
 * h() が innerHTML への経路を持たないことの確認。
 *
 * この repo には jsdom を入れていない（依存を増やさない方針）ので、
 * h() が実際に触る API だけを持つ最小の偽 DOM を立てて検証する。
 * innerHTML は setter を張って「代入されたら記録する」ようにしてあるので、
 * 誰かが `html` キーの分岐を復活させたらこのテストが落ちる。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { h } from '../src/ui/dom.js';

/** h() の `child instanceof Node` 判定を通すための土台 */
class FakeNode {}

/** h() が使う分だけの偽 Element */
function createElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    className: '',
    textContent: '',
    style: {},
    attributes: new Map(),
    listeners: [],
    children: [],
    innerHtmlWrites: [],
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    getAttribute(name) {
      return this.attributes.has(name) ? this.attributes.get(name) : null;
    },
    addEventListener(type, fn) {
      this.listeners.push([type, fn]);
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
  };
  Object.setPrototypeOf(el, FakeNode.prototype);
  // innerHTML への代入を検出する
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set(value) {
      el.innerHtmlWrites.push(value);
      html = value;
    },
  });
  return el;
}

let saved;

beforeEach(() => {
  saved = globalThis.document;
  globalThis.document = {
    createElement,
    createTextNode: (text) =>
      Object.setPrototypeOf(
        { nodeType: 3, textContent: String(text) },
        FakeNode.prototype,
      ),
  };
  globalThis.Node = FakeNode;
});

afterEach(() => {
  globalThis.document = saved;
});

describe('h()', () => {
  it('html キーは innerHTML に流れず、無害な属性として素通りする', () => {
    const el = h('div', { html: '<img src=x onerror=alert(1)>' });
    expect(el.innerHtmlWrites).toEqual([]);
    expect(el.innerHTML).toBe('');
    expect(el.getAttribute('html')).toBe('<img src=x onerror=alert(1)>');
  });

  it('text は textContent に入る（エスケープ経路はこちら）', () => {
    const el = h('p', { text: '<b>Keio & Co.</b>' });
    expect(el.textContent).toBe('<b>Keio & Co.</b>');
    expect(el.innerHtmlWrites).toEqual([]);
  });

  it('class / style / on* / 一般属性の扱いは変わっていない', () => {
    const seen = [];
    const el = h('button', {
      class: 'primary',
      style: { opacity: '0' },
      onclick: () => seen.push('click'),
      'aria-pressed': 'true',
      disabled: true,
      hidden: false,
      missing: null,
    });
    expect(el.className).toBe('primary');
    expect(el.style.opacity).toBe('0');
    expect(el.listeners.map(([type]) => type)).toEqual(['click']);
    expect(el.getAttribute('aria-pressed')).toBe('true');
    expect(el.getAttribute('disabled')).toBe('');
    expect(el.getAttribute('hidden')).toBeNull();
    expect(el.getAttribute('missing')).toBeNull();
    expect(el.innerHtmlWrites).toEqual([]);
  });

  it('子は append で足され、文字列はテキストノードになる', () => {
    const child = h('span', { text: 'x' });
    const el = h('div', {}, [child, 'plain', null, false]);
    expect(el.children).toHaveLength(2);
    expect(el.children[0]).toBe(child);
    expect(el.children[1].textContent).toBe('plain');
    expect(el.innerHtmlWrites).toEqual([]);
  });
});
