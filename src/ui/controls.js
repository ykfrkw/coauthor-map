/**
 * 操作パネルと URL 同期。
 *
 * 表示状態はすべて URL クエリに載せる。リロードで復元でき、そのまま共有もできる:
 *   ?orcid=&rm=&from=&to=&proj=&center=&grain=&theme=&size=&scope=&merge=
 *   &min=&xa=&xi=&xd=&pin=&orcidaff=&afftype=&labels=&legend=
 *
 * **手直し（除外）も URL に載せる。** localStorage にしか無いと埋め込みウィジェットに
 * 伝わらず、「画面で直した状態」と「配布した地図」が食い違う。
 * ID は接頭辞を落として短縮する（`xa=5030252459.5122799223`）。
 *
 * UI は US 英語 1 言語なので `lang` は持たない。
 *
 * 既定値と同じパラメータは書かない（URL を短く保つ）。
 * パラメータ無しで開いたときはオーナー自身の地図を出す。
 */
import { h, selectEl } from './dom.js';
import {
  PROJECTIONS,
  CENTER_PRESETS,
  DEFAULT_PROJECTION,
  getProjectionSpec,
  normalizeLongitude,
} from '../map/projections.js';
import {
  THEMES,
  THEME_AUTO,
  DEFAULT_THEME,
  isValidTheme,
} from '../map/themes.js';
import {
  GRAIN_MAX,
  GRAIN_COUNTRY,
  DEFAULT_GRAIN,
  parseGrain,
  grainToParam,
  grainToSlider,
  sliderToGrain,
} from '../map/cluster.js';
import { SCOPE_OPTIONS, DEFAULT_SCOPE, parseScope } from '../map/scope.js';
import {
  normalizeMergeMode,
  normalizePinMode,
  DEFAULT_PIN_MODE,
} from '../aggregate.js';

/** パラメータ無しで開いたときの既定 = オーナー自身の地図 */
export const DEFAULTS = Object.freeze({
  orcid: '0000-0003-1317-0220',
  rm: 'yk_frkw',
  from: null, // null = データの最小年
  to: null, // null = データの最大年
  proj: DEFAULT_PROJECTION,
  center: 140, // 日本中心。オーナーの地図が既定なので日本を真ん中に置く
  grain: DEFAULT_GRAIN,
  theme: DEFAULT_THEME,
  // 丸の大きさの基準。既定は共著者数。
  // 論文数を既定にしていたとき、少人数でも共著が多い都市（Bern 3名14論文）が
  // 大人数の都市（Munich 25名13論文）より大きく描かれ、人数と誤読された。
  // この地図の主役は人なので、既定は人数に合わせる。
  size: 'coauthors',
  scope: DEFAULT_SCOPE, // auto = 国 / 地域 / 全世界を共著者の分布から決める
  // OpenAlex の名寄せが分裂させた共著者レコードを統合するか。既定 ON
  merge: true,
  // 共著論文数の下限。1 = 全員。Main collaborations の絞り込み
  min: 1,
  // 1 人を主所属の 1 都市だけに置くか。既定 primary（`pin=all` で旧来の挙動）
  pin: DEFAULT_PIN_MODE,
  // ORCID の所属名を主所属の判定に使うか。既定 ON（`orcidaff=off` で切る）
  orcidaff: true,
  // 主所属に education / healthcare を優先するか。既定 ON（`afftype=off` で切る）
  // 切ると研究コンソーシアム本部（type=facility）が主所属に選ばれる旧来の判定に戻る
  afftype: true,
  // 地図に重なる都市名ラベルを出すか。既定 OFF（`labels=on` で出す）
  //
  // **既定を OFF にした根拠**: オーナーの指示。ラベルは丸に重なって地図を
  // 読みにくくする。どの都市かはツールチップと下の表で分かるので、常時表示は
  // 情報の重複でもある。出したい場合はチェックひとつで戻せる。
  labels: false,
  // 凡例（丸の大きさの目盛り）を出すか。
  // null = ページ既定に従う（index.html は出す / widget.html は出さない）。
  // `legend=on` / `legend=off` を書いたときだけ、そのページ既定を上書きする
  legend: null,
  // 手直し（除外）。URL に載せて埋め込み先まで運ぶ
  xa: [], // 除外した共著者の OpenAlex 著者 ID
  xi: [], // 除外した機関の OpenAlex 機関 ID
  xd: [], // 除外した DOI
});

