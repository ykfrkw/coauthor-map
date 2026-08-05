/**
 * レビューモードの本体。**このファイルは ?review=1 のときだけ読み込まれる**
 * （src/review/gate.js が動的 import する。静的に import してはいけない）。
 *
 * やること:
 *  - 画面のどこでもクリックでコメントを 1 件落とす（クリック地点に連番のピン）
 *  - 位置は要素に紐づけて持つので、再描画・幅変更でもピンが追従する（anchor.js）
 *  - 一覧パネルで編集・削除・移動
 *  - Markdown / JSON で書き出し、JSON で取り込み
 *
 * 地図の操作は Esc で戻せる。レビューモード中の抑止は capture 段階で
 * stopPropagation するだけなので、モードを切れば d3-zoom の挙動は元どおり。
 */
import './review.css';
import { h, replaceChildren, copyText, downloadBlob } from '../ui/dom.js';
import { createAnchor, resolveAnchor } from './anchor.js';
import {
  TAGS,
  clearComments,
  createComment,
  exportJson,
  importJson,
  loadComments,
  normalizePage,
  saveComments,
} from './store.js';
import { reviewText as rt, tagLabel } from './strings.js';
import { toMarkdown } from './markdown.js';
import { withReviewParam } from './gate.js';

/** 一覧の 1 行に出す本文の長さ */
const ROW_BODY_LENGTH = 60;

/** ポップオーバーを画面の縁から離す余白 */
const EDGE = 8;

function firstLine(body) {
  const text = String(body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!text) return rt('rev.noText');
  return text.length > ROW_BODY_LENGTH
    ? `${text.slice(0, ROW_BODY_LENGTH)}…`
    : text;
}

/**
 * レビューモードを起動する。
 *
 * @param {Object} [options]
 * @param {'index'|'widget'} [options.page]  localStorage のキーを分ける単位
 * @param {() => Object} [options.getState]  書き出しに載せる表示状態
 * @returns {{destroy: () => void, get comments: Object[], toMarkdown: () => string}}
 */
