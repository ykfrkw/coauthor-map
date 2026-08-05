/**
 * `tests/fixtures/dataset-snapshot.json` を作り直す。
 *
 *   node tests/regenerate-snapshot.mjs
 *
 * snapshot は集計仕様の凍結であり、tests/pipeline.test.js の期待値そのもの。
 * 集計の規則を意図して変えたときだけ、この script で作り直して差分をレビューする。
 * ネットワークは触らない（tests/fixtures/ の記録済みレスポンスだけを読む）。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildDataset } from '../src/pipeline.js';
import {
  createFixtureFetch,
  serializeDataset,
  stripRor,
} from './helpers/stub-fetch.js';

const OUT = fileURLToPath(
  new URL('./fixtures/dataset-snapshot.json', import.meta.url),
);

const { fetchImpl } = createFixtureFetch();
const dataset = await buildDataset({
  // 実運用と同じ 2 seed。既定オプションで走らせる（統合も既定の ON）。
  seeds: [
    { kind: 'orcid', value: '0000-0003-1317-0220' },
    { kind: 'researchmap', value: 'yk_frkw' },
  ],
  mailto: 'test@example.org',
  fetchImpl,
  useCache: false,
});

// fixture が `ror` 列を持たない世代なので、比較と同じく落として書く。
// インデント 1 は既存ファイルに合わせる（差分を読める大きさに保つため）。
writeFileSync(
  OUT,
  JSON.stringify(stripRor(serializeDataset(dataset)), null, 1),
);

console.log(
  `wrote ${OUT}: ${dataset.stats.coauthors} co-authors ` +
    `(${dataset.stats.coauthorsMerged} records merged), ` +
    `${dataset.stats.cities} cities, ${dataset.stats.institutions} organizations`,
);