/** OpenAlex の ID 接頭辞。URL では落として数字だけ載せる。 */
const OPENALEX_PREFIX = 'https://openalex.org/';

/** ID を並べる区切り。数字しか入らないので `.` で衝突しない。 */
const ID_SEPARATOR = '.';

/** DOI を並べる区切り。DOI に現れず、URL エンコードもされない文字を選ぶ。 */
const DOI_SEPARATOR = '*';

/** ORCID をキーにしている共著者（OpenAlex の著者 ID が null の行）用の接頭辞。 */
const ORCID_MARK = 'o';

/** `0000-0000-0000-000X`。 */
const ORCID_ID = /^(\d{4}-\d{4}-\d{4}-\d{3}[\dX])$/i;

/**
 * OpenAlex ID を短縮形にする。`https://openalex.org/A5030252459` → `5030252459`。
 * OpenAlex が著者 ID を持たない行は ORCID がキーになるので `o0000-...` で載せる。
 * どちらでもない（氏名しか手がかりが無い）キーは URL に載せられないので落とす。
 * @param {string[]} ids
 * @param {'A'|'I'} letter
 * @returns {string}
 */
export function shortenOpenAlexIds(ids, letter) {
  const pattern = new RegExp(`^${OPENALEX_PREFIX}${letter}(\\d+)$`);
  const parts = [];
  for (const raw of ids ?? []) {
    const id = String(raw ?? '');
    const openAlex = pattern.exec(id);
    if (openAlex) {
      parts.push(openAlex[1]);
      continue;
    }
    if (letter !== 'A') continue;
    const orcid = ORCID_ID.exec(
      id.replace(/^https?:\/\/(www\.)?orcid\.org\//i, ''),
    );
    if (orcid) parts.push(`${ORCID_MARK}${orcid[1].toUpperCase()}`);
  }
  return parts.join(ID_SEPARATOR);
}

/**
 * 短縮形を復元する。`shortenOpenAlexIds` の逆。
 * @param {string|null} raw
 * @param {'A'|'I'} letter
 * @returns {string[]}
 */
export function expandOpenAlexIds(raw, letter) {
  const out = [];
  for (const part of String(raw ?? '').split(ID_SEPARATOR)) {
    const value = part.trim();
    if (/^\d+$/.test(value)) {
      out.push(`${OPENALEX_PREFIX}${letter}${value}`);
      continue;
    }
    if (letter !== 'A') continue;
    const orcid = ORCID_ID.exec(value.slice(ORCID_MARK.length));
    if (value.startsWith(ORCID_MARK) && orcid)
      out.push(`https://orcid.org/${orcid[1].toUpperCase()}`);
  }
  return out;
}

/**
 * URL に載せられない除外キーの数。**黙って落とさない**ために数えて UI に出す。
 * @param {string[]} ids
 * @param {'A'|'I'} letter
 * @returns {number}
 */
export function countUnencodableIds(ids, letter) {
  const encoded = shortenOpenAlexIds(ids, letter);
  const kept = encoded ? encoded.split(ID_SEPARATOR).length : 0;
  return Math.max(0, (ids ?? []).length - kept);
}

/**
 * DOI を短縮形にする。共通の `10.` を落として並べる。
 * @param {string[]} dois
 * @returns {string}
 */
export function shortenDois(dois) {
  return (dois ?? [])
    .filter((doi) => typeof doi === 'string' && doi.startsWith('10.'))
    .map((doi) => doi.slice(3))
    .join(DOI_SEPARATOR);
}

/**
 * 短縮形を DOI に戻す。
 * @param {string|null} raw
 * @returns {string[]}
 */
export function expandDois(raw) {
  return String(raw ?? '')
    .split(DOI_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `10.${part}`.toLowerCase());
}

/**
 * `min=` を読む。1 未満と数字でないものは 1（= 全員）に落とす。
 * @param {unknown} raw
 * @returns {number}
 */
export function parseMinPapers(raw) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/**
 * 年範囲のつまみが交差しないように片方を止める。
 *
 * 2 つのつまみは 1 本のトラックに重なっているので、追い越しを許すと
 * 「どちらを掴んでいるのか」が分からなくなる。**動かしたほうを相手の位置で止める**
 * （相手を押して動かさない）。等しくなるところまでは寄れる = 単年の指定。
 *
 * @param {number} from
 * @param {number} to
 * @param {'from'|'to'} moved  いま動かしたつまみ
 * @returns {{from: number, to: number}}
 */
export function clampYearRange(from, to, moved) {
  if (!(from > to)) return { from, to };
  return moved === 'to' ? { from, to: from } : { from: to, to };
}

/** 年範囲の表示（en dash でつなぐ） */
export function formatYearRange(from, to) {
  return `${from} – ${to}`;
}

/**
 * `merge=` の値を URL に載せる形にする。既定（true）は書かない。
 * @param {true|'orcid'|false} value
 * @returns {string}
 */
export function mergeToParam(value) {
  return value === false ? 'off' : String(value);
}

export const SIZE_MODES = [
  { id: 'papers', labelKey: 'ctrl.size.papers' },
  { id: 'coauthors', labelKey: 'ctrl.size.coauthors' },
  { id: 'uniform', labelKey: 'ctrl.size.uniform' },
];

const SIZE_IDS = new Set(SIZE_MODES.map((s) => s.id));

function intOrNull(raw) {
  if (raw == null || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** ORCID は数字とハイフンとチェックディジット X だけ。緩めに整える */
export function cleanOrcid(raw) {
  const s = String(raw ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.)?orcid\.org\//i, '')
    .toUpperCase();
  return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(s)
    ? s
    : s.replace(/[^\dX-]/g, '');
}

/** researchmap の permalink。URL を貼られても拾う */
export function cleanPermalink(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^https?:\/\/researchmap\.jp\//i, '')
    .replace(/[/?#].*$/, '');
}

/** URL クエリから状態を読む */
export function readStateFromUrl(search = window.location.search) {
  const q = new URLSearchParams(search);
  const theme = q.get('theme');
  const proj = q.get('proj');
  const size = q.get('size');

  return {
    orcid: q.has('orcid') ? cleanOrcid(q.get('orcid')) : DEFAULTS.orcid,
    rm: q.has('rm') ? cleanPermalink(q.get('rm')) : DEFAULTS.rm,
    from: intOrNull(q.get('from')),
    to: intOrNull(q.get('to')),
    proj: PROJECTIONS.some((p) => p.id === proj) ? proj : DEFAULTS.proj,
    center: q.has('center')
      ? normalizeLongitude(q.get('center'))
      : DEFAULTS.center,
    // center を書いた URL は「中心を明示した」とみなし、自動フィットの重心より優先する
    centerExplicit: q.has('center'),
    grain: q.has('grain') ? parseGrain(q.get('grain')) : DEFAULTS.grain,
    theme: isValidTheme(theme) ? theme : DEFAULTS.theme,
    size: SIZE_IDS.has(size) ? size : DEFAULTS.size,
    scope: q.has('scope') ? parseScope(q.get('scope')) : DEFAULTS.scope,
    merge: q.has('merge') ? normalizeMergeMode(q.get('merge')) : DEFAULTS.merge,
    min: parseMinPapers(q.get('min')),
    pin: q.has('pin') ? normalizePinMode(q.get('pin')) : DEFAULTS.pin,
    orcidaff: q.get('orcidaff') !== 'off',
    afftype: q.get('afftype') !== 'off',
    labels: q.get('labels') === 'on',
    // 書かれていなければ null のまま。ページ側の既定に判断を譲る
    legend: q.has('legend') ? q.get('legend') !== 'off' : DEFAULTS.legend,
    xa: expandOpenAlexIds(q.get('xa'), 'A'),
    xi: expandOpenAlexIds(q.get('xi'), 'I'),
    xd: expandDois(q.get('xd')),
    rotateLat: 0, // 回転は共有しない（center だけ URL に載せる）
  };
}

/**
 * 状態の除外一覧を `Curation` の形にする。URL で運ばれてきた手直しを
 * commit 済み・localStorage のものと同じ土俵に乗せるため。
 * @param {Object} state
 * @returns {import('../types.js').Curation}
 */
export function curationFromState(state) {
  return {
    excludeDois: [...(state.xd ?? [])],
    excludeAuthorIds: [...(state.xa ?? [])],
    excludeInstitutionIds: [...(state.xi ?? [])],
    addDois: [],
    mergeInstitutions: {},
  };
}

/**
 * 手直しの結果を state に書き戻す。**埋め込みスニペットに反映させるための唯一の経路**。
 * @param {Object} state
 * @param {import('../types.js').Curation} curation
 */
export function applyCurationToState(state, curation) {
  state.xd = [...(curation?.excludeDois ?? [])];
  state.xa = [...(curation?.excludeAuthorIds ?? [])];
  state.xi = [...(curation?.excludeInstitutionIds ?? [])];
  return state;
}

/**
 * 状態を URL クエリ文字列にする。既定値は省く。
 * @param {Object} state
 * @param {{from: number, to: number}} [bounds] データの年範囲。同じなら省く
 */
export function stateToQuery(state, bounds) {
  const q = new URLSearchParams();
  if (state.orcid) q.set('orcid', state.orcid);
  if (state.rm) q.set('rm', state.rm);
  if (state.from != null && state.from !== bounds?.from)
    q.set('from', String(state.from));
  if (state.to != null && state.to !== bounds?.to)
    q.set('to', String(state.to));
  if (state.proj !== DEFAULTS.proj) q.set('proj', state.proj);
  // 明示された中心は既定値と同じでも書く。書かないと再読み込みで
  // 「明示した」情報が落ち、自動フィットの重心に乗っ取られてしまう
  if (state.centerExplicit || Math.round(state.center) !== DEFAULTS.center)
    q.set('center', String(Math.round(state.center)));
  if (state.grain !== DEFAULTS.grain) q.set('grain', grainToParam(state.grain));
  if (state.theme !== DEFAULTS.theme) q.set('theme', state.theme);
  if (state.size !== DEFAULTS.size) q.set('size', state.size);
  if (state.scope && state.scope !== DEFAULTS.scope)
    q.set('scope', state.scope);
  if (state.merge !== undefined && state.merge !== DEFAULTS.merge)
    q.set('merge', mergeToParam(state.merge));
  if (parseMinPapers(state.min) > 1) q.set('min', String(state.min));
  if (state.pin && state.pin !== DEFAULTS.pin) q.set('pin', state.pin);
  if (state.orcidaff === false) q.set('orcidaff', 'off');
  if (state.afftype === false) q.set('afftype', 'off');
  if (state.labels === true) q.set('labels', 'on');
  // 凡例は「ページ既定に従う（null）」が既定なので、明示されたときだけ書く。
  // これで index.html の見え方をそのまま widget.html に運べる
  if (state.legend === true) q.set('legend', 'on');
  else if (state.legend === false) q.set('legend', 'off');
  // 手直しは短縮形で載せる。1 件も無ければ書かない
  const authors = shortenOpenAlexIds(state.xa ?? [], 'A');
  if (authors) q.set('xa', authors);
  const institutions = shortenOpenAlexIds(state.xi ?? [], 'I');
  if (institutions) q.set('xi', institutions);
  const dois = shortenDois(state.xd ?? []);
  if (dois) q.set('xd', dois);
  return q.toString();
}

/** アドレスバーを書き換える（履歴は積まない） */
export function syncUrl(state, bounds) {
  const query = stateToQuery(state, bounds);
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', url);
}

/**
 * 操作パネルを組み立てる。
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {(k: string, p?: Object) => string} opts.t
 * @param {Object} opts.state
 * @param {(patch: Object) => void} opts.onChange   表示だけ変わる操作
 * @param {(seeds: {orcid: string, rm: string}) => void} opts.onRebuild  データを取り直す操作
 *
 * 「表示を初期に戻す」ボタンはここには無い。地図の真下に置くので
 * `createMapActions` が持つ（Load this researcher との役割の違いを見せるため）。
 */
export function createControls({ container, t, state, onChange, onRebuild }) {
  let bounds = {
    from: state.from ?? 1990,
    to: state.to ?? new Date().getFullYear(),
  };

  const orcidInput = h('input', {
    type: 'text',
    id: 'seed-orcid',
    value: state.orcid ?? '',
    placeholder: '0000-0000-0000-0000',
    inputmode: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const rmInput = h('input', {
    type: 'text',
    id: 'seed-rm',
    value: state.rm ?? '',
    placeholder: 'yk_frkw',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const seedError = h('p', { class: 'hint', role: 'alert' });

  // 既定の ORCID で最初から地図が出ているので、このボタンは
  // 「いま入力されている ID で作り直す」ためのもの。**押しても何も変わらない
  // あいだは無効にする**。押す理由の分からないボタンを出しておかない
  const seedButton = h('button', {
    type: 'submit',
    class: 'primary',
    text: t('seed.load'),
  });
  const seedNote = h('span', { class: 'hint' });

  /** いま画面に出ている地図が読んでいる seed。null = 同じ ID でも読み直せる */
  let loadedSeeds = { orcid: state.orcid ?? '', rm: state.rm ?? '' };

  function syncSeedButton() {
    const same =
      loadedSeeds != null &&
      cleanOrcid(orcidInput.value) === loadedSeeds.orcid &&
      cleanPermalink(rmInput.value) === loadedSeeds.rm;
    seedButton.disabled = same;
    seedNote.textContent = same ? t('seed.upToDate') : t('seed.loadHint');
  }

  /**
   * 表示中の地図の seed を差し替える。null を渡すと
   * 「同じ ID でももう一度読める」状態に戻す（読み込みに失敗したとき用）。
   */
  function setLoadedSeeds(seeds) {
    loadedSeeds = seeds
      ? { orcid: seeds.orcid ?? '', rm: seeds.rm ?? '' }
      : null;
    syncSeedButton();
  }

  function submitSeeds(event) {
    event?.preventDefault();
    const orcid = cleanOrcid(orcidInput.value);
    const rm = cleanPermalink(rmInput.value);
    if (!orcid && !rm) {
      seedError.textContent = t('seed.needOne');
      return;
    }
    seedError.textContent = '';
    orcidInput.value = orcid;
    rmInput.value = rm;
    setLoadedSeeds({ orcid, rm });
    onRebuild({ orcid, rm });
  }

  for (const input of [orcidInput, rmInput])
    input.addEventListener('input', syncSeedButton);

  const seedForm = h('form', { class: 'controls', onsubmit: submitSeeds }, [
    h('div', { class: 'field' }, [
      h('label', { for: 'seed-orcid', text: t('seed.orcid') }),
      orcidInput,
      h('span', { class: 'hint', text: t('seed.orcidHint') }),
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'seed-rm', text: t('seed.rm') }),
      rmInput,
      h('span', { class: 'hint', text: t('seed.rmHint') }),
    ]),
    h('div', { class: 'field' }, [
      h('span', { class: 'field-label', text: ' ' }),
      seedButton,
      seedNote,
    ]),
    h('div', { class: 'field-wide' }, [seedError]),
  ]);
  syncSeedButton();

  // ---- 年範囲（1 本のトラックに 2 つのつまみ） ----
  //
  // 見た目は 1 本。実体は range を 2 つ**同じグリッドセルに重ねて**いる
  // （position ではなく Grid で重ねる）。トラックは下敷きの div が描き、
  // input 側のトラックは透明にして、掴めるのはつまみだけにしてある。
  // どちらも本物の input なので、Tab で入って矢印キーで動く操作性は素のまま。
  const yearFrom = h('input', {
    type: 'range',
    id: 'year-from',
    class: 'range-from',
    'aria-label': t('ctrl.yearFrom'),
  });
  const yearTo = h('input', {
    type: 'range',
    id: 'year-to',
    class: 'range-to',
    'aria-label': t('ctrl.yearTo'),
  });
  const yearTrack = h('div', { class: 'range-track', 'aria-hidden': 'true' });
  const yearRange = h(
    'div',
    { class: 'range-dual', role: 'group', 'aria-labelledby': 'years-label' },
    [yearTrack, yearFrom, yearTo],
  );
  const yearOut = h('output', { for: 'year-from year-to', class: 'hint' });

  /** 選択中の区間をトラックに塗り、つまみの前後関係を決める */
  function paintYearTrack() {
    const min = Number(yearFrom.min);
    const max = Number(yearFrom.max);
    const span = max - min || 1;
    const fromPct = ((Number(yearFrom.value) - min) / span) * 100;
    const toPct = ((Number(yearTo.value) - min) / span) * 100;
    yearTrack.style.setProperty('--range-from', `${fromPct}%`);
    yearTrack.style.setProperty('--range-to', `${toPct}%`);
    // 右端で 2 つが重なると後ろのつまみをポインタで掴めなくなる。
    // 開始側が右寄りのときだけ手前に出して、必ずどちらも掴めるようにする
    yearRange.classList.toggle('is-from-on-top', fromPct > 50);
  }

  function pushYears(moved) {
    const { from, to } = clampYearRange(
      Number(yearFrom.value),
      Number(yearTo.value),
      moved,
    );
    yearFrom.value = String(from);
    yearTo.value = String(to);
    yearOut.textContent = formatYearRange(from, to);
    paintYearTrack();
    onChange({ from, to });
  }
  yearFrom.addEventListener('input', () => pushYears('from'));
  yearTo.addEventListener('input', () => pushYears('to'));

  // ---- 粒度（国 ←→ 都市） ----
  const grainSlider = h('input', {
    type: 'range',
    id: 'grain',
    min: '0',
    max: String(GRAIN_MAX),
    step: '1',
    value: String(grainToSlider(state.grain)),
    'aria-describedby': 'grain-out',
  });
  const grainOut = h('output', {
    id: 'grain-out',
    for: 'grain',
    class: 'hint',
  });

  function grainText(grain) {
    if (grain === GRAIN_COUNTRY) return t('grain.countryMode');
    if (grain === 0) return t('grain.cityMode');
    return t('grain.radius', { n: grain });
  }
  grainSlider.addEventListener('input', () => {
    const grain = sliderToGrain(grainSlider.value);
    grainOut.textContent = grainText(grain);
    onChange({ grain });
  });

  // ---- 大きさの基準 ----
  const sizeButtons = SIZE_MODES.map((mode) =>
    h('button', {
      type: 'button',
      'aria-pressed': String(state.size === mode.id),
      text: t(mode.labelKey),
      onclick: () => {
        for (const b of sizeButtons) b.setAttribute('aria-pressed', 'false');
        const idx = SIZE_MODES.findIndex((m) => m.id === mode.id);
        sizeButtons[idx].setAttribute('aria-pressed', 'true');
        onChange({ size: mode.id });
      },
    }),
  );

  // ---- 都市名ラベルの表示 ----
  const labelsToggle = h('input', {
    type: 'checkbox',
    id: 'map-labels',
    checked: state.labels === true,
  });
  labelsToggle.addEventListener('change', () =>
    onChange({ labels: labelsToggle.checked }),
  );

  // ---- 投影法 ----
  const projSelect = selectEl({
    id: 'proj',
    value: state.proj,
    options: PROJECTIONS.map((p) => ({ value: p.id, label: t(p.labelKey) })),
    onChange: (value) => {
      onChange({ proj: value });
      updateHints(value);
    },
  });

  // ---- 表示範囲（自動フィット） ----
  const scopeSelect = selectEl({
    id: 'scope',
    value: state.scope ?? DEFAULTS.scope,
    options: SCOPE_OPTIONS.map((s) => ({ value: s.id, label: t(s.labelKey) })),
    onChange: (value) => onChange({ scope: value }),
  });

  // ---- 中心経度 ----
  const centerPreset = selectEl({
    id: 'center-preset',
    value: presetIdFor(state.center),
    options: [
      ...CENTER_PRESETS.map((p) => ({ value: p.id, label: t(p.labelKey) })),
      { value: 'custom', label: t('center.custom') },
    ],
    onChange: (value) => {
      const preset = CENTER_PRESETS.find((p) => p.id === value);
      if (!preset) return;
      centerSlider.value = String(preset.lon);
      centerOut.textContent = formatLon(preset.lon);
      // 手で選んだ中心は自動フィットの重心より優先する
      onChange({ center: preset.lon, centerExplicit: true });
    },
  });
  const centerSlider = h('input', {
    type: 'range',
    id: 'center',
    min: '-180',
    max: '180',
    step: '1',
    value: String(Math.round(state.center)),
  });
  const centerOut = h('output', { for: 'center', class: 'hint' });
  centerSlider.addEventListener('input', () => {
    const lon = normalizeLongitude(centerSlider.value);
    centerOut.textContent = formatLon(lon);
    centerPreset.value = presetIdFor(lon);
    onChange({ center: lon, centerExplicit: true });
  });

  // ---- テーマ ----
  const themeSelect = selectEl({
    id: 'theme',
    value: state.theme,
    options: [
      { value: THEME_AUTO, label: t('theme.auto') },
      ...THEMES.map((th) => ({ value: th.id, label: t(th.labelKey) })),
    ],
    onChange: (value) => onChange({ theme: value }),
  });

  const projHint = h('span', { class: 'hint' });
  function updateHints(projId) {
    const spec = getProjectionSpec(projId);
    projHint.textContent = spec.rotatable
      ? t('ctrl.rotateHint')
      : t('ctrl.panHint');
  }
  updateHints(state.proj);

  const viewForm = h('div', { class: 'controls' }, [
    h('div', { class: 'field' }, [
      h('span', {
        id: 'years-label',
        class: 'field-label',
        text: t('ctrl.years'),
      }),
      yearRange,
      yearOut,
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'grain', text: t('ctrl.grain') }),
      h('div', { class: 'map-legend' }, [
        h('span', { text: t('grain.country') }),
        h('span', { text: '←→' }),
        h('span', { text: t('grain.city') }),
      ]),
      grainSlider,
      grainOut,
    ]),
    h('div', { class: 'field' }, [
      h('span', { class: 'field-label', text: t('ctrl.size') }),
      h('div', { class: 'segmented' }, sizeButtons),
    ]),
    h('div', { class: 'field' }, [
      h('span', { class: 'field-label', text: t('ctrl.labels') }),
      h('label', { class: 'check-row', for: 'map-labels' }, [
        labelsToggle,
        h('span', { text: t('ctrl.labelsShow') }),
      ]),
      h('span', { class: 'hint', text: t('ctrl.labelsHint') }),
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'proj', text: t('ctrl.projection') }),
      projSelect,
      projHint,
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'scope', text: t('ctrl.scope') }),
      scopeSelect,
      h('span', { class: 'hint', text: t('ctrl.scopeHint') }),
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'center', text: t('ctrl.center') }),
      centerPreset,
      centerSlider,
      centerOut,
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'theme', text: t('ctrl.theme') }),
      themeSelect,
    ]),
    h('div', { class: 'field-wide' }, [
      h('p', { class: 'hint', text: t('grain.hint') }),
    ]),
  ]);

  container.append(seedForm, viewForm);

  function presetIdFor(lon) {
    const hit = CENTER_PRESETS.find(
      (p) => Math.round(p.lon) === Math.round(lon),
    );
    return hit ? hit.id : 'custom';
  }

  function formatLon(lon) {
    const n = Math.round(lon);
    if (n === 0) return '0°';
    return n > 0 ? `${n}°E` : `${-n}°W`;
  }

  /** データが来たら年スライダーの範囲を実データに合わせる */
  function setYearBounds(min, max, current) {
    bounds = { from: min, to: max };
    for (const el of [yearFrom, yearTo]) {
      el.min = String(min);
      el.max = String(max);
      el.step = '1';
    }
    yearFrom.value = String(current?.from ?? min);
    yearTo.value = String(current?.to ?? max);
    yearOut.textContent = formatYearRange(yearFrom.value, yearTo.value);
    paintYearTrack();
    return { from: Number(yearFrom.value), to: Number(yearTo.value) };
  }

  /** 外から状態を戻す（回転で center が動いたときなど） */
  function syncFromState(next) {
    if (next.center != null) {
      centerSlider.value = String(Math.round(next.center));
      centerOut.textContent = formatLon(next.center);
      centerPreset.value = presetIdFor(next.center);
    }
    if (next.grain != null) {
      grainSlider.value = String(grainToSlider(next.grain));
      grainOut.textContent = grainText(next.grain);
    }
  }

  // 初期表示
  centerOut.textContent = formatLon(state.center);
  grainOut.textContent = grainText(state.grain);
  paintYearTrack();

  return {
    setYearBounds,
    syncFromState,
    submitSeeds,
    setLoadedSeeds,
    get bounds() {
      return bounds;
    },
  };
}

/**
 * 地図のすぐ下に置く操作。
 *
 * Reset は**投影・ズーム・中心を初期に戻すだけ**で、データは読み直さない。
 * 上の「Load this researcher」と役割が違うことが見て分かるように、
 * 操作パネルから外して地図の真下に置き、文言も Reset map view にしてある。
 * 動かしていないあいだは押しても何も起きないので無効にする。
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.container
 * @param {(k: string, p?: Object) => string} opts.t
 * @param {() => void} opts.onResetView
 */
export function createMapActions({ container, t, onResetView }) {
  const resetButton = h('button', {
    type: 'button',
    text: t('ctrl.reset'),
    disabled: true,
    onclick: () => onResetView?.(),
  });

  container.append(
    h('div', { class: 'button-row' }, [
      resetButton,
      h('span', { class: 'hint', text: t('ctrl.resetHint') }),
    ]),
  );

  return {
    /** ズーム・パン・回転・中心指定があるあいだだけ押せるようにする */
    setMoved(moved) {
      resetButton.disabled = !moved;
    },
  };
}