export function startReviewMode({
  page = 'index',
  getState = () => ({}),
} = {}) {
  const pageKey = normalizePage(page);
  const doc = document;

  let comments = loadComments(pageKey);
  let armed = true;
  let collapsed = false;
  let editingId = null;
  let activeId = null;

  /** id -> ピンの button */
  const pinNodes = new Map();

  // ---- 浮遊層 ----
  const root = h('div', { class: 'review-layer', 'data-review-root': '' });
  const pinsWrap = h('div', { class: 'review-pins' });

  // ---- 一覧パネル ----
  const countEl = h('span', { class: 'review-hint' });
  const hintEl = h('p', { class: 'review-hint' });
  const statusEl = h('p', {
    class: 'review-status',
    role: 'status',
    'aria-live': 'polite',
  });
  const listEl = h('ol', { class: 'review-list' });

  const armToggle = h('button', {
    type: 'button',
    'aria-pressed': 'true',
    onclick: () => setArmed(!armed),
  });

  const collapseButton = h('button', {
    type: 'button',
    text: rt('rev.collapse'),
    onclick: () => {
      collapsed = !collapsed;
      panel.setAttribute('data-collapsed', String(collapsed));
      collapseButton.textContent = collapsed
        ? rt('rev.expand')
        : rt('rev.collapse');
    },
  });

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: { display: 'none' },
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const imported = importJson(await file.text());
      comments = imported;
      persist();
      render();
      statusEl.textContent = rt('rev.imported', { n: imported.length });
    } catch {
      statusEl.textContent = rt('rev.importFailed');
    }
    fileInput.value = '';
  });

  const panelBody = h('div', { class: 'review-panel-body' }, [
    h('div', { class: 'review-state' }, [
      h('div', { class: 'review-buttons' }, [armToggle]),
      hintEl,
    ]),
    h('div', { class: 'review-buttons' }, [
      h('button', {
        type: 'button',
        text: rt('rev.copyMarkdown'),
        onclick: copyMarkdown,
      }),
      h('button', {
        type: 'button',
        text: rt('rev.exportJson'),
        onclick: downloadJson,
      }),
      h('button', {
        type: 'button',
        text: rt('rev.importJson'),
        onclick: () => fileInput.click(),
      }),
      h('button', {
        type: 'button',
        text: rt('rev.clearAll'),
        onclick: clearAll,
      }),
    ]),
    statusEl,
    listEl,
    fileInput,
  ]);

  const panel = h(
    'section',
    {
      class: 'review-panel',
      'data-collapsed': 'false',
      'aria-label': rt('rev.title'),
    },
    [
      h('div', { class: 'review-panel-head' }, [
        h('h2', { class: 'review-panel-title', text: rt('rev.title') }),
        countEl,
        collapseButton,
      ]),
      panelBody,
    ],
  );

  // ---- 編集ポップオーバー ----
  const editorBody = h('textarea', {
    rows: '4',
    placeholder: rt('rev.bodyPlaceholder'),
    'aria-label': rt('rev.body'),
  });
  const editorTag = h(
    'select',
    { 'aria-label': rt('rev.type') },
    TAGS.map((tag) => h('option', { value: tag }, [tagLabel(tag)])),
  );
  const editorTarget = h('p', { class: 'review-editor-target' });

  const editor = h('div', { class: 'review-editor', role: 'dialog' }, [
    h('label', { text: rt('rev.type') }),
    editorTag,
    h('label', { text: rt('rev.body') }),
    editorBody,
    editorTarget,
    h('div', { class: 'review-buttons' }, [
      h('button', {
        type: 'button',
        text: rt('rev.save'),
        onclick: saveEditor,
      }),
      h('button', {
        type: 'button',
        text: rt('rev.delete'),
        onclick: () => editingId && removeComment(editingId),
      }),
      h('button', {
        type: 'button',
        text: rt('rev.close'),
        onclick: closeEditor,
      }),
    ]),
  ]);
  editor.hidden = true;

  root.append(pinsWrap, panel, editor);
  doc.body.append(root);

  // ---- 保存 ----
  function persist() {
    if (!saveComments(pageKey, comments)) {
      statusEl.textContent = rt('rev.saveFailed');
    }
  }

  // ---- 描画 ----
  function render() {
    pinNodes.clear();
    replaceChildren(
      pinsWrap,
      ...comments.map((comment, index) => {
        const node = h('button', {
          type: 'button',
          class: 'review-pin',
          'data-review-id': comment.id,
          'aria-label': rt('rev.pinAria', {
            n: index + 1,
            body: firstLine(comment.body),
          }),
          text: String(index + 1),
          onclick: () => openEditor(comment.id),
        });
        pinNodes.set(comment.id, node);
        return node;
      }),
    );

    replaceChildren(
      listEl,
      ...(comments.length
        ? comments.map((comment, index) =>
            h('li', {}, [
              h(
                'button',
                {
                  type: 'button',
                  class: 'review-row',
                  'aria-label': rt('rev.rowAria', { n: index + 1 }),
                  onclick: () => focusComment(comment.id),
                },
                [
                  h('span', { class: 'review-row-n', text: String(index + 1) }),
                  h('span', { class: 'review-row-text' }, [
                    h('span', {
                      class: 'review-row-body',
                      text: `[${comment.tag}] ${firstLine(comment.body)}`,
                    }),
                    h('span', {
                      class: 'review-row-meta',
                      text: comment.selector || rt('rev.unanchored'),
                    }),
                  ]),
                ],
              ),
            ]),
          )
        : [
            h('li', {}, [
              h('p', { class: 'review-hint', text: rt('rev.empty') }),
            ]),
          ]),
    );

    countEl.textContent = rt('rev.count', { n: comments.length });
    positionPins();
  }

  function positionPins() {
    for (const comment of comments) {
      const node = pinNodes.get(comment.id);
      if (!node) continue;
      const spot = resolveAnchor(comment, { doc });
      node.style.left = `${Math.round(spot.x)}px`;
      node.style.top = `${Math.round(spot.y)}px`;
      node.classList.toggle('review-pin--orphan', !spot.found);
      node.classList.toggle('review-pin--active', comment.id === activeId);
      node.title = spot.found
        ? comment.selector
        : `${comment.selector} — ${rt('rev.unanchored')}`;
    }
  }

  // ---- コメントの出し入れ ----
  function addCommentAt(target, clientX, clientY) {
    const anchor = createAnchor(target, { clientX, clientY }, { doc });
    const comment = createComment({ anchor });
    comments = [...comments, comment];
    activeId = comment.id;
    persist();
    render();
    openEditor(comment.id);
  }

  function removeComment(id) {
    comments = comments.filter((comment) => comment.id !== id);
    if (activeId === id) activeId = null;
    closeEditor();
    persist();
    render();
  }

  function clearAll() {
    if (!comments.length) return;
    if (!globalThis.confirm?.(rt('rev.clearConfirm'))) return;
    comments = [];
    activeId = null;
    closeEditor();
    clearComments(pageKey);
    render();
  }

  function focusComment(id) {
    const comment = comments.find((c) => c.id === id);
    if (!comment) return;
    activeId = id;
    const spot = resolveAnchor(comment, { doc });
    spot.element?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    schedulePosition();
    openEditor(id);
  }

  // ---- 編集ポップオーバー ----
  function openEditor(id) {
    const index = comments.findIndex((comment) => comment.id === id);
    if (index < 0) return;
    const comment = comments[index];
    editingId = id;
    activeId = id;
    editorBody.value = comment.body;
    editorTag.value = comment.tag;
    editorTarget.textContent = comment.selector || rt('rev.unanchored');
    editor.setAttribute('aria-label', rt('rev.editorAria', { n: index + 1 }));
    editor.hidden = false;
    placeEditor(resolveAnchor(comment, { doc }));
    positionPins();
    editorBody.focus?.();
  }

  function placeEditor(spot) {
    const rect = editor.getBoundingClientRect();
    const maxLeft = Math.max(EDGE, globalThis.innerWidth - rect.width - EDGE);
    const maxTop = Math.max(EDGE, globalThis.innerHeight - rect.height - EDGE);
    editor.style.left = `${Math.min(Math.max(EDGE, spot.x + 16), maxLeft)}px`;
    editor.style.top = `${Math.min(Math.max(EDGE, spot.y + 16), maxTop)}px`;
  }

  function saveEditor() {
    if (!editingId) return;
    comments = comments.map((comment) =>
      comment.id === editingId
        ? {
            ...comment,
            body: editorBody.value,
            tag: TAGS.includes(editorTag.value) ? editorTag.value : comment.tag,
            updatedAt: new Date().toISOString(),
          }
        : comment,
    );
    persist();
    render();
    closeEditor();
  }

  function closeEditor() {
    editingId = null;
    editor.hidden = true;
  }

  // ---- 書き出し ----
  function buildMarkdown() {
    const state = getState?.() ?? {};
    return toMarkdown({
      page: pageKey,
      url: globalThis.location?.href ?? '',
      viewport: {
        width: globalThis.innerWidth ?? 0,
        height: globalThis.innerHeight ?? 0,
      },
      display: {
        orcid: state.orcid,
        rm: state.rm,
        from: state.from,
        to: state.to,
        proj: state.proj,
        scope: state.scope,
        grain: state.grain,
        size: state.size,
        center: state.center,
        theme: state.theme,
        themeApplied: doc.documentElement.dataset.theme ?? '',
        merge: state.merge,
      },
      comments: comments.map((comment) => ({
        ...comment,
        anchored: resolveAnchor(comment, { doc }).found,
      })),
    });
  }

  async function copyMarkdown() {
    const ok = await copyText(buildMarkdown());
    statusEl.textContent = ok ? rt('rev.copied') : rt('rev.copyFailed');
  }

  function downloadJson() {
    downloadBlob(
      new Blob([exportJson(pageKey, comments)], { type: 'application/json' }),
      `coauthor-map-review-${pageKey}.json`,
    );
  }

  // ---- 入力の横取り ----
  function outside(target) {
    return Boolean(target?.nodeType) && !root.contains(target);
  }

  /** armed のあいだ、地図やリンクへイベントを届かせない */
  function swallow(event) {
    if (!armed || !outside(event.target)) return;
    event.stopPropagation();
  }

  function onClick(event) {
    if (!armed || !outside(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.button && event.button !== 0) return;
    addCommentAt(event.target, event.clientX, event.clientY);
  }

  function onKeydown(event) {
    if (event.key !== 'Escape') return;
    if (!editor.hidden) {
      closeEditor();
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    setArmed(!armed);
    event.stopPropagation();
    event.preventDefault();
  }

  function setArmed(next) {
    armed = Boolean(next);
    doc.documentElement.classList.toggle('review-armed', armed);
    armToggle.setAttribute('aria-pressed', String(armed));
    armToggle.textContent = armed ? rt('rev.armed') : rt('rev.paused');
    hintEl.textContent = armed ? rt('rev.armedHint') : rt('rev.pausedHint');
  }

  // ---- アドレスバーから review= が落ちないようにする ----
  // 本体の syncUrl は表示状態しか書かないので、放っておくと最初の描画で
  // review= が消え、リロードでレビューモードが黙って切れる。
  // レビューモードのあいだだけ replaceState をくるんで書き戻す（destroy で元に戻す）。
  const history = globalThis.history;
  const originalReplaceState = history?.replaceState;
  if (typeof originalReplaceState === 'function') {
    history.replaceState = function replaceStateWithReview(state, title, url) {
      return originalReplaceState.call(
        this,
        state,
        title,
        withReviewParam(url, globalThis.location.href),
      );
    };
    history.replaceState(null, '', globalThis.location.href);
  }

  doc.addEventListener('pointerdown', swallow, true);
  doc.addEventListener('mousedown', swallow, true);
  doc.addEventListener('dblclick', swallow, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKeydown, true);

  // ---- 追従 ----
  let rafId = 0;
  function schedulePosition() {
    if (rafId) return;
    rafId = globalThis.requestAnimationFrame?.(() => {
      rafId = 0;
      positionPins();
    });
    if (!rafId) positionPins();
  }

  globalThis.addEventListener('scroll', schedulePosition, {
    passive: true,
    capture: true,
  });
  globalThis.addEventListener('resize', schedulePosition);

  const resizeObserver = globalThis.ResizeObserver
    ? new globalThis.ResizeObserver(schedulePosition)
    : null;
  resizeObserver?.observe(doc.documentElement);

  // 地図の描き直しで対象要素の矩形が変わるので、本体側の DOM 変化も拾う
  const mutationObserver = globalThis.MutationObserver
    ? new globalThis.MutationObserver((records) => {
        for (const record of records) {
          if (outside(record.target)) {
            schedulePosition();
            return;
          }
        }
      })
    : null;
  mutationObserver?.observe(doc.body, { childList: true, subtree: true });

  function destroy() {
    doc.removeEventListener('pointerdown', swallow, true);
    doc.removeEventListener('mousedown', swallow, true);
    doc.removeEventListener('dblclick', swallow, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKeydown, true);
    globalThis.removeEventListener('scroll', schedulePosition, {
      capture: true,
    });
    globalThis.removeEventListener('resize', schedulePosition);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    if (typeof originalReplaceState === 'function')
      history.replaceState = originalReplaceState;
    doc.documentElement.classList.remove('review-armed');
    root.remove();
    if (globalThis.__coauthorMapReview === api)
      delete globalThis.__coauthorMapReview;
  }

  setArmed(true);
  render();

  const api = {
    destroy,
    toMarkdown: buildMarkdown,
    get comments() {
      return comments;
    },
  };

  // コンソールから触れるようにしておく（このチャンクは ?review=1 でしか
  // 読み込まれないので、通常の訪問者には window に何も生えない）
  globalThis.__coauthorMapReview = api;

  return api;
}

export default startReviewMode;
