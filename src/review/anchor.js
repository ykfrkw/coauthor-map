/**
 * レビュー用コメントの「位置」。
 *
 * ページ座標で持つと、地図の再描画やウィンドウ幅の変更でピンが行方不明になる。
 * そこでクリック地点の直下にある要素を捕まえ、
 *   - その要素を指す安定したセレクタ
 *   - その要素の矩形に対する相対位置（0〜1 の割合）
 * の 2 つで持つ。復元はセレクタから要素を引き直し、相対位置で置き直す。
 * 要素が消えていたら書き留めておいたページ座標に落とし、その旨を呼び出し側に返す。
 *
 * DOM API は `getAttributeNames` / `getBoundingClientRect` / `querySelectorAll` の
 * 3 つしか触らない。テストは最小の偽 DOM でこの 3 つだけ生やせば足りる。
 */

/** セレクタに焼き込む価値のある data-* 属性。上から順に採る */
const DATA_ATTR_PRIORITY = [
  'data-i18n',
  'data-i18n-title',
  'data-mode',
  'data-theme',
  'data-review-id',
  'data-key',
  'data-id',
  'data-name',
  'data-tab',
];

/** 長すぎる属性値はセレクタを読めなくするだけなので使わない */
const MAX_DATA_VALUE = 48;

/** 状態クラス・自動生成っぽいクラスは次の描画で変わるので避ける */
const UNSTABLE_CLASS = /^(?:is|has|js)-|^_|\d{3,}$/;

/** `#id` の形で書ける識別子か */
const SAFE_IDENT = /^[A-Za-z_][\w-]*$/;

/** 何段まで祖先をたどるか */
const MAX_DEPTH = 6;

/** 要素テキストの冒頭を何文字残すか */
const LABEL_LENGTH = 72;

/** 属性値を `"..."` で囲む。バックスラッシュと二重引用符だけ逃がす */
export function quoteAttrValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** id を指すセレクタ。奇妙な id は属性セレクタに逃がす */
export function idSelector(id) {
  const value = String(id ?? '');
  if (!value) return '';
  return SAFE_IDENT.test(value) ? `#${value}` : `[id=${quoteAttrValue(value)}]`;
}

/** 属性名の一覧。偽 DOM でも getAttributeNames さえあれば動く */
function attributeNames(el) {
  if (typeof el?.getAttributeNames === 'function')
    return el.getAttributeNames();
  return [];
}

function attr(el, name) {
  return typeof el?.getAttribute === 'function' ? el.getAttribute(name) : null;
}

/** クラス名の配列。classList でも className 文字列でも受ける */
export function classNames(el) {
  if (el?.classList && typeof el.classList.length === 'number') {
    return Array.from(el.classList, String);
  }
  const raw = typeof el?.className === 'string' ? el.className : '';
  return raw.split(/\s+/).filter(Boolean);
}

/** 次の描画でも残っていそうなクラスだけ、先頭 2 つまで */
export function stableClasses(el) {
  return classNames(el)
    .filter((name) => !UNSTABLE_CLASS.test(name) && SAFE_IDENT.test(name))
    .slice(0, 2);
}

/** data-* から 1 つだけ選んでセレクタ片にする */
export function dataAttrSelector(el) {
  const names = attributeNames(el);
  const ordered = [
    ...DATA_ATTR_PRIORITY.filter((name) => names.includes(name)),
    ...names.filter(
      (name) => name.startsWith('data-') && !DATA_ATTR_PRIORITY.includes(name),
    ),
  ];
  for (const name of ordered) {
    const value = attr(el, name);
    if (value == null || value === '' || value.length > MAX_DATA_VALUE)
      continue;
    return `[${name}=${quoteAttrValue(value)}]`;
  }
  return '';
}

function tagName(el) {
  return String(el?.tagName ?? 'div').toLowerCase();
}

/** 同じタグの兄弟のうち何番目か（1 始まり）。CSS の :nth-of-type と同じ数え方 */
export function nthOfType(el) {
  const siblings = el?.parentElement?.children;
  if (!siblings) return 1;
  let n = 0;
  for (const sibling of Array.from(siblings)) {
    if (tagName(sibling) !== tagName(el)) continue;
    n += 1;
    if (sibling === el) return n;
  }
  return 1;
}

/**
 * 要素 1 つぶんのセレクタ片。
 * @param {Object} el
 * @param {{ useNth?: boolean }} [options]
 */
export function elementSegment(el, { useNth = false } = {}) {
  const id = attr(el, 'id');
  if (id) return idSelector(id);
  let segment = tagName(el) + dataAttrSelector(el);
  for (const name of stableClasses(el)) segment += `.${name}`;
  if (useNth) segment += `:nth-of-type(${nthOfType(el)})`;
  return segment;
}

