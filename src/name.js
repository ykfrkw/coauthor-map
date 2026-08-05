/**
 * 著者名の正規化。
 *
 * OpenAlex は同じ人物に対して表記の揺れた著者レコードを作る
 * （`Johannes Schneider-Thoma` / `Johannes Schneider Thoma`、
 * `Toshi A. Furukawa` / `Toshi A Furukawa` など）。
 * 氏名で名寄せするときの比較は必ずこの関数を通した値で行う。
 *
 * DOI に対する src/doi.js と同じ立ち位置の小さな純粋モジュール。
 * 規則を二重に持たないよう、氏名の正規化はここ以外に書かない。
 */

/**
 * Unicode 正規化 → 発音区別符号を落とす → 小文字化 → `.` を除去 →
 * `-` を空白に → 前後の空白を落とす → 連続空白を 1 つに。
 *
 * 非文字列・空文字は `''` を返す（`''` は名寄せのキーにしない）。
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeName(raw) {
  if (typeof raw !== 'string') return '';
  return (
    raw
      // NFKD で分解しないと `é` の発音区別符号を単体で落とせない。
      .normalize('NFKD')
      // \p{M} = 結合文字。NFKD で分離された発音区別符号がここで消える。
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/-/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
  );
}
