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
 * @property {string|null} ror     ROR の URL。表示・名寄せの手がかり。取れない機関もある
 */

/**
 * @typedef {Object} Coauthor
 * @property {string} id            OpenAlex の著者 ID
 * @property {string} name
 * @property {string|null} orcid
 * @property {string[]} institutionIds
 * @property {string[]} dois
 * @property {number} paperCount
 * @property {string[]} mergedIds  統合で吸収した他の著者 ID。代表自身は含めない。
 * 統合が無ければ空配列
 * @property {'orcid'|'name'|null} mergedBy  どの条件で統合されたか。
 * `'orcid'` = ORCID 一致、`'name'` = 氏名一致 + 非同居 + 機関の共有。統合が無ければ `null`
 * @property {string|null} primaryInstitutionId  主所属。**地図に置く点はここ 1 つだけ**。
 * 決められなければ `null`（所属不明として数える）
 * @property {'first-listed'|'orcid'|'fallback'|null} primaryBy  主所属をどの規則で決めたか。
 * `'first-listed'` = 論文に印字された先頭の所属、`'orcid'` = ORCID の所属名との一致、
 * `'fallback'` = 決め手が無いので機関 ID 昇順で決定的に選んだ
 * @property {boolean} primaryTypeFiltered  主所属を決める前に候補を勤務先らしい種別
 * （`education` / `healthcare`）へ絞り込んだか。研究コンソーシアム本部（`facility`）などが
 * 候補から外れて結論が変わりうる人だけ `true`。`afftype=off` なら常に `false`
 */

/**
 * 地図上のピン1つ。**機関ではなく都市**が単位（OpenAlex の geo が都市粒度のため、
 * 同一座標に複数機関が重なる。東京は 13 機関が同じ座標を持つ）。
 * 機関は union-find でまとめる。同一都市とみなすのは
 * (1) 小数第 2 位に丸めた座標が一致するか、
 * (2) 都市名が一致し（前後空白を除き大小無視）かつ大円距離が 100km 未満のとき。
 *
 * @typedef {Object} CityNode
 * @property {string} key           `${countryCode ?? country ?? '?'}|${city ?? '@lat,lng'}`
 * @property {number} lat           代表座標。**論文数では選ばない**（年フィルタで揺れると
 * @property {number} lng           d3 の join が壊れる）。グループ内で最も多くの機関が
 *                                  共有する丸め座標を採り、同数なら機関 ID 最小のもの
 * @property {string|null} city
 * @property {string|null} countryCode
 * @property {string|null} country
 * @property {Institution[]} institutions  論文数の多い順。既定（`pinMode: 'primary'`）では
 * **この都市を主所属とする共著者の主所属機関だけ**
 * @property {Coauthor[]} coauthors        論文数の多い順。既定では
 * **この都市を主所属とする人だけ**（1 人は必ず 1 都市にしか現れない）
 * @property {string[]} dois               既定では `coauthors` の DOI の和集合（重複なし）
 * @property {number} paperCount           `dois.length`
 * @property {number} coauthorCount        `coauthors.length`
 */

/**
 * @typedef {Object} DatasetStats
 * @property {number} seedWorks                  seed から得た DOI 件数（和集合・除外適用後）
 * @property {number} matchedWorks               OpenAlex で突合できた件数
 * @property {string[]} unmatchedDois            突合できなかった DOI
 * @property {number} coauthors                 統合後の共著者数
 * @property {number} coauthorsMerged            統合で吸収された著者レコード数（166→145 なら 21）
 * @property {number} institutions
 * @property {number} geoResolved                緯度経度が取れた機関数
 * @property {number} cities
 * @property {number} countries
 * @property {number} authorshipRows             著者×論文の行数（seed 本人を含む）
 * @property {number} authorshipsWithoutInstitution  所属が付いていない行数。**黙って捨てず UI に出す**
 * @property {number} coauthorsWithoutInstitution    主所属を決められなかった共著者数
 * @property {{firstListed: number, orcid: number, fallback: number, none: number}} primaryBy
 *   主所属をどの規則で決めたかの内訳（人数）
 * @property {number} primaryTypeFiltered  主所属の候補を勤務先らしい種別に絞り込んだ人数。
 *   `afftype=off` なら 0
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
 * @property {string[]} warnings         UI にそのまま出せる文言（US 英語）
 * @property {string[]} seedAuthorIds    seed 本人と判定した OpenAlex 著者 ID。
 * ORCID 一致で決める。ORCID が分からない seed では最多登場の著者 ID を 1 件返す。
 * 同一人物に著者レコードが複数ぶら下がることがあるので配列
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
 * @property {(key: string, done: number, total: number) => void} [onProgress]
 *   第1引数は**表示用の文字列ではなく安定キー**（ASCII・翻訳しない識別子）。
 *   データ層は文言を持たず、対応する英語は src/ui/i18n.js の `PROGRESS_STRINGS` が持つ。
 *   `buildDataset` が発火するのは次のキーだけ:
 *   `'seeds'`（seed 取得の開始・進行・完了。完了は `done === total`）、
 *   `` `seeds:${kind}` ``（`'seeds:orcid'` / `'seeds:researchmap'` / `'seeds:openalex'`）、
 *   `'works'`（OpenAlex の論文取得）、`'institutions'`（機関取得）、`'aggregate'`（集計）。
 *   受け手は未知のキーが来ても壊れないこと（`progressLabel` が汎用文言に落とす）。
 * @property {true|'orcid'|false} [mergeCoauthors]  OpenAlex の名寄せが分裂させた
 *   共著者レコードをまとめるか（既定 `true`）。`true` = ORCID 一致に加えて
 *   「氏名一致 + 同一論文に非同居 + 機関の共有」でもまとめる、`'orcid'` = ORCID 一致だけ、
 *   `false` = まとめない
 * @property {'primary'|'all'} [pinMode]  共著者を主所属の 1 都市だけに置くか（既定 `'primary'`）、
 *   旧来どおり所属した全都市に置くか（`'all'`）
 * @property {boolean} [useOrcidAffiliations]  ORCID の所属名を主所属の判定に使うか（既定 true）。
 *   true でも**必要なときしか取りに行かない**。先頭所属の規則で全員決まれば 1 本も投げず、
 *   決まらない人がいたときだけその人の分を引く。
 *   取得に失敗しても地図は壊さない（先頭所属の規則だけで決める）
 * @property {boolean} [preferOccupationalTypes]  主所属の候補を勤務先らしい種別
 *   （`education` / `healthcare`）へ絞ってから判定するか（既定 true）。
 *   URL の `afftype=off` で切る。研究コンソーシアム本部（`facility`）が主所属に選ばれるのを防ぐ
 * @property {boolean} [useCache]     sessionStorage の 24 時間キャッシュを使うか（既定 true）
 * @property {(ms: number) => Promise<void>} [sleepImpl]  リトライの待機。テストで実時間を消さないため
 * @property {number} [maxRetries]    429 / 5xx のリトライ上限（既定 3）
 */

export {};
