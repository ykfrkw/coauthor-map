import { describe, expect, it } from 'vitest';

import { DEFAULT_GRAIN, parseGrain } from '../src/map/cluster.js';
import {
  DEFAULTS,
  readStateFromUrl,
  stateToQuery,
} from '../src/ui/controls.js';

describe('既定の粒度', () => {
  it('既定は 10px（0 だと欧州が団子になるため）', () => {
    expect(DEFAULT_GRAIN).toBe(10);
    expect(DEFAULTS.grain).toBe(10);
  });

  it('クエリ無しで開いたら grain は 10', () => {
    expect(readStateFromUrl('').grain).toBe(10);
  });

  it('grain=0 を指定すれば従来どおり都市単位に戻せる', () => {
    expect(parseGrain('0')).toBe(0);
    expect(readStateFromUrl('?grain=0').grain).toBe(0);
  });

  it('既定と同じ 10 は URL に書かず、0 は書く', () => {
    const base = { ...DEFAULTS, from: null, to: null };
    expect(stateToQuery({ ...base, grain: 10 })).not.toContain('grain');
    expect(stateToQuery({ ...base, grain: 0 })).toContain('grain=0');
    expect(stateToQuery({ ...base, grain: 'country' })).toContain(
      'grain=country',
    );
  });
});
