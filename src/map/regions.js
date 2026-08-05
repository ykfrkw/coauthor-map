/**
 * ISO 3166-1 alpha-2 → 大陸区分（7 分割）の対応表。
 *
 * 外部依存を足さずに手で持つ。区分は**国連 M49 の大陸区分**に合わせる:
 *   002 Africa / 142 Asia / 150 Europe / 009 Oceania / 010 Antarctica
 * ただし M49 の 019 Americas は「北」「南」に割りたいので、
 *   northAmerica = 021 Northern America + 013 Central America + 029 Caribbean
 *   southAmerica = 005 South America
 * とする（地図のフィット対象としては、メキシコやカリブ海を北米側に入れたほうが
 * 素直な枠になる）。
 *
 * 大陸をまたぐ国の割り当てと、その根拠:
 *  - RU ロシア → europe。M49 は 151 Eastern Europe に置く。慣用とも一致する
 *  - TR トルコ → asia。M49 は 145 Western Asia。政治的には欧州側に数えることも
 *    あるが、国土の大半はアナトリア半島なので M49 に従う
 *  - CY キプロス, AM アルメニア, AZ アゼルバイジャン, GE ジョージア → asia。
 *    いずれも M49 は 145 Western Asia。EU 加盟や欧州のスポーツ連盟に属していても、
 *    ここでは M49 の地理区分を優先する
 *  - KZ カザフスタン → asia（M49 143 Central Asia）。ウラル以西も含むが M49 に従う
 *  - EG エジプト → africa（M49 015 Northern Africa）。シナイ半島はアジア側だが同様
 *  - GL グリーンランド → northAmerica（M49 021 Northern America）。
 *    デンマーク領だが地理区分は北米
 *  - HK 香港, MO マカオ, TW 台湾 → asia。OpenAlex がこれらの alpha-2 を返すため
 *    表に載せる（M49 は中国の一部 / 未収載として扱うが、地図の用途では影響しない）
 *  - XK コソボ → europe。ISO 3166-1 の正式コードではなくユーザー割当領域の
 *    慣用コードだが、OpenAlex が返すことがあるので拾う
 *
 * 意図的に**載せない**コード:
 *  - BV ブーベ島 / GS サウスジョージア / HM ハード島 / TF 仏領南方南極地域。
 *    M49 の割り当て（アフリカ・南米など）が直感と食い違ううえ、共著者の所在地
 *    として出てくることはまず無い。表に無いコードは呼び出し側で world に落ちる。
 */

/** 大陸区分の id。UI の並び順もこれに従う */
export const REGIONS = Object.freeze([
  'africa',
  'asia',
  'europe',
  'northAmerica',
  'southAmerica',
  'oceania',
  'antarctica',
]);

const REGION_SET = new Set(REGIONS);

/** 地域 id → その地域に属する alpha-2 の一覧 */
const MEMBERS = {
  // M49 002 Africa（015 Northern Africa + 202 Sub-Saharan Africa）
  africa: `DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH
    GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO
    ZA SS SD TZ TG TN UG EH ZM ZW`,

  // M49 142 Asia（143 中央 + 030 東 + 034 南 + 035 東南 + 145 西）
  asia: `AF AM AZ BH BD BT BN KH CN CY GE HK IN ID IR IQ IL JP JO KZ KP KR KW KG
    LA LB MO MY MV MN MM NP OM PK PS PH QA SA SG LK SY TW TJ TH TL TR TM AE UZ
    VN YE`,

  // M49 150 Europe（151 東 + 154 北 + 039 南 + 155 西）
  europe: `AL AD AT AX BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG VA HU IS IE
    IM IT JE LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE
    CH UA GB XK`,

  // M49 021 Northern America + 013 Central America + 029 Caribbean
  northAmerica: `BM CA GL PM US BZ CR SV GT HN MX NI PA AI AG AW BS BB BQ VG KY
    CU CW DM DO GD GP HT JM MQ MS PR BL KN LC MF VC SX TT TC VI`,

  // M49 005 South America
  southAmerica: `AR BO BR CL CO EC FK GF GY PY PE SR UY VE`,

  // M49 009 Oceania（053 豪NZ + 054 メラネシア + 057 ミクロネシア + 061 ポリネシア）
  oceania: `AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV
    UM VU WF`,

  // M49 010 Antarctica
  antarctica: `AQ`,
};

/** alpha-2 → 地域 id。表引きは 1 回だけ組み立てる */
const COUNTRY_REGION = new Map();
for (const region of REGIONS) {
  for (const code of MEMBERS[region].split(/\s+/)) {
    if (code) COUNTRY_REGION.set(code, region);
  }
}

export { COUNTRY_REGION };

/**
 * 国コードから地域を引く。表に無ければ null（呼び出し側は world に落とす）。
 * @param {string|null|undefined} code ISO 3166-1 alpha-2
 * @returns {string|null}
 */
export function regionOf(code) {
  if (!code) return null;
  return COUNTRY_REGION.get(String(code).trim().toUpperCase()) ?? null;
}

/** 地域 id として妥当か */
export function isRegion(id) {
  return REGION_SET.has(id);
}

/** 地域名の i18n キー */
export function regionLabelKey(region) {
  return `region.${region}`;
}
