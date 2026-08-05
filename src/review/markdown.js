/**
 * コメントを Markdown に書き出す。
 *
 * 受け取り手は開発側なので、「どの画面のどの状態を見ていたか」を先頭にまとめ、
 * 各コメントには紐づいた要素のセレクタと要素テキストの冒頭を添える。
 * 位置の説明を文章で書かずに済ませるのがこの機能の目的なので、
 * 相対位置（要素の中で何 % の位置か）も落とさずに残す。
 */
import { countByTag, TAGS } from './store.js';

/** 見出しに使う本文の最大長 */
const HEADLINE_LENGTH = 72;

/** 状態のうち書き出す項目。`state` のキーと表示ラベルの対応 */
const DISPLAY_FIELDS = [
  ['ORCID iD', 'orcid'],
  ['researchmap', 'rm'],
  ['Projection', 'proj'],
  ['Extent', 'scope'],
  ['Grouping', 'grain'],
  ['Pin size', 'size'],
  ['Center longitude', 'center'],
  ['Theme setting', 'theme'],
  ['Theme in use', 'themeApplied'],
  ['Merge co-author records', 'merge'],
];

function formatValue(value) {
  if (value === true) return 'on';
  if (value === false) return 'off';
  return String(value);
}

function pct(value) {
  const n = Number(value);
  return Math.round((Number.isFinite(n) ? n : 0.5) * 100);
}

/** 見出し用に本文の 1 行目を切り出す */
export function headline(body) {
  const first = String(body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!first) return '(no text)';
  return first.length > HEADLINE_LENGTH
    ? `${first.slice(0, HEADLINE_LENGTH)}…`
    : first;
}

/** `- Comments: 3 (bug 1, design 2)` の括弧の中 */
function tagSummary(comments) {
  const counts = countByTag(comments);
  const parts = TAGS.filter((tag) => counts[tag] > 0).map(
    (tag) => `${tag} ${counts[tag]}`,
  );
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/**
 * @param {Object} payload
 * @param {string} [payload.page]
 * @param {string} [payload.url]                クエリを含む完全な URL
 * @param {{width: number, height: number}} [payload.viewport]
 * @param {Object} [payload.display]            テーマ・投影法・スコープなどの表示状態
 * @param {Object[]} [payload.comments]         `anchored === false` の行は未解決として書く
 * @param {string} [payload.exportedAt]
 * @returns {string}
 */
export function toMarkdown(payload = {}) {
  const {
    page = 'index',
    url = '',
    viewport = {},
    display = {},
    comments = [],
    exportedAt = new Date().toISOString(),
  } = payload;

  const lines = [`# Co-author map review — ${page}`, ''];
  lines.push(`- Page: ${page}`);
  if (url) lines.push(`- URL: ${url}`);
  lines.push(
    `- Viewport: ${Math.round(Number(viewport.width) || 0)} x ${Math.round(
      Number(viewport.height) || 0,
    )} px`,
  );
  if (display.from != null && display.to != null)
    lines.push(`- Years: ${display.from}–${display.to}`);
  for (const [label, key] of DISPLAY_FIELDS) {
    const value = display[key];
    if (value === undefined || value === null || value === '') continue;
    lines.push(`- ${label}: ${formatValue(value)}`);
  }
  lines.push(`- Exported: ${exportedAt}`);
  lines.push(`- Comments: ${comments.length}${tagSummary(comments)}`);
  lines.push('');

  if (!comments.length) {
    lines.push('_No comments yet._', '');
    return lines.join('\n');
  }

  comments.forEach((comment, index) => {
    lines.push('---', '');
    lines.push(
      `## ${index + 1}. [${comment.tag}] ${headline(comment.body)}`,
      '',
    );
    const body = String(comment.body ?? '').trim();
    if (body) lines.push(body, '');
    if (comment.anchored === false) {
      lines.push(
        `- Element: not found on this page${
          comment.selector ? ` (was \`${comment.selector}\`)` : ''
        }`,
      );
      lines.push(
        `- Page coordinates: ${Math.round(Number(comment.pageX) || 0)}, ${Math.round(
          Number(comment.pageY) || 0,
        )}`,
      );
    } else {
      lines.push(`- Element: \`${comment.selector}\``);
      if (comment.elementText)
        lines.push(`- Element text: "${comment.elementText}"`);
      lines.push(
        `- Position in element: ${pct(comment.rx)}% across, ${pct(comment.ry)}% down`,
      );
    }
    lines.push('');
  });

  return lines.join('\n');
}
