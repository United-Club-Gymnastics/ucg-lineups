// Copied from ucg-platform@32fb372 tests/competition-order.test.ts — keep in sync by hand
// Changed: header only (imports unchanged).
import { describe, it, expect } from 'vitest';
import {
  sectionCap, splitIntoSections, flattenSections, sectionsValid, moveInSections, computeDropIndex, dropLandingPosition,
  groupLetter, splitEvenly, groupsOverCap, reconcileGroups, sectionsFromGroups, moveAthleteToGroup, removeEmptyGroup,
  deriveGroupsFromOrders, backfillSectionsFromGroups,
  competesAtLevel, groupApparatusCounts, busiestApparatusCount, groupHasRoomFor,
} from '../src/lib/competition-order';

describe('sectionCap', () => {
  it('is 12 for WAG and 15 for MAG', () => {
    expect(sectionCap('WAG')).toBe(12);
    expect(sectionCap('MAG')).toBe(15);
  });
});

describe('splitIntoSections', () => {
  it('returns [] for an empty list', () => {
    expect(splitIntoSections([], 12)).toEqual([]);
  });

  it('chunks exactly at the cap boundary (WAG, 12)', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `r${i}`);
    expect(splitIntoSections(ids, 12)).toEqual([ids]);
  });

  it('splits into two sections one over the cap boundary (WAG, 13)', () => {
    const ids = Array.from({ length: 13 }, (_, i) => `r${i}`);
    const sections = splitIntoSections(ids, 12);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toHaveLength(12);
    expect(sections[1]).toEqual(['r12']);
  });

  it('chunks exactly at the cap boundary (MAG, 15)', () => {
    const ids = Array.from({ length: 15 }, (_, i) => `r${i}`);
    expect(splitIntoSections(ids, 15)).toEqual([ids]);
  });

  it('splits into two sections one over the cap boundary (MAG, 16)', () => {
    const ids = Array.from({ length: 16 }, (_, i) => `r${i}`);
    const sections = splitIntoSections(ids, 15);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toHaveLength(15);
    expect(sections[1]).toEqual(['r15']);
  });

  it('preserves order within and across sections', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    expect(splitIntoSections(ids, 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });
});

