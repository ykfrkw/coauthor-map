/**
 * データ契約。パイプライン側（seeds / openalex / aggregate）と
 * 描画側（map / ui）はこの型だけを介してやり取りする。
 *
 * 実行時の値を持たないモジュール。JSDoc の型定義のみを置く。
 */

/**
 * seed アダプタが返す1件。ORCID / researchmap / OpenAlex 著者のどれでもこの形にそろえる。
 * @typedef {Object} SeedWork
 * @property {string} doi        小文字・接頭辞なし（`10.1016/j.eclinm.2026.103988`）
 * @property {number|null} year
 * @property {string|null} title
 * @property {string[]} sources  由来（`'orcid'` / `'researchmap'` / `'openalex'` / `'manual'`）。和集合を取ると複数入る
 */

/**
 * @typedef {Object} Institution
 * @property {string} id           OpenAlex の機関 ID（`https://openalex.org/I62916508`）
 * @property {string} name
 * @property {string|null} countryCode  ISO 3166-1 alpha-2
 * @property {string|null} type
 * @property {number|null} lat     OpenAlex の geo は**都市単位**。キャンパス単位ではない
 * @property {number|null} lng
 * @property {string|null} city
 * @property {string|null} country 表示用の国名
 */

/**
 * @typedef {Object} Coauthor
 * @property {string} id            OpenAlex の著者 ID
 * @property {string} name
 * @property {string|null} orcid
 * @property {string[]} institutionIds
 * @property {string[]} dois
 * @property {number} paperCount
 */

/**
 * 地図上のピン1つ。**機関ではなく都市**が単位（OpenAlex の geo が都市粒度のため、
 * 同一座標に複数機関が重なる。東京は 13 機関が同じ座標を持つ）。
 * @typedef {Object} CityNode
 * @property {string} key           `${lat.toFixed(2)},${lng.toFixed(2)}`
 * @property {number} lat
 * @property {number} lng
 * @property {string|null} city
 * @property {string|null} countryCode
 * @property {string|null} country
 * @property {Institution[]} institutions  論文数の多い順
 * @property {Coauthor[]} coauthors        論文数の多い順
 * @property {string[]} dois               この都市が関わった DOI（重複なし）
 * @property {number} paperCount           `dois.length`
 * @property {number} coauthorCount        `coauthors.length`
 */

/**
 * @typedef {Object} DatasetStats
 * @property {number} seedWorks                  seed から得た DOI 件数（和集合・除外適用後）
 * @property {number} matchedWorks               OpenAlex で突合できた件数
 * @property {string[]} unmatchedDois            突合できなかった DOI
 * @property {number} coauthors
 * @property {number} institutions
 * @property {number} geoResolved                緯度経度が取れた機関数
 * @property {number} cities
 * @property {number} countries
 * @property {number} authorshipRows             著者×論文の行数（seed 本人を含む）
 * @property {number} authorshipsWithoutInstitution  所属が付いていない行数。**黙って捨てず UI に出す**
 * @property {number} coauthorsWithoutInstitution    一度も所属が取れなかった共著者数
 * @property {number} yearMin
 * @property {number} yearMax
 */

/**
 * @typedef {Object} Dataset
 * @property {SeedWork[]} works
 * @property {Map<string, Coauthor>} coauthors
 * @property {Map<string, Institution>} institutions
 * @property {CityNode[]} cities         paperCount の降順
 * @property {DatasetStats} stats
 * @property {string[]} warnings         UI にそのまま出せる日本語/英語キー
 */

/**
 * 手動の除外・追加・統合。`public/curation/<orcid>.json` に commit したもの、
 * localStorage の下書き、JSON 取り込みのいずれもこの形。
 * @typedef {Object} Curation
 * @property {string[]} excludeDois            小文字の DOI
 * @property {string[]} excludeAuthorIds       OpenAlex 著者 ID
 * @property {string[]} excludeInstitutionIds  OpenAlex 機関 ID
 * @property {string[]} addDois                手入力で足す DOI
 * @property {Object<string,string>} mergeInstitutions  統合元 ID → 統合先 ID
 */

/**
 * @typedef {Object} SeedSpec
 * @property {'orcid'|'researchmap'|'openalex'} kind
 * @property {string} value  ORCID なら `0000-0003-1317-0220`、researchmap なら permalink（`yk_frkw`）
 */

/**
 * @typedef {Object} BuildOptions
 * @property {SeedSpec[]} seeds
 * @property {Curation} [curation]
 * @property {number} [yearFrom]
 * @property {number} [yearTo]
 * @property {string} [mailto]        OpenAlex の polite pool 用
 * @property {typeof fetch} [fetchImpl]  テストで fixture に差し替えるための注入口
 * @property {(msg: string, done: number, total: number) => void} [onProgress]
 */

export {};