/** 既定の一意性判定。壊れたセレクタは「一意ではない」として扱う */
function defaultIsUnique(selector, doc) {
  try {
    return doc.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

/**
 * 要素を指す、なるべく短くて一意なセレクタを組む。
 *
 * 1. id が一意ならそれだけで終わり
 * 2. 自分のセレクタ片が一意ならそれ
 * 3. 一意になるまで祖先を左に足す
 * 4. それでも駄目なら葉に :nth-of-type を足す
 * 5. 最後は諦めてそこまでの形を返す（見つからなければ座標に落ちる）
 *
 * @param {Object} el
 * @param {{ doc?: Object, isUnique?: (selector: string, doc: Object) => boolean, maxDepth?: number }} [options]
 * @returns {string}
 */
export function buildSelector(el, options = {}) {
  const {
    doc = globalThis.document,
    isUnique = defaultIsUnique,
    maxDepth = MAX_DEPTH,
  } = options;
  if (!el) return '';
  const unique = (selector) => Boolean(selector) && isUnique(selector, doc);

  const ownId = attr(el, 'id');
  if (ownId && unique(idSelector(ownId))) return idSelector(ownId);

  const parts = [elementSegment(el)];
  if (unique(parts.join(' > '))) return parts.join(' > ');

  let node = el.parentElement;
  for (let depth = 0; node && depth < maxDepth; depth += 1) {
    const id = attr(node, 'id');
    parts.unshift(elementSegment(node));
    const selector = parts.join(' > ');
    if (unique(selector)) return selector;
    // 祖先に id があれば、そこから上は足しても意味がない
    if (id && unique(idSelector(id))) break;
    node = node.parentElement;
  }

  // 葉を :nth-of-type で絞る最後の一手
  const withNth = [...parts];
  withNth[withNth.length - 1] = elementSegment(el, { useNth: true });
  if (unique(withNth.join(' > '))) return withNth.join(' > ');

  return parts.join(' > ');
}

/** 何を指しているか分かるように、要素テキストの冒頭を控えておく */
export function elementLabel(el) {
  const raw = String(el?.textContent ?? '').slice(0, LABEL_LENGTH * 4);
  const text = raw.replace(/\s+/g, ' ').trim();
  return text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH)}…` : text;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * ビューポート座標を、要素の矩形に対する割合に直す。
 * @param {{left: number, top: number, width: number, height: number}} rect
 * @param {number} x  clientX
 * @param {number} y  clientY
 * @returns {{rx: number, ry: number}}
 */
export function relativePoint(rect, x, y) {
  const width = Number(rect?.width) || 0;
  const height = Number(rect?.height) || 0;
  return {
    rx: width > 0 ? clamp01((x - rect.left) / width) : 0.5,
    ry: height > 0 ? clamp01((y - rect.top) / height) : 0.5,
  };
}

/**
 * 割合をビューポート座標に戻す。
 * @param {{left: number, top: number, width: number, height: number}} rect
 * @param {number} rx
 * @param {number} ry
 * @returns {{x: number, y: number}}
 */
export function pointInRect(rect, rx, ry) {
  return {
    x: rect.left + (Number(rect.width) || 0) * clamp01(rx),
    y: rect.top + (Number(rect.height) || 0) * clamp01(ry),
  };
}

/**
 * クリック地点からアンカーを作る。
 *
 * @param {Object} el  クリック地点の直下にあった要素
 * @param {Object} point
 * @param {number} point.clientX
 * @param {number} point.clientY
 * @param {Object} [options]  buildSelector に渡す。scrollX / scrollY も差し替えられる
 * @returns {{selector: string, elementText: string, rx: number, ry: number, pageX: number, pageY: number}}
 */
export function createAnchor(el, { clientX, clientY }, options = {}) {
  const {
    scrollX = globalThis.scrollX ?? 0,
    scrollY = globalThis.scrollY ?? 0,
    ...selectorOptions
  } = options;
  const rect =
    typeof el?.getBoundingClientRect === 'function'
      ? el.getBoundingClientRect()
      : { left: clientX, top: clientY, width: 0, height: 0 };
  const { rx, ry } = relativePoint(rect, clientX, clientY);
  return {
    selector: buildSelector(el, selectorOptions),
    elementText: elementLabel(el),
    rx,
    ry,
    pageX: clientX + scrollX,
    pageY: clientY + scrollY,
  };
}

/**
 * アンカーをビューポート座標に戻す。
 *
 * @param {{selector: string, rx: number, ry: number, pageX: number, pageY: number}} anchor
 * @param {{doc?: Object, scrollX?: number, scrollY?: number}} [options]
 * @returns {{x: number, y: number, found: boolean, element: Object|null}}
 */
export function resolveAnchor(anchor, options = {}) {
  const {
    doc = globalThis.document,
    scrollX = globalThis.scrollX ?? 0,
    scrollY = globalThis.scrollY ?? 0,
  } = options;
  const fallback = {
    x: (Number(anchor?.pageX) || 0) - scrollX,
    y: (Number(anchor?.pageY) || 0) - scrollY,
    found: false,
    element: null,
  };
  if (!anchor?.selector || !doc?.querySelector) return fallback;

  let el = null;
  try {
    el = doc.querySelector(anchor.selector);
  } catch {
    return fallback;
  }
  if (!el || typeof el.getBoundingClientRect !== 'function') return fallback;

  const rect = el.getBoundingClientRect();
  // 折りたたまれて幅も高さも 0 の要素は「見つからなかった」と同じ扱いにする
  if (!(Number(rect.width) > 0) && !(Number(rect.height) > 0)) return fallback;

  const { x, y } = pointInRect(rect, anchor.rx, anchor.ry);
  return { x, y, found: true, element: el };
}