describe('flattenSections', () => {
  it('returns [] for no sections', () => {
    expect(flattenSections([])).toEqual([]);
  });

  it('concatenates sections back into one flat ordered list', () => {
    expect(flattenSections([['a', 'b'], ['c'], ['d', 'e']])).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('round-trips with splitIntoSections', () => {
    const ids = Array.from({ length: 27 }, (_, i) => `r${i}`);
    expect(flattenSections(splitIntoSections(ids, 12))).toEqual(ids);
  });
});

describe('sectionsValid', () => {
  it('is true for an empty sections array', () => {
    expect(sectionsValid([], 12)).toBe(true);
  });

  it('is true when every section is at or under the cap with no duplicates', () => {
    expect(sectionsValid([['a', 'b'], ['c', 'd', 'e']], 12)).toBe(true);
    expect(sectionsValid([Array.from({ length: 12 }, (_, i) => `r${i}`)], 12)).toBe(true);
  });

  it('is false when a section exceeds the cap by one', () => {
    expect(sectionsValid([Array.from({ length: 13 }, (_, i) => `r${i}`)], 12)).toBe(false);
  });

  it('is false when a registration id is duplicated across sections', () => {
    expect(sectionsValid([['a', 'b'], ['b', 'c']], 12)).toBe(false);
  });

  it('is false when a registration id is duplicated within one section', () => {
    expect(sectionsValid([['a', 'a']], 12)).toBe(false);
  });
});

describe('moveInSections', () => {
  it('moves an id from one section to another at a target index', () => {
    const sections = [['a', 'b'], ['c', 'd']];
    const result = moveInSections(sections, 'b', 1, 0);
    expect(result).toEqual([['a'], ['b', 'c', 'd']]);
  });

  it('reorders within the same section', () => {
    const sections = [['a', 'b', 'c']];
    const result = moveInSections(sections, 'c', 0, 0);
    expect(result).toEqual([['c', 'a', 'b']]);
  });

  it('inserts an id not previously present', () => {
    const sections = [['a', 'b']];
    const result = moveInSections(sections, 'z', 0, 1);
    expect(result).toEqual([['a', 'z', 'b']]);
  });

  it('creates a section when sections is empty', () => {
    expect(moveInSections([], 'a', 0, 0)).toEqual([['a']]);
  });

  it('clamps an out-of-range toSection to the last section', () => {
    const sections = [['a'], ['b']];
    const result = moveInSections(sections, 'a', 5, 0);
    expect(result).toEqual([[], ['a', 'b']]);
  });

  it('clamps a negative toSection to the first section', () => {
    const sections = [['a'], ['b']];
    const result = moveInSections(sections, 'b', -3, 0);
    expect(result).toEqual([['b', 'a'], []]);
  });

  it('clamps an out-of-range toIndex to the end of the target section', () => {
    const sections = [['a', 'b']];
    const result = moveInSections(sections, 'c', 0, 999);
    // c is new (not present anywhere), inserted at clamped end.
    // Note: 'c' isn't in the input, so nothing is removed first.
    expect(result).toEqual([['a', 'b', 'c']]);
  });

  it('does not mutate the input sections array', () => {
    const sections = [['a', 'b'], ['c']];
    const snapshot = sections.map((s) => [...s]);
    moveInSections(sections, 'a', 1, 0);
    expect(sections).toEqual(snapshot);
  });
});

describe('computeDropIndex + moveInSections (drag-down bug regression, T1)', () => {
  // Helper mirroring the component's onDragEnd wiring: resolve toIndex via
  // computeDropIndex, then apply it through moveInSections, same as
  // CompetitionOrderCard.onDragEnd.
  const drop = (sections: string[][], regId: string, toSection: number, overId: string, overIsContainer = false) => {
    const toIndex = computeDropIndex(sections, regId, toSection, overId, overIsContainer);
    return moveInSections(sections, regId, toSection, toIndex);
  };

  it('same-section DOWN drag actually moves the item (the reported bug)', () => {
    const sections = [['a', 'b', 'c']];
    // Drag 'a' down onto 'b'.
    expect(drop(sections, 'a', 0, 'b')).toEqual([['b', 'a', 'c']]);
  });

  it('same-section UP drag moves the item', () => {
    const sections = [['a', 'b', 'c']];
    // Drag 'c' up onto 'a'.
    expect(drop(sections, 'c', 0, 'a')).toEqual([['c', 'a', 'b']]);
  });

  it('adjacent swap DOWN (2-item section)', () => {
    const sections = [['a', 'b']];
    expect(drop(sections, 'a', 0, 'b')).toEqual([['b', 'a']]);
  });

  it('adjacent swap UP (2-item section)', () => {
    const sections = [['a', 'b']];
    expect(drop(sections, 'b', 0, 'a')).toEqual([['b', 'a']]);
  });

  it('cross-section move inserts before the hovered item', () => {
    const sections = [['a', 'b'], ['c', 'd']];
    // Drag 'a' from section 0 onto 'd' in section 1.
    expect(drop(sections, 'a', 1, 'd')).toEqual([['b'], ['c', 'a', 'd']]);
  });

  it('drop on a section container appends to the end', () => {
    const sections = [['a', 'b'], ['c']];
    // Drag 'a' from section 0 into the (empty-drop-target) container of section 1.
    expect(drop(sections, 'a', 1, 'co-sec-VT-1', true)).toEqual([['b'], ['c', 'a']]);
  });

  it('drop on a section container appends even when the section already has items', () => {
    const sections = [['a'], ['b', 'c']];
    expect(drop(sections, 'a', 1, 'co-sec-VT-1', true)).toEqual([[], ['b', 'c', 'a']]);
  });

  it('no-op drop on self (same id) leaves the section unchanged', () => {
    const sections = [['a', 'b', 'c']];
    // computeDropIndex called with overId === regId — mirrors what onDragEnd
    // would compute if it didn't early-return on overId === regId.
    expect(drop(sections, 'b', 0, 'b')).toEqual([['a', 'b', 'c']]);
  });
});

describe('dropLandingPosition (screen-reader announcements)', () => {
  const sections = [['A', 'B', 'C'], ['D']];
  it('same-section downward drag over B lands at position 2 of 3', () => {
    expect(dropLandingPosition(sections, 'A', 0, 'B', false)).toEqual({ position: 2, total: 3 });
  });
  it('cross-section drag over D lands before D', () => {
    expect(dropLandingPosition(sections, 'A', 1, 'D', false)).toEqual({ position: 1, total: 2 });
  });
  it('drop on a section container appends', () => {
    expect(dropLandingPosition(sections, 'B', 1, 'co-sec-VT-1', true)).toEqual({ position: 2, total: 2 });
  });
});

describe('groupLetter', () => {
  it('letters A..Z then numbers', () => {
    expect(groupLetter(0)).toBe('A');
    expect(groupLetter(1)).toBe('B');
    expect(groupLetter(25)).toBe('Z');
    expect(groupLetter(26)).toBe('27');
  });
});

// C-11 (2026-10-04): the cap is PER APPARATUS — helpers take an apparatus lookup.
const MAG6 = ['FX', 'PH', 'SR', 'VT', 'PB', 'HB'];
const onAll = (codes: string[]) => (): readonly string[] => codes;
const lookup = (m: Record<string, string[]>) => (id: string): readonly string[] => m[id] ?? [];
const allVT = onAll(['VT']);

describe('competesAtLevel', () => {
  it('only live rows with at least one apparatus compete', () => {
    expect(competesAtLevel({ apparatus: ['VT'] })).toBe(true);
    expect(competesAtLevel({ apparatus: ['VT'], refunded: true })).toBe(false);
    expect(competesAtLevel({ apparatus: ['VT'], waitlisted: true })).toBe(false);
    // Fully scratched: withdrawn after the edit deadline, apparatus blanked.
    expect(competesAtLevel({ apparatus: [], withdrawnAt: '2026-10-01T00:00:00Z' })).toBe(false);
    expect(competesAtLevel({ apparatus: [] })).toBe(false);
    // A partial scratch keeps the remaining apparatus.
    expect(competesAtLevel({ apparatus: ['FX'], withdrawnAt: '2026-10-01T00:00:00Z' })).toBe(true);
  });
});

describe('per-apparatus cap helpers', () => {
  const app = lookup({ a: ['VT', 'UB'], b: ['VT'], c: ['VT'], d: ['UB'] });
  it('groupApparatusCounts / busiestApparatusCount', () => {
    expect(groupApparatusCounts(['a', 'b', 'c', 'd'], app)).toEqual({ VT: 3, UB: 2 });
    expect(busiestApparatusCount(['a', 'b', 'c', 'd'], app)).toBe(3);
    expect(busiestApparatusCount([], app)).toBe(0);
  });
  it('a group is over cap when ANY apparatus exceeds it, regardless of group size', () => {
    expect(groupsOverCap([['a', 'b', 'c', 'd']], 3, app)).toBe(false); // 4 athletes, busiest 3
    expect(groupsOverCap([['a'], ['a', 'b', 'c', 'd']], 2, app)).toBe(true); // VT 3 > 2
  });
  it('room = every apparatus the athlete is on stays ≤ cap', () => {
    expect(groupHasRoomFor(['b', 'c'], 'd', 2, app)).toBe(true); // UB 0 → 1
    expect(groupHasRoomFor(['b', 'c'], 'a', 2, app)).toBe(false); // VT 2 → 3
  });
});

describe('splitEvenly', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);
  it('one empty group for no athletes', () => {
    expect(splitEvenly([], 12, allVT)).toEqual([[]]);
  });
  it('a single group up to the cap', () => {
    expect(splitEvenly(ids(12), 12, allVT)).toEqual([ids(12)]);
  });
  it('13 on one apparatus at cap 12 → 7 + 6 (fewest groups, balanced, input order kept in each)', () => {
    const g = splitEvenly(ids(13), 12, allVT);
    expect(g.map((x) => x.length)).toEqual([7, 6]);
    expect(g.flat().sort()).toEqual([...ids(13)].sort());
    for (const grp of g) expect([...grp].sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)))).toEqual(grp);
  });
  it('31 at cap 15 → 11 + 10 + 10', () => {
    expect(splitEvenly(ids(31), 15, allVT).map((x) => x.length)).toEqual([11, 10, 10]);
  });
  it('cap <= 0 degrades to one per group', () => {
    expect(splitEvenly(['a', 'b'], 0, allVT)).toEqual([['a'], ['b']]);
  });
  it('the cap is per apparatus: 20 athletes split across apparatus fit in ONE group', () => {
    const m: Record<string, string[]> = {};
    ids(20).forEach((id, i) => { m[id] = [i < 10 ? 'FX' : 'PH']; });
    expect(splitEvenly(ids(20), 15, lookup(m))).toEqual([ids(20)]);
  });
  it('fewest groups so every apparatus ≤ cap, with per-apparatus counts balanced', () => {
    // 12 on VT only + 12 on all four WAG apparatus: VT has 24 → 2 groups at cap 12.
    const m: Record<string, string[]> = {};
    ids(24).forEach((id, i) => { m[id] = i < 12 ? ['VT'] : ['VT', 'UB', 'BB', 'FX']; });
    const g = splitEvenly(ids(24), 12, lookup(m));
    expect(g).toHaveLength(2);
    for (const grp of g) expect(groupApparatusCounts(grp, lookup(m))).toEqual({ VT: 12, UB: 6, BB: 6, FX: 6 });
  });
});

