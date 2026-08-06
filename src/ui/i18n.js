/**
 * UI 文言。**US 英語 1 言語だけ**。
 *
 * 対象は世界中の研究者なので言語切替は持たない（`?lang=` も無い）。
 * 綴りは US（center / organization / analyze）。数値と日付は en-US で整形する。
 * コード内のコメントは日本語のまま。
 */

const STRINGS = {
  'app.title': 'Co-author map',
  'app.tagline':
    'Map the world of people you have published with. Enter an ORCID iD or a researchmap permalink.',
  'app.about':
    'Papers are collected from ORCID and researchmap, matched against OpenAlex, and each co-author affiliation is placed on the map. Pins are cities, not institutions: OpenAlex stores coordinates at city level, so several organizations share one point.',

  'seed.legend': 'Whose map?',
  'seed.orcid': 'ORCID iD',
  'seed.rm': 'researchmap permalink',
  'seed.orcidHint': 'e.g. 0000-0003-1317-0220',
  'seed.rmHint': 'e.g. yk_frkw',
  'seed.load': 'Load this researcher',
  'seed.loadHint': 'Rebuild the map from the IDs above.',
  'seed.upToDate': 'The map below already shows these IDs.',
  'seed.needOne': 'Enter an ORCID iD or a researchmap permalink.',

  'ctrl.years': 'Years',
  'ctrl.yearFrom': 'First year',
  'ctrl.yearTo': 'Last year',
  // 終了年をデータの最大年に置いたままのときに、年の代わりに出す語。
  // `?to=latest` と書ける値でもあるので、画面の語と URL の語を同じにしておく
  'ctrl.yearLatest': 'latest',
  'ctrl.yearToOpen': 'Last year, open ended',
  'ctrl.yearsOpenNote': 'new papers appear automatically',
  'ctrl.grain': 'Grouping',
  'grain.country': 'Country',
  'grain.city': 'City',
  'grain.hint':
    'Slide toward Country to merge nearby pins, toward City to split them apart. Zooming in splits them too. OpenAlex stores coordinates per city, so a single city is as fine as the data goes.',
  'grain.countryMode': 'One pin per country',
  'grain.radius': 'Merge within {n} px',
  'grain.cityMode': 'One pin per city',
  'ctrl.size': 'Pin size',
  'ctrl.size.papers': 'Papers',
  'ctrl.size.coauthors': 'Co-authors',
  'ctrl.size.uniform': 'Uniform',
  'ctrl.projection': 'Projection',
  'ctrl.scope': 'Extent',
  'scope.auto': 'Auto',
  'scope.country': 'Country',
  'scope.region': 'Region',
  'scope.world': 'World',
  'ctrl.scopeHint':
    'Auto fits the map to one country, one region, or the whole world, depending on where your co-authors are.',
  'ctrl.center': 'Center longitude',
  'ctrl.labels': 'City labels',
  'ctrl.labelsShow': 'Show city names on the map',
  'ctrl.labelsHint':
    'Draws the city name over the ten largest pins. Off by default so the pins stay readable; every city is still named in the tooltip and the table. The setting travels with the embed snippet.',
  'ctrl.theme': 'Theme',
  'ctrl.reset': 'Reset map view',
  'ctrl.resetHint':
    'Puts the projection, zoom, and center back where they started. It does not reload any data.',
  'ctrl.rotateHint': 'Drag the globe to rotate. Scroll to zoom.',
  'ctrl.panHint': 'Drag to pan. Scroll to zoom.',

  'proj.equalEarth': 'Equal Earth',
  'proj.naturalEarth': 'Natural Earth',
  'proj.equirectangular': 'Equirectangular',
  'proj.mercator': 'Mercator',
  'proj.orthographic': 'Globe (orthographic)',

  'center.japan': 'Japan (140°E)',
  'center.europe': 'Europe (10°E)',
  'center.americas': 'Americas (80°W)',
  'center.pacific': 'Pacific (180°)',
  'center.atlantic': 'Atlantic (30°W)',
  'center.custom': 'Custom',

  'region.africa': 'Africa',
  'region.asia': 'Asia',
  'region.europe': 'Europe',
  'region.northAmerica': 'North America',
  'region.southAmerica': 'South America',
  'region.oceania': 'Oceania',
  'region.antarctica': 'Antarctica',

  'theme.auto': 'Match system',
  'theme.minimal': 'Minimal',
  'theme.dark': 'Dark',
  'theme.blueprint': 'Blueprint',
  'theme.paper': 'Paper',

  'stat.papers': 'Papers',
  'stat.coauthors': 'Co-authors',
  'stat.institutions': 'Organizations',
  'stat.cities': 'Cities',
  'stat.countries': 'Countries',
  'stat.years': 'Years',
  'stat.merged': 'Records merged',

  'map.aria':
    'World map of co-author locations: {cities} cities in {countries} countries, {coauthors} co-authors, {papers} papers, {from} to {to}. The tables below give the same data as text.',
  'map.pinAria':
    '{city}, {country}. {papers} papers, {coauthors} co-authors, {institutions} organizations.',
  'map.pinAriaCluster':
    '{city} and {cities} places nearby. {papers} papers, {coauthors} co-authors.',
  'map.clusterMore': '+{n} more',
  'map.pinCount': '{n} pins',
  'map.legendSize': 'Pin area is proportional to {metric}',
  'map.fittedTo': 'Fitted to {name}',
  'map.empty': 'No location falls inside the selected years.',
  'map.keyboardHint':
    'Press Tab to step through pins; Escape closes the tooltip.',

  'tip.papers': 'Papers',
  'tip.coauthors': 'Co-authors',
  'tip.institutions': 'Organizations',
  'tip.cities': 'Places',
  'tip.andMore': 'and {n} more',

  'table.heading': 'The same map as text',
  'table.byCountry': 'By country',
  'table.byInstitution': 'By organization',
  'table.byYear': 'By year',
  'table.country': 'Country',
  'table.cities': 'Cities',
  'table.institutions': 'Organizations',
  'table.coauthors': 'Co-authors',
  'table.papers': 'Papers',
  'table.institution': 'Organization',
  'table.city': 'City',
  'table.year': 'Year',
  'table.newCoauthors': 'New co-authors',
  'table.countries': 'Countries',
  'table.total': 'Total',
  'table.copyMarkdown': 'Copy as Markdown',
  'table.copyCsv': 'Copy as CSV',
  'table.copied': 'Copied.',
  'table.copyFailed': 'Could not copy. Select the text and copy manually.',
  'table.unknownAffiliation':
    'Affiliation missing: {coauthors} co-authors and {rows} author-paper rows have no organization in OpenAlex, so they are not on the map.',
  'table.unmatched': '{n} DOIs from the seed could not be matched in OpenAlex.',
  'table.papersWithoutLocation':
    'Not on the map: {n} of {total} papers have no co-author affiliation with coordinates, so they contribute no pin.',

  'auth.heading': 'Who is on the map',
  'auth.intro':
    'Each co-author is placed at one primary affiliation, so nobody appears twice. Narrow the map to the people you actually work with, then copy the embed snippet: the corrections travel with it.',
  'auth.min': 'Main collaborations',
  'auth.minLabel': '{n} papers or more — showing {shown} of {total} co-authors',
  'auth.minLabelAll':
    'Everyone, down to a single paper — showing {shown} of {total} co-authors',
  'auth.minStep': '{n}+ keeps {count}',
  'auth.select': 'Co-authors',
  'auth.search': 'Search co-authors',
  'auth.showAll': 'Show all {n}',
  'auth.showFewer': 'Show fewer',
  'auth.includeAll': 'Include everyone',
  'auth.listNote': 'Listing {visible} of {matching} · {excluded} unchecked',

  // 地図の下の状態表示（src/ui/status-line.js が組み立てる）。
  // 幅 272px の埋め込みでも読めるよう、短い文を並べて折り返させる。
  'shown.basisPapers': 'Pin area is proportional to papers, not to head count.',
  'shown.basisCoauthors':
    'Pin area is proportional to the number of co-authors.',
  'shown.all': 'Showing {shown} of {total} co-authors.',
  'shown.min':
    'Showing co-authors with {n} or more joint papers: {shown} of {total}.',
  'shown.hiddenOne': '1 co-author is hidden by hand.',
  'shown.hidden': '{n} co-authors are hidden by hand.',
  'shown.years': 'Years {from}–{to}.',

  'load.busy': 'Loading the map',

  'cur.heading': 'Corrections',
  'cur.intro':
    'OpenAlex is not perfect. Drop papers that are not yours, hide a co-author or an organization, add a missing DOI, or merge two records of the same organization. Changes are stored in this browser only.',
  'cur.excludePapers': 'Exclude papers',
  'cur.excludeCoauthors': 'Exclude co-authors',
  'cur.excludeInstitutions': 'Exclude organizations',
  'cur.addDoi': 'Add a DOI',
  'cur.addDoiPlaceholder': '10.1016/j.eclinm.2026.103988',
  'cur.add': 'Add',
  'cur.added': 'Added DOIs',
  'cur.merge': 'Merge organizations',
  'cur.mergeFrom': 'Merge this',
  'cur.mergeInto': 'into this',
  'cur.mergeAdd': 'Merge',
  'cur.merges': 'Merges',
  'cur.mergeCoauthors': 'Merge duplicate co-author records',
  'cur.mergeCoauthorsLabel': 'Count split records as one person',
  'cur.mergeCoauthorsHint':
    'OpenAlex sometimes files one person under several author records, which inflates the co-author counts and the pin sizes. Two records are counted as one person when they share an ORCID iD, or when they share a name and an organization and never appear together on the same paper.',
  'cur.mergedList': 'Merged co-authors',
  'cur.mergedRow': '{name} — {n} absorbed (matched by {by})',
  'cur.mergedByOrcid': 'ORCID',
  'cur.mergedByName': 'name',
  'cur.mergedNone': 'No co-author records were merged.',
  'cur.filter': 'Filter the list',
  'cur.export': 'Export JSON',
  'cur.import': 'Import JSON',
  'cur.clear': 'Clear all corrections',
  'cur.count': '{n} selected',
  'cur.importFailed': 'That file is not a corrections JSON.',
  'cur.invalidDoi': 'That does not look like a DOI.',

  'exp.heading': 'Download',
  'exp.svg': 'Download SVG',
  'exp.png': 'Download PNG (2x)',
  'exp.failed': 'The export failed in this browser.',

  'embed.heading': 'Put this map on your own site',
  'embed.intro':
    'Copy the snippet below. It embeds the map you are looking at right now, with the current years, projection, and theme.',
  'embed.copy': 'Copy the snippet',
  'embed.height': 'Height (px)',
  'embed.tooLong':
    'This link is {n} characters long. Some blog editors and servers cut links off around 2,000. Raise Main collaborations to drop the smallest collaborations, or clear a few corrections.',
  // `controls=on` を付ける版。読者が枠の中で自分の地図を作れるようになる代わりに
  // 枠が 300px ほど高くなるので、既定は表示専用のまま
  'embed.controlsLabel': 'Let readers build their own map',
  'embed.controlsHint':
    'Adds the ID fields and the main view controls inside the frame, so a reader can enter their own ORCID iD without leaving your page. The frame needs about 300 more pixels of height.',
  'embed.autoResizeLabel': 'Let the frame set its own height',
  'embed.autoResizeHint':
    'On by default. The snippet carries a small script that follows the height the frame reports, so the map is never cut off or padded. Uncheck it to paste a fixed-height frame instead.',
  'embed.fixedHeightNote':
    'Fixed height. The map is cut off if it needs more room than this.',
  // 貼った地図が将来も伸びるのかどうか。1 行で言い切る。
  // 意図せず終了年を下げたまま配って地図を凍らせるのを防ぐのが目的
  'embed.keepsGrowing':
    'Keeps growing: the snippet carries no end year, so a paper added to the record later appears on the map by itself.',
  // 年は {year} で渡す。{n} だと桁区切りが入って 2,026 になる
  'embed.frozenAt':
    'Stops at {year}: the snippet pins the last year, so papers published later never appear. Drag the last year back to the right end of the slider to let the map keep growing.',

  // `?controls=on` の埋め込みの末尾に置く 1 本のリンク。埋め込みでは出さない
  // 補正・集計テーブル・ダウンロード・埋め込みコード生成への唯一の導線
  'widget.openFullTool':
    'Open the full tool for tables, corrections, and downloads',

  'load.start': 'Starting...',
  'load.done': 'Done.',
  'load.failed': 'Could not build the map.',
  'load.retry': 'Try again',
  'load.hintNetwork':
    'The data comes from ORCID, researchmap, and OpenAlex over the network. If one of them is unreachable or rate-limiting, wait a moment and retry.',

  'cta.heading': 'Make your own',
  'cta.body':
    'Replace the ORCID iD above with yours and press Load this researcher. Nothing is uploaded; everything runs in your browser.',

  'footer.sources': 'Sources',
  'footer.openalex': 'OpenAlex (CC0)',
  'footer.orcid': 'ORCID',
  'footer.researchmap': 'researchmap',
  'footer.naturalearth': 'Natural Earth via world-atlas',
  'footer.by': 'Yuki Furukawa - yukifurukawa.jp',
};

