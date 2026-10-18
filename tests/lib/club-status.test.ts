import { describe, expect, it } from 'vitest';
import { levelStatus, sessionStatus } from '../../src/lib/club-status';
import { azIds, fromStored, resolveLevel, toStored } from '../../src/lib/club-order-model';
import type { LinkAthlete } from '../../src/lib/club-links';

const mk = (n: number, apparatus = ['VT', 'UB']): LinkAthlete[] =>
  Array.from({ length: n }, (_, i) => ({ id: `W${i}`, first: String.fromCharCode(65 + i), last: 'Test', apparatus }));

describe('resolveLevel', () => {
  it('defaults to A-Z by first then last name, whatever order the roster arrives in', () => {
    const r = resolveLevel('WAG', [
      { id: 'c', first: 'Cy', last: 'A', apparatus: ['VT'] },
      { id: 'a2', first: 'Ann', last: 'Zed', apparatus: ['VT'] },
      { id: 'a1', first: 'Ann', last: 'Able', apparatus: ['VT'] },
    ]);
    expect(r.groups).toEqual([['a1', 'a2', 'c']]);
    expect(r.sectionsBy.VT).toEqual([['a1', 'a2', 'c']]);
    expect(r.codes).toEqual(['VT']);
  });

  it('suggests an even split when over the cap, in A-Z runs', () => {
    const r = resolveLevel('WAG', mk(13));
    expect(r.groups.map((g) => g.length)).toEqual([7, 6]);
    expect(r.groups.flat()).toEqual(azIds(mk(13)));
  });

  it('keeps saved order and puts a newcomer first in a group with room', () => {
    const ath = mk(3);
    const r = resolveLevel('WAG', ath, { groups: [['W1', 'W0']], sections: { VT: [['W1', 'W0']], UB: [['W0', 'W1']] }, splitDecided: false });
    expect(r.groups).toEqual([['W2', 'W1', 'W0']]);
    expect(r.sectionsBy.VT).toEqual([['W2', 'W1', 'W0']]);
    expect(r.sectionsBy.UB).toEqual([['W2', 'W0', 'W1']]);
  });

  it('round-trips the stored shape and tolerates junk', () => {
    const o = { groups: [['a', 'b']], sections: { VT: [['b', 'a']] }, splitDecided: true };
    expect(fromStored(toStored(o))).toEqual(o);
    expect(toStored(o).groups).toEqual([{ ids: ['a', 'b'] }]);
    expect(fromStored(undefined)).toBeUndefined();
    expect(fromStored({ groups: 'x', sections: 5 })).toEqual({ groups: [], sections: {}, splitDecided: false });
  });
});

describe('levelStatus', () => {
  it('none: every apparatus has at most one athlete (also an empty level)', () => {
    expect(levelStatus('WAG', mk(1))).toBe('none');
    expect(levelStatus('WAG', [])).toBe('none');
    expect(levelStatus('WAG', [{ id: 'a', first: 'A', last: 'x', apparatus: ['VT'] }, { id: 'b', first: 'B', last: 'x', apparatus: ['UB'] }])).toBe('none');
  });

  it('default: nothing saved, or saved equal to the default', () => {
    expect(levelStatus('WAG', mk(5))).toBe('default');
    const r = resolveLevel('WAG', mk(5));
    expect(levelStatus('WAG', mk(5), { groups: r.groups, sections: r.sectionsBy, splitDecided: false })).toBe('default');
  });

  it('custom: a reordered apparatus list or different groups', () => {
    const r = resolveLevel('WAG', mk(5));
    const vt = [[...r.sectionsBy.VT[0]].reverse()];
    expect(levelStatus('WAG', mk(5), { groups: r.groups, sections: { ...r.sectionsBy, VT: vt }, splitDecided: false })).toBe('custom');
    expect(levelStatus('WAG', mk(5), { groups: [['W0'], ['W1', 'W2', 'W3', 'W4']], sections: {}, splitDecided: true })).toBe('custom');
  });

  it('split: over the cap and not decided; resolved by keeping the split', () => {
    expect(levelStatus('WAG', mk(13))).toBe('split');
    expect(levelStatus('MAG', mk(16, ['FX']))).toBe('split');
    expect(levelStatus('MAG', mk(15, ['FX']))).toBe('default');
    const r = resolveLevel('WAG', mk(13));
    expect(levelStatus('WAG', mk(13), { groups: r.groups, sections: r.sectionsBy, splitDecided: true })).toBe('default');
  });

  it('split is judged on the busiest apparatus, not athlete count', () => {
    const ath: LinkAthlete[] = mk(14).map((a, i) => ({ ...a, apparatus: i % 2 ? ['VT'] : ['UB'] }));
    expect(levelStatus('WAG', ath)).toBe('default');
  });

  it('a decided split that differs from the default is custom', () => {
    expect(levelStatus('WAG', mk(13), { groups: [['W0', 'W1', 'W2'], mk(13).slice(3).map((a) => a.id)], sections: {}, splitDecided: true })).toBe('custom');
  });
});

describe('sessionStatus', () => {
  it('rolls levels up: split > default > custom > none; T&T is tnt', () => {
    expect(sessionStatus('WAG', ['custom', 'split', 'default'])).toBe('split');
    expect(sessionStatus('WAG', ['custom', 'default', 'none'])).toBe('default');
    expect(sessionStatus('MAG', ['custom', 'none'])).toBe('custom');
    expect(sessionStatus('MAG', ['none', 'none'])).toBe('none');
    expect(sessionStatus('MAG', [])).toBe('none');
    expect(sessionStatus('TNT', ['split'])).toBe('tnt');
  });
});
