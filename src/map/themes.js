/**
 * テーマ。
 *
 * 色そのものは src/css/tokens.css の :root[data-theme='...'] にある。
 * ここが持つのは「どのテーマがあるか」と「どれを当てるか」だけで、
 * 値は一切持たない（値の出どころを CSS に一本化する）。
 *
 * prefers-color-scheme は "auto" のときの初期選択にだけ使う。
 * 明示選択（URL の theme= / セレクト操作）は常にそれより優先される。
 */

export const THEMES = [
  { id: 'minimal', labelKey: 'theme.minimal' },
  { id: 'dark', labelKey: 'theme.dark' },
  { id: 'blueprint', labelKey: 'theme.blueprint' },
  { id: 'paper', labelKey: 'theme.paper' },
];

export const THEME_AUTO = 'auto';
export const DEFAULT_THEME = THEME_AUTO;

const IDS = new Set(THEMES.map((t) => t.id));

/** 'auto' を含めて妥当な値かどうか */
export function isValidTheme(id) {
  return id === THEME_AUTO || IDS.has(id);
}

/** OS の設定から auto の実体を決める */
export function resolveTheme(id) {
  if (id !== THEME_AUTO && IDS.has(id)) return id;
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'minimal';
}

/**
 * <html data-theme> を張り替える。CSS 側が全部拾う。
 * @returns {string} 実際に当たったテーマ id
 */
export function applyTheme(id, root = document.documentElement) {
  const resolved = resolveTheme(id);
  root.dataset.theme = resolved;
  return resolved;
}

/**
 * auto のあいだだけ OS 設定の変化に追従する。
 * @returns {() => void} 監視を止める関数
 */
export function watchSystemTheme(onChange) {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return () => {};
  }
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => onChange();
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

/**
 * 書き出し用に、現在当たっているトークンの実値を読む。
 * PNG / SVG に色を焼き込むときだけ使う。
 */
export function readThemeVars(names, root = document.documentElement) {
  const style = getComputedStyle(root);
  const out = {};
  for (const name of names) out[name] = style.getPropertyValue(name).trim();
  return out;
}