/**
 * 進捗キー → 表示文言。
 *
 * データ層（pipeline / openalex / seeds）は**表示用の文字列を持たない**。
 * 発火するのは ASCII の安定キーだけで、それを英語に直すのはこの表の仕事。
 * キーを足したらここにも足す（tests/i18n.test.js がキー集合の一致を見ている）。
 */
const PROGRESS_STRINGS = {
  seeds: 'Reading claimed works',
  'seeds:orcid': 'Reading works from ORCID',
  'seeds:researchmap': 'Reading papers from researchmap',
  'seeds:openalex': 'Searching OpenAlex for author records',
  works: 'Fetching papers from OpenAlex',
  'orcid-affiliations': 'Reading affiliations from ORCID',
  institutions: 'Resolving affiliations',
  aggregate: 'Building the map',
};

/** 未知のキーが来たときの逃げ場。キー文字列を生で画面に出さないため。 */
const PROGRESS_FALLBACK = 'Loading…';

/**
 * 進捗キーを表示文言に直す。知らないキーは汎用文言に落とす。
 * @param {string} key
 * @returns {string}
 */
export function progressLabel(key) {
  return Object.prototype.hasOwnProperty.call(PROGRESS_STRINGS, key)
    ? PROGRESS_STRINGS[key]
    : PROGRESS_FALLBACK;
}

/** 数値は en-US 表記に統一する（1,234） */
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

/** @param {number} value */
export function formatNumber(value) {
  return Number.isFinite(Number(value))
    ? NUMBER_FORMAT.format(Number(value))
    : String(value ?? '');
}

/** 年は桁区切りを付けない（2026 を 2,026 にしない） */
export function formatYear(value) {
  return String(value ?? '');
}

/**
 * 翻訳関数。言語は 1 つなのでキーの引き当てと {name} の差し込みだけを行う。
 * @returns {(key: string, params?: Record<string, string|number>) => string}
 */
export function createTranslator() {
  return (key, params) => {
    const raw = STRINGS[key] ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (m, name) => {
      if (!Object.prototype.hasOwnProperty.call(params, name)) return m;
      const value = params[name];
      // 年らしきキーは桁区切りを付けない
      if (name === 'from' || name === 'to' || name === 'year')
        return formatYear(value);
      return typeof value === 'number' ? formatNumber(value) : String(value);
    });
  };
}

export { STRINGS, PROGRESS_STRINGS, PROGRESS_FALLBACK };
