/**
 * 書き出し（SVG / PNG）。
 *
 * 表示中の SVG はスタイルを外部 CSS（カスタムプロパティ）に頼っているので、
 * そのまま直列化すると色が全部落ちる。複製に computed style を焼き込んでから出す。
 *
 * 隅にクレジットを焼き込む。SVG 側に入れるので PNG にもそのまま乗る。
 */
import { h, downloadBlob } from './dom.js';

export const CREDIT_TEXT = 'coauthor-map · yukifurukawa.jp';
export const CREDIT_URL = 'https://yukifurukawa.jp/coauthor-map/';

/** 焼き込む必要のあるプレゼンテーション属性 */
const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linejoin',
  'stroke-linecap',
  'opacity',
  'paint-order',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'filter',
  'display',
  'visibility',
];

/**
 * 表示中の SVG を、単体で開いても同じ見た目になる文字列に直す。
 *
 * @param {SVGSVGElement} svgNode
 * @param {Object} opts
 * @param {string} opts.background   背景色（--bg の実値）
 * @param {string} opts.creditColor  クレジット文字の色
 * @param {string} [opts.title]      アクセシビリティ用の題
 */
export function serializeSvg(svgNode, { background, creditColor, title }) {
  const width =
    Number(svgNode.viewBox.baseVal.width) || svgNode.clientWidth || 960;
  const height =
    Number(svgNode.viewBox.baseVal.height) || svgNode.clientHeight || 540;

  const clone = svgNode.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`);

  // computed style を1対1で写す
  const originals = [svgNode, ...svgNode.querySelectorAll('*')];
  const clones = [clone, ...clone.querySelectorAll('*')];
  for (let i = 0; i < originals.length && i < clones.length; i += 1) {
    const computed = getComputedStyle(originals[i]);
    const decls = [];
    for (const prop of STYLE_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value && value !== 'none' && value !== 'normal')
        decls.push(`${prop}:${value}`);
      else if (prop === 'fill' && value === 'none') decls.push('fill:none');
    }
    if (decls.length) clones[i].setAttribute('style', decls.join(';'));
    // 対話用の属性は書き出し先で意味を持たない
    clones[i].removeAttribute('tabindex');
    clones[i].removeAttribute('role');
  }

  const ns = 'http://www.w3.org/2000/svg';

  // 背景（PNG の透過を避ける。テーマの地の色をそのまま敷く）
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', String(width));
  bg.setAttribute('height', String(height));
  bg.setAttribute('fill', background || '#ffffff');
  clone.insertBefore(bg, clone.firstChild);

  // クレジット（右下）
  const credit = document.createElementNS(ns, 'text');
  credit.setAttribute('x', String(width - 8));
  credit.setAttribute('y', String(height - 8));
  credit.setAttribute('text-anchor', 'end');
  credit.setAttribute(
    'style',
    `font-family:ui-sans-serif,system-ui,sans-serif;font-size:11px;fill:${
      creditColor || '#666666'
    };opacity:0.9`,
  );
  credit.textContent = CREDIT_TEXT;
  clone.append(credit);

  if (title) {
    const titleEl = document.createElementNS(ns, 'title');
    titleEl.textContent = title;
    clone.insertBefore(titleEl, clone.firstChild);
  }

  const xml = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

/** SVG 文字列を canvas 経由で PNG にする */
export async function svgToPngBlob(
  svgString,
  { width, height, scale = 2, background },
) {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new Error('Could not read the SVG as an image.'));
      image.src = url;
    });
    const canvas = h('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (out) =>
          out
            ? resolve(out)
            : reject(new Error('canvas.toBlob returned nothing.')),
        'image/png',
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 書き出しパネル。
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {(k: string, p?: Object) => string} opts.t
 * @param {() => SVGSVGElement} opts.getSvg
 * @param {() => string} opts.getFilenameBase
 * @param {() => string} opts.getTitle
 */
export function createExportPanel({
  container,
  t,
  getSvg,
  getFilenameBase,
  getTitle,
}) {
  const status = h('span', {
    class: 'hint',
    role: 'status',
    'aria-live': 'polite',
  });

  function themeColors() {
    const style = getComputedStyle(document.documentElement);
    return {
      background: style.getPropertyValue('--bg').trim() || '#ffffff',
      creditColor: style.getPropertyValue('--muted').trim() || '#666666',
    };
  }

  async function run(kind) {
    status.textContent = '';
    const svgNode = getSvg();
    if (!svgNode) return;
    try {
      const colors = themeColors();
      const svgString = serializeSvg(svgNode, {
        ...colors,
        title: getTitle?.(),
      });
      const base = getFilenameBase?.() || 'coauthor-map';
      if (kind === 'svg') {
        downloadBlob(
          new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }),
          `${base}.svg`,
        );
        return;
      }
      const width = Number(svgNode.viewBox.baseVal.width) || 960;
      const height = Number(svgNode.viewBox.baseVal.height) || 540;
      const png = await svgToPngBlob(svgString, {
        width,
        height,
        scale: 2,
        background: colors.background,
      });
      downloadBlob(png, `${base}@2x.png`);
    } catch {
      status.textContent = t('exp.failed');
    }
  }

  container.append(
    h('div', { class: 'button-row' }, [
      h('button', {
        type: 'button',
        text: t('exp.svg'),
        onclick: () => run('svg'),
      }),
      h('button', {
        type: 'button',
        text: t('exp.png'),
        onclick: () => run('png'),
      }),
      status,
    ]),
  );

  return { run };
}