describe('reconcileGroups', () => {
  it('seeds evenly when nothing is saved', () => {
    expect(reconcileGroups(undefined, ['a', 'b', 'c'], 2, allVT).map((g) => g.length)).toEqual([2, 1]);
    expect(reconcileGroups([], [], 12, allVT)).toEqual([[]]);
  });
  it('keeps membership exactly when the eligible set is unchanged', () => {
    expect(reconcileGroups([['c', 'a'], ['b']], ['a', 'b', 'c'], 12, allVT)).toEqual([['c', 'a'], ['b']]);
  });
  it('drops ineligible ids and duplicates, keeps empty groups', () => {
    expect(reconcileGroups([['a', 'x'], ['a', 'b'], []], ['a', 'b'], 12, allVT)).toEqual([['a'], ['b'], []]);
  });
  it('newcomers go to the FRONT of the first group with room', () => {
    expect(reconcileGroups([['a', 'b'], ['c']], ['a', 'b', 'c', 'd'], 2, allVT)).toEqual([['a', 'b'], ['d', 'c']]);
  });
  it('several newcomers keep their order at the front', () => {
    expect(reconcileGroups([['a']], ['a', 'n1', 'n2'], 12, allVT)).toEqual([['n1', 'n2', 'a']]);
  });
  it('room is per apparatus: a newcomer on a quiet apparatus joins a group full elsewhere', () => {
    const app = lookup({ a: ['VT'], b: ['VT'], n: ['UB'] });
    expect(reconcileGroups([['a', 'b']], ['a', 'b', 'n'], 2, app)).toEqual([['n', 'a', 'b']]);
  });
  it('opens a new group when no group has room', () => {
    expect(reconcileGroups([['a', 'b']], ['a', 'b', 'c', 'd', 'e'], 2, allVT)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });
  it('never moves an athlete out of an over-cap group', () => {
    expect(reconcileGroups([['a', 'b', 'c']], ['a', 'b', 'c'], 2, allVT)).toEqual([['a', 'b', 'c']]);
  });
});

describe('newcomers first on EVERY apparatus (C-11 regression)', () => {
  it('level with saved order rows only for FX and PH: two newcomers lead all six apparatus', () => {
    const old = ['a', 'b', 'c'];
    const groups = reconcileGroups([old], [...old, 'n1', 'n2'], 15, onAll(MAG6));
    const saved: Record<string, string[][]> = { FX: [['c', 'b', 'a']], PH: [['b', 'a', 'c']] };
    for (const code of MAG6) {
      const [section] = sectionsFromGroups(groups, [...old, 'n1', 'n2'], saved[code]);
      expect(section.slice(0, 2)).toEqual(['n1', 'n2']);
      expect(section).toHaveLength(5);
    }
    // Saved orders are kept below the newcomers.
    expect(sectionsFromGroups(groups, [...old, 'n1', 'n2'], saved.FX)[0]).toEqual(['n1', 'n2', 'c', 'b', 'a']);
  });
  it('an athlete moved with "→ A" leads every apparatus of the new group, saved row or not', () => {
    const groups = moveAthleteToGroup([['a', 'b'], ['m', 'c']], 'm', 0);
    expect(groups[0][0]).toBe('m');
    for (const saved of [[['b', 'a'], ['c', 'm']], undefined]) {
      expect(sectionsFromGroups(groups, ['a', 'b', 'c', 'm'], saved)[0][0]).toBe('m');
    }
  });
});

describe('sectionsFromGroups', () => {
  it('one section per group, filtered to the apparatus', () => {
    expect(sectionsFromGroups([['a', 'b'], ['c', 'd']], ['a', 'c', 'd'], undefined)).toEqual([['a'], ['c', 'd']]);
  });
  it('keeps the existing order within each group', () => {
    expect(sectionsFromGroups([['a', 'b', 'c']], ['a', 'b', 'c'], [['c', 'a', 'b']])).toEqual([['c', 'a', 'b']]);
  });
  it('athletes new to the list go first', () => {
    expect(sectionsFromGroups([['a', 'b', 'c', 'd']], ['a', 'b', 'c', 'd'], [['c', 'a']])).toEqual([['b', 'd', 'c', 'a']]);
  });
  it('an athlete moved to another group goes first there and leaves the old section', () => {
    const groups = moveAthleteToGroup([['a', 'b'], ['c', 'd']], 'b', 1);
    expect(sectionsFromGroups(groups, ['a', 'b', 'c', 'd'], [['b', 'a'], ['d', 'c']])).toEqual([['a'], ['b', 'd', 'c']]);
  });
  it('drops athletes no longer on the apparatus; empty groups give empty sections', () => {
    expect(sectionsFromGroups([['a', 'b'], []], ['b'], [['a', 'b'], []])).toEqual([['b'], []]);
  });
  it('same athletes on every apparatus: section k only ever holds group k', () => {
    const groups = [['a', 'b'], ['c']];
    for (const app of [['a', 'b', 'c'], ['a', 'c'], ['b']]) {
      const secs = sectionsFromGroups(groups, app, [['c', 'b', 'a']]);
      secs.forEach((sec, k) => sec.forEach((id) => expect(groups[k]).toContain(id)));
    }
  });
});

describe('moveAthleteToGroup / removeEmptyGroup', () => {
  it('moves to the FRONT of the target group', () => {
    expect(moveAthleteToGroup([['a', 'b'], ['c']], 'a', 1)).toEqual([['b'], ['a', 'c']]);
  });
  it('no-op for unknown id, same group or out of range', () => {
    expect(moveAthleteToGroup([['a'], ['b']], 'z', 1)).toEqual([['a'], ['b']]);
    expect(moveAthleteToGroup([['a'], ['b']], 'a', 0)).toEqual([['a'], ['b']]);
    expect(moveAthleteToGroup([['a'], ['b']], 'a', 5)).toEqual([['a'], ['b']]);
  });
  it('removes only an empty, non-last group', () => {
    expect(removeEmptyGroup([['a'], [], ['b']], 1)).toEqual([['a'], ['b']]);
    expect(removeEmptyGroup([['a'], ['b']], 1)).toBeNull();
    expect(removeEmptyGroup([[]], 0)).toBeNull();
  });
});

describe('backfill mirror (migration 20261004150000)', () => {
  const WAG = ['VT', 'UB', 'BB', 'FX'];
  it('groups come from the first apparatus in discipline order, not row order', () => {
    const orders = [
      { apparatus: 'FX', sections: [['c', 'b', 'a']] },
      { apparatus: 'UB', sections: [['a'], ['b', 'c']] },
    ];
    expect(deriveGroupsFromOrders(orders, WAG, ['a', 'b', 'c'])).toEqual([['a'], ['b', 'c']]);
  });
  it('drops ids no longer valid, keeps empty groups, appends unplaced to the LAST group', () => {
    const orders = [{ apparatus: 'VT', sections: [['a', 'gone'], ['gone2'], ['b']] }];
    expect(deriveGroupsFromOrders(orders, WAG, ['a', 'b', 'n1', 'n2'])).toEqual([['a'], [], ['b', 'n1', 'n2']]);
  });
  it('a source row with no sections yields one group of everyone', () => {
    expect(deriveGroupsFromOrders([{ apparatus: 'VT', sections: [] }], WAG, ['a', 'b'])).toEqual([['a', 'b']]);
  });
  it('unknown apparatus codes sort after known ones', () => {
    const orders = [{ apparatus: 'ZZ', sections: [['b', 'a']] }, { apparatus: 'BB', sections: [['a', 'b']] }];
    expect(deriveGroupsFromOrders(orders, WAG, ['a', 'b'])).toEqual([['a', 'b']]);
  });
  it('rewrites another apparatus by its OLD flattened order, unplaced at the end of their group', () => {
    const groups = [['a', 'b'], ['c', 'd', 'e']];
    // Old FX split independently: [[d, b], [a, c]] → flat order d, b, a, c; e never listed.
    expect(backfillSectionsFromGroups(groups, ['a', 'b', 'c', 'd', 'e'], [['d', 'b'], ['a', 'c']]))
      .toEqual([['b', 'a'], ['d', 'c', 'e']]);
  });
  it('the source apparatus round-trips to the groups themselves (minus off-apparatus athletes)', () => {
    const orders = [{ apparatus: 'VT', sections: [['a', 'b'], ['c']] }];
    const groups = deriveGroupsFromOrders(orders, WAG, ['a', 'b', 'c', 'n']);
    expect(groups).toEqual([['a', 'b'], ['c', 'n']]);
    expect(backfillSectionsFromGroups(groups, ['a', 'c', 'n'], orders[0].sections)).toEqual([['a'], ['c', 'n']]);
  });
});
