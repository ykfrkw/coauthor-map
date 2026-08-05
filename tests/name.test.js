import { describe, expect, it } from 'vitest';

import { normalizeName } from '../src/name.js';

describe('normalizeName', () => {
  it('大小と前後空白を無視する', () => {
    expect(normalizeName('  Stefan Leucht ')).toBe('stefan leucht');
    expect(normalizeName('STEFAN LEUCHT')).toBe('stefan leucht');
  });

  it('発音区別符号を落とす', () => {
    expect(normalizeName('Céline Dumas')).toBe('celine dumas');
    expect(normalizeName('Jörg Müller')).toBe('jorg muller');
    // 合成済みの文字と分解済みの文字が同じ値になる。
    expect(normalizeName('Céline')).toBe(normalizeName('Céline'));
  });

  it('ピリオドを消し、ハイフンを空白にする', () => {
    expect(normalizeName('Toshi A. Furukawa')).toBe('toshi a furukawa');
    expect(normalizeName('Toshi A Furukawa')).toBe('toshi a furukawa');
    expect(normalizeName('Johannes Schneider-Thoma')).toBe(
      'johannes schneider thoma',
    );
  });

  it('連続空白を 1 つにたたむ', () => {
    expect(normalizeName('Pim   Cuijpers')).toBe('pim cuijpers');
    expect(normalizeName('Pim\tCuijpers')).toBe('pim cuijpers');
  });

  it('全角も半角にそろえる（NFKD）', () => {
    expect(normalizeName('Ｐｉｍ　Ｃｕｉｊｐｅｒｓ')).toBe('pim cuijpers');
  });

  it('別人の名前は別の値になる', () => {
    expect(normalizeName('Yan Luo')).not.toBe(normalizeName('Yang Luo'));
  });

  it('非文字列・空文字は空文字（名寄せのキーにしない）', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName(42)).toBe('');
    expect(normalizeName('   ')).toBe('');
  });
});
