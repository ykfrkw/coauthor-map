/**
 * ORCID の所属名を一括で引く層。
 *
 * `GET https://pub.orcid.org/v3.0/expanded-search/?rows=100&q=orcid:(A OR B ...)`
 * は認証不要・CORS 全開で、**1 リクエストで 50 人分まとめて**引ける。
 * 145 人でも 3 リクエストで済む。
 *
 * 返る `expanded-result[].institution-name` は**過去を含む全所属の配列**で、
 * どれが主所属かの指定は無い。だから主所属の決定では第一候補ではなく、
 * 「論文に印字された先頭の所属」で決まらなかった人の判定にだけ使う。
 *
 * **取得に失敗しても地図を壊さない。** 落ちたバッチは黙って諦めて、
 * 取れた分だけ返す（呼び手は所属名が無い前提で動ける）。
 */

const ORCID_BASE = 'https://pub.orcid.org/v3.0';

/** 1 リクエストに詰める ORCID の件数。実測でこの粒度なら 1 秒未満で返る。 */
export const AFFILIATION_BATCH_SIZE = 50;

/** `0000-0000-0000-000X`。末尾のみ数字または X。 */
const ORCID_PATTERN = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

/**
 * `https://orcid.org/0000-...` でも生の ID でも受けて、比較用のキーに直す。
 * 形式が合わなければ null。
 * @param {unknown} value
 * @returns {string|null}
 */
export function toOrcidKey(value) {
  if (typeof value !== 'string') return null;
  const id = value
    .trim()
    .toUpperCase()
    .replace(/^HTTPS?:\/\/(WWW\.)?ORCID\.ORG\//, '');
  return ORCID_PATTERN.test(id) ? id : null;
}

/**
 * 検索クエリを組む。`q` は丸ごとエンコードする（括弧を素で置いても通るが、
 * 生成側で揺らさないためにエンコードで統一する）。
 * @param {string[]} orcids
 * @returns {string}
 */
export function buildSearchUrl(orcids) {
  const query = `orcid:(${orcids.join(' OR ')})`;
  return `${ORCID_BASE}/expanded-search/?rows=100&q=${encodeURIComponent(query)}`;
}

/**
 * レスポンス本体 → `{ ORCID: 所属名[] }`。ネットワークを触らないので直接テストできる。
 * @param {any} payload
 * @returns {Record<string, string[]>}
 */
export function parseExpandedSearch(payload) {
  /** @type {Record<string, string[]>} */
  const out = {};
  const results = payload?.['expanded-result'];
  if (!Array.isArray(results)) return out;

  for (const entry of results) {
    const key = toOrcidKey(entry?.['orcid-id']);
    if (key === null) continue;
    const names = Array.isArray(entry?.['institution-name'])
      ? entry['institution-name']
          .filter((name) => typeof name === 'string' && name.trim())
          .map((name) => name.trim())
      : [];
    if (names.length === 0) continue;
    // 同じ ORCID が 2 度返ることは無いが、返っても和集合にする。
    out[key] = [...new Set([...(out[key] ?? []), ...names])];
  }
  return out;
}

/**
 * ORCID をまとめて引く。**直列**に流す（3 リクエスト程度なので並べる必要が無く、
 * 直列のほうが polite で、テストの fixture 順も決定的になる）。
 *
 * @param {string[]} orcids  重複・形式不正が混ざっていてよい
 * @param {{ fetchImpl?: typeof fetch, onProgress?: (key: string, done: number, total: number) => void }} [options]
 * @returns {Promise<Record<string, string[]>>} 取れた分だけ。全滅なら空オブジェクト
 */
export async function fetchOrcidAffiliations(orcids, options = {}) {
  const { fetchImpl = fetch, onProgress } = options;
  const ids = normalizeOrcidList(orcids);
  if (ids.length === 0) return {};

  const batches = [];
  for (let i = 0; i < ids.length; i += AFFILIATION_BATCH_SIZE)
    batches.push(ids.slice(i, i + AFFILIATION_BATCH_SIZE));

  /** @type {Record<string, string[]>} */
  const out = {};
  let done = 0;
  onProgress?.('orcid-affiliations', done, batches.length);

  for (const batch of batches) {
    try {
      const response = await fetchImpl(buildSearchUrl(batch), {
        headers: { Accept: 'application/json' },
      });
      if (response?.ok)
        Object.assign(out, parseExpandedSearch(await response.json()));
    } catch {
      // 1 バッチ落ちても他は使う。所属名は「あれば助かる」程度の補助情報。
    }
    done += 1;
    onProgress?.('orcid-affiliations', done, batches.length);
  }
  return out;
}

/**
 * 重複を落として昇順にそろえる。バッチの切れ目を入力の順序に依存させないため。
 * @param {unknown[]} values
 * @returns {string[]}
 */
export function normalizeOrcidList(values) {
  /** @type {Set<string>} */
  const set = new Set();
  for (const value of values ?? []) {
    const key = toOrcidKey(value);
    if (key !== null) set.add(key);
  }
  return [...set].sort();
}
