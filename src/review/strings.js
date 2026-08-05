/**
 * レビューモードの UI 文言。**US 英語 1 言語だけ**（本体の src/ui/i18n.js と同じ規則）。
 *
 * 本体の STRINGS には混ぜない。レビュー用のコードは ?review=1 のときだけ
 * 読み込む別チャンクなので、文言もこちら側に置いて通常のバンドルを太らせない。
 */

const REVIEW_STRINGS = {
  'rev.title': 'Review mode',
  'rev.count': '{n} comments',
  'rev.empty': 'No comments yet. Click anywhere on the page to add one.',

  'rev.armed': 'Click to comment',
  'rev.paused': 'Map controls active',
  'rev.armedHint': 'Clicks add a comment. Press Escape to use the map.',
  'rev.pausedHint': 'The map works as usual. Press Escape to comment again.',
  'rev.toggle': 'Toggle with Escape',

  'rev.copyMarkdown': 'Copy as Markdown',
  'rev.exportJson': 'Export JSON',
  'rev.importJson': 'Import JSON',
  'rev.clearAll': 'Delete all',
  'rev.clearConfirm':
    'Delete every review comment on this page? This cannot be undone.',
  'rev.copied': 'Copied to the clipboard.',
  'rev.copyFailed': 'Could not copy. Use Export JSON instead.',
  'rev.saveFailed': 'This browser refused to store the comments.',
  'rev.importFailed': 'That file is not a review JSON.',
  'rev.imported': 'Imported {n} comments.',

  'rev.collapse': 'Hide the list',
  'rev.expand': 'Show the list',
  'rev.close': 'Close',
  'rev.save': 'Save',
  'rev.delete': 'Delete',
  'rev.edit': 'Edit',
  'rev.body': 'Comment',
  'rev.bodyPlaceholder': 'What should change here?',
  'rev.type': 'Type',
  'rev.tag.bug': 'Bug',
  'rev.tag.design': 'Design',
  'rev.tag.copy': 'Copy',
  'rev.tag.idea': 'Idea',

  'rev.unanchored': 'element not found',
  'rev.noText': '(no text)',
  'rev.pinAria': 'Review comment {n}: {body}',
  'rev.editorAria': 'Edit review comment {n}',
  'rev.rowAria': 'Go to review comment {n}',
};

/** 種別 → ラベルキー */
const TAG_LABEL_KEYS = {
  bug: 'rev.tag.bug',
  design: 'rev.tag.design',
  copy: 'rev.tag.copy',
  idea: 'rev.tag.idea',
};

/**
 * 文言の引き当てと {name} の差し込み。
 * 本体の createTranslator と同じ振る舞いだが、こちらは表を持ち替えない。
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
export function reviewText(key, params) {
  const raw = Object.prototype.hasOwnProperty.call(REVIEW_STRINGS, key)
    ? REVIEW_STRINGS[key]
    : key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match,
  );
}

/** @param {string} tag */
export function tagLabel(tag) {
  return reviewText(TAG_LABEL_KEYS[tag] ?? 'rev.tag.design');
}

export { REVIEW_STRINGS, TAG_LABEL_KEYS };
