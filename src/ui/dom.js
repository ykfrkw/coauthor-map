/**
 * 素の DOM を組み立てるための最小ヘルパ。
 * テンプレート文字列で HTML を書くと必ずエスケープ漏れが出るので、
 * UI は原則この h() で組む（ツールチップだけは例外で文字列組み立て）。
 *
 * `html` キー（innerHTML への代入）は**意図的に持たない**。
 * OpenAlex 由来の機関名・共著者名がここを通った瞬間に XSS になるので、
 * 経路ごと塞いである。生の HTML が要るなら、その場で innerHTML を書いて
 * レビューの目に触れさせること。`html` を渡しても無害な属性として付くだけ。
 */

/**
 * @param {string} tag
 * @param {Object} [attrs]  class / text / on* / data-* / その他は属性
 * @param {Array<Node|string|null|undefined>} [children]
 */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'style') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
  return el;
}

/** 子を総入れ替えする */
export function replaceChildren(el, ...children) {
  el.replaceChildren(...children.flat().filter(Boolean));
}

/** <select> を作る */
export function selectEl({ id, value, options, onChange, ariaLabel }) {
  const sel = h('select', { id, 'aria-label': ariaLabel });
  for (const opt of options) {
    sel.append(
      h('option', { value: opt.value, selected: opt.value === value }, [
        opt.label,
      ]),
    );
  }
  sel.value = String(value);
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

/** クリップボードへ。execCommand フォールバック付き（file:// や古い環境向け） */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 下のフォールバックに落ちる */
  }
  try {
    const ta = h('textarea', {
      style: { opacity: '0', height: '1px', width: '1px' },
    });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Blob をダウンロードさせる */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
