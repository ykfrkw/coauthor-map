/**
 * レビューモードの入口。
 *
 * 一番大事なのは「`?review=1` が無いときレビュー用のコードを 1 バイトも読まない」こと。
 * ここでは 2 つの角度から見張る:
 *  1. 起動判定 … ローダを差し替えて、呼ばれる / 呼ばれないを直接確かめる
 *  2. import グラフ … src/main.js から**静的に**辿れる範囲に mode.js が居ないこと
 *     （静的に辿れてしまうと Vite が通常のバンドルに畳み込む）
 */
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  startReviewIfRequested,
  wantsReview,
  withReviewParam,
} from '../src/review/gate.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `import ... from './x.js'` と `import './x.js'` だけを拾う。`import()` は拾わない */
const FROM_RE = /(?:^|[\s;})])from\s*['"]([^'"\n]+)['"]/g;
const BARE_RE = /^[ \t]*import\s+['"]([^'"\n]+)['"]/gm;

function staticSpecifiers(code) {
  const out = new Set();
  for (const re of [FROM_RE, BARE_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(code)) !== null) out.add(match[1]);
  }
  return [...out];
}

/** entry から静的 import だけを辿って到達できる .js の集合（repo ルートからの相対パス） */
function staticGraph(entry) {
  const seen = new Set();
  const queue = [resolve(ROOT, entry)];
  while (queue.length) {
    const file = queue.pop();
    const key = relative(ROOT, file);
    if (seen.has(key)) continue;
    seen.add(key);
    const code = readFileSync(file, 'utf8');
    for (const spec of staticSpecifiers(code)) {
      if (!spec.startsWith('.')) continue; // node_modules は追わない
      if (!spec.endsWith('.js')) continue; // CSS は import グラフの話ではない
      queue.push(resolve(dirname(file), spec));
    }
  }
  return seen;
}

describe('wantsReview', () => {
  it('?review=1 のときだけ真', () => {
    expect(wantsReview('?review=1')).toBe(true);
    expect(wantsReview('review=1')).toBe(true);
    expect(wantsReview('?orcid=0000-0003-1317-0220&review=1')).toBe(true);
    expect(wantsReview('?review=true')).toBe(true);
    expect(wantsReview('?review=on')).toBe(true);
  });

  it('無い・空・0 のときは偽', () => {
    expect(wantsReview('')).toBe(false);
    expect(wantsReview(undefined)).toBe(false);
    expect(wantsReview('?orcid=0000-0003-1317-0220')).toBe(false);
    expect(wantsReview('?review=')).toBe(false);
    expect(wantsReview('?review=0')).toBe(false);
    expect(wantsReview('?review=off')).toBe(false);
    // 別のパラメータの一部に review が含まれるだけでは起きない
    expect(wantsReview('?reviewer=1')).toBe(false);
  });
});

describe('withReviewParam', () => {
  const base = 'https://ykfrkw.github.io/coauthor-map/?orcid=1234&theme=dark';

  it('本体が書き戻す URL に review=1 を足す（リロードで切れないように）', () => {
    expect(withReviewParam('/coauthor-map/?orcid=1234', base)).toBe(
      '/coauthor-map/?orcid=1234&review=1',
    );
    expect(withReviewParam('/coauthor-map/', base)).toBe(
      '/coauthor-map/?review=1',
    );
  });

  it('既に付いていれば触らない。オリジンは付けない', () => {
    expect(withReviewParam('/coauthor-map/?review=1&theme=paper', base)).toBe(
      '/coauthor-map/?review=1&theme=paper',
    );
  });

  it('URL 省略時は今の URL を土台にする。hash も残す', () => {
    expect(withReviewParam(undefined, `${base}#h-map`)).toBe(
      '/coauthor-map/?orcid=1234&theme=dark&review=1#h-map',
    );
  });
});

describe('startReviewIfRequested', () => {
  it('?review=1 が無ければローダを呼ばない（チャンクを読まない）', async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return { startReviewMode: () => ({}) };
    };
    for (const search of ['', '?orcid=x', '?review=0', '?review=']) {
      expect(await startReviewIfRequested({ search, load })).toBeNull();
    }
    expect(calls).toBe(0);
  });

  it('?review=1 のときだけ 1 回読み込んで起動する', async () => {
    let calls = 0;
    const seen = [];
    const load = async () => {
      calls += 1;
      return {
        startReviewMode: (options) => {
          seen.push(options);
          return { ok: true };
        },
      };
    };
    const result = await startReviewIfRequested({
      search: '?review=1',
      page: 'widget',
      getState: () => ({ theme: 'dark' }),
      load,
    });
    expect(calls).toBe(1);
    expect(result).toEqual({ ok: true });
    expect(seen[0].page).toBe('widget');
    expect(seen[0].getState()).toEqual({ theme: 'dark' });
  });

  it('default export でも起動できる', async () => {
    const result = await startReviewIfRequested({
      search: '?review=1',
      load: async () => ({ default: () => ({ viaDefault: true }) }),
    });
    expect(result).toEqual({ viaDefault: true });
  });

  it('読み込みに失敗しても本体を巻き込まない', async () => {
    const result = await startReviewIfRequested({
      search: '?review=1',
      load: async () => {
        throw new Error('network');
      },
    });
    expect(result).toBeNull();
  });
});

describe('import グラフ', () => {
  const graph = staticGraph('src/main.js');

  it('main.js から gate.js までは静的に届く（配線されている）', () => {
    expect(graph).toContain('src/main.js');
    expect(graph).toContain('src/review/gate.js');
  });

  it('main.js から mode.js へは静的に辿れない（通常のバンドルに入らない）', () => {
    for (const file of [
      'src/review/mode.js',
      'src/review/anchor.js',
      'src/review/store.js',
      'src/review/markdown.js',
      'src/review/strings.js',
    ]) {
      expect([...graph]).not.toContain(file);
    }
  });

  it('gate.js は mode.js を動的 import でしか参照しない', () => {
    const code = readFileSync(resolve(ROOT, 'src/review/gate.js'), 'utf8');
    expect(code).toMatch(/import\(\s*'\.\/mode\.js'\s*\)/);
    expect(staticSpecifiers(code)).toEqual([]);
  });
});
