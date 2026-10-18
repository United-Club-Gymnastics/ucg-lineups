// Copied from ucg-platform@32fb372 tests/lib/squad-builder.test.ts — keep in sync by hand
// Changed: header only (imports unchanged).
import { describe, it, expect } from 'vitest';
import {
  apparatusCodes, flightSize, groupCardLabel, routineCounts, overCapApparatus, squadRoutineCap,
  deriveClubGroupCards, wholeGroups, planFromSquads, planToSquads, squadOfMap, moveRegs,
  swapSquadGroups, startEventFor, squadCountFor, flightModeOf, flightRows, resizePlan,
  initialPlan, cardsUnplacedByResize, autoBalance, squadGuidance, placementChanges,
  type GroupReg, type PlanSquad, type ClubGroupCard,
  tntDefaultPlan, tntCopiedPlan, squadEligible,
} from '../../src/lib/squad-builder';

const WAG = ['VT', 'UB', 'BB', 'FX'];
const reg = (id: string, clubId: string, levelId: string, apparatus: string[] = WAG): GroupReg => ({ id, clubId, levelId, apparatus });
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('basics', () => {
  it('flight sizes, codes and caps follow APPARATUS order', () => {
    expect(flightSize('WAG')).toBe(4);
    expect(flightSize('MAG')).toBe(6);
    expect(apparatusCodes('WAG')).toEqual(WAG);
    expect(apparatusCodes('MAG')).toEqual(['FX', 'PH', 'SR', 'VT', 'PB', 'HB']);
    expect(squadRoutineCap('WAG')).toBe(12);
    expect(squadRoutineCap('MAG')).toBe(15);
    expect(squadCountFor('one', 'WAG')).toBe(4);
    expect(squadCountFor('two', 'WAG')).toBe(8);
    expect(squadCountFor('two', 'MAG')).toBe(12);
  });

  it('labels drop the group letter for a single group', () => {
    expect(groupCardLabel('ABC', 'Gold', 0, 1)).toBe('ABC · Gold');
    expect(groupCardLabel('ABC', 'Gold', 1, 2)).toBe('ABC · Gold · Group B');
  });

  it('counts routines per apparatus and flags over-cap totals in apparatus order', () => {
    const regs = [reg('a', 'c', 'l', ['VT', 'FX']), reg('b', 'c', 'l', ['VT'])];
    const byId = new Map(regs.map((r) => [r.id, r]));
    expect(routineCounts(['a', 'b', 'zz'], byId, WAG)).toEqual({ VT: 2, UB: 0, BB: 0, FX: 1 });
    expect(overCapApparatus({ VT: 13, UB: 12, BB: 0, FX: 14 }, 12, WAG)).toEqual(['VT', 'FX']);
  });
});

describe('deriveClubGroupCards', () => {
  it('no saved groups: one group of the session athletes per (club, level), split evenly over cap', () => {
    const sessionRegs = [...ids('a', 14).map((id) => reg(id, 'c1', 'L1')), ...ids('b', 3).map((id) => reg(id, 'c2', 'L1'))];
    const cards = deriveClubGroupCards({ discipline: 'WAG', sessionRegs, eventRegs: sessionRegs, savedGroups: [], squadOf: new Map() });
    expect(cards.map((c) => [c.clubId, c.groupIndex, c.regIds.length, c.groupCount])).toEqual([
      ['c1', 0, 7, 2], ['c1', 1, 7, 2], ['c2', 0, 3, 1],
    ]);
    expect(cards.every((c) => c.squadId === null && !c.fragment)).toBe(true);
    expect(cards[2].routines).toEqual({ VT: 3, UB: 3, BB: 3, FX: 3 });
  });

  it('no saved groups: splits the club\u2019s EVENT-WIDE level roster evenly, then narrows to the session', () => {
    // 14 at the level event-wide → Group A a0–a6, Group B a7–a13 (what the
    // club's Competition Order card shows); this session holds a3–a9.
    const eventRegs = ids('a', 14).map((id) => reg(id, 'c', 'L'));
    const sessionRegs = eventRegs.slice(3, 10);
    const cards = deriveClubGroupCards({ discipline: 'WAG', sessionRegs, eventRegs, savedGroups: [], squadOf: new Map() });
    expect(cards.map((c) => [c.groupIndex, c.regIds, c.groupCount])).toEqual([
      [0, ['a3', 'a4', 'a5', 'a6'], 2],
      [1, ['a7', 'a8', 'a9'], 2],
    ]);
  });

  it('independent athletes (no club) are never pooled: one card each, labelled by name', () => {
    const sessionRegs = [
      reg('i1', '', 'L', ['VT']), { ...reg('i2', '', 'L'), clubId: null }, reg('i3', '', 'L2'),
      reg('k0', 'club', 'L'), reg('k1', 'club', 'L'),
    ];
    const names: Record<string, string> = { i1: 'Zoe Z', i2: 'Amy A', i3: 'Bea B' };
    const cards = deriveClubGroupCards({
      discipline: 'WAG', sessionRegs, eventRegs: sessionRegs, savedGroups: [],
      squadOf: new Map([['i2', 's1']]),
      clubLabel: () => 'Club', independentLabel: (id) => names[id],
    });
    // Club card first, then independents by name.
    expect(cards.map((c) => c.regIds)).toEqual([['k0', 'k1'], ['i2'], ['i3'], ['i1']]);
    const indep = cards.filter((c) => c.independentRegId);
    expect(indep.map((c) => [c.independentRegId, c.clubId, c.groupCount, c.squadId])).toEqual([
      ['i2', '', 1, 's1'], ['i3', '', 1, null], ['i1', '', 1, null],
    ]);
    expect(new Set(cards.map((c) => c.key)).size).toBe(4);
    expect(cards[3].routines).toEqual({ VT: 1, UB: 0, BB: 0, FX: 0 });
    // wholeGroups keeps them separate.
    expect(wholeGroups(cards)).toHaveLength(4);
  });

  it('saved groups: narrowed to this session, refunded/moved athletes drop, new ones join per reconcileGroups', () => {
    // Club saved [x0,x1,x2] [x3,x4]. x1 refunded (not eligible), x4 moved to
    // another session, x5 newly registered in this session.
    const eventRegs = [reg('x0', 'c', 'L'), reg('x2', 'c', 'L'), reg('x3', 'c', 'L'), reg('x4', 'c', 'L'), reg('x5', 'c', 'L')];
    const sessionRegs = eventRegs.filter((r) => r.id !== 'x4');
    const cards = deriveClubGroupCards({
      discipline: 'WAG', sessionRegs, eventRegs,
      savedGroups: [{ clubId: 'c', levelId: 'L', groups: [['x0', 'x1', 'x2'], ['x3', 'x4']] }],
      squadOf: new Map(),
    });
    // x5 (new) goes to the FRONT of the first group with room (C-11).
    expect(cards.map((c) => [c.groupIndex, c.regIds])).toEqual([[0, ['x5', 'x0', 'x2']], [1, ['x3']]]);
    expect(cards[0].groupCount).toBe(2);
  });

  it('a group entirely in another session shows no card here but keeps letters', () => {
    const eventRegs = [reg('p', 'c', 'L'), reg('q', 'c', 'L')];
    const cards = deriveClubGroupCards({
      discipline: 'WAG', sessionRegs: [eventRegs[1]], eventRegs,
      savedGroups: [{ clubId: 'c', levelId: 'L', groups: [['p'], ['q']] }],
      squadOf: new Map(),
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].groupIndex).toBe(1);
    expect(cards[0].groupCount).toBe(2);
  });

  it('legacy split across squads → one card per (group, squad) fragment', () => {
    const sessionRegs = ids('a', 5).map((id) => reg(id, 'c', 'L'));
    const squadOf = new Map([['a0', 's1'], ['a1', 's2'], ['a2', 's1']]);
    const cards = deriveClubGroupCards({ discipline: 'WAG', sessionRegs, eventRegs: sessionRegs, savedGroups: [], squadOf });
    expect(cards.map((c) => [c.squadId, c.regIds])).toEqual([
      [null, ['a3', 'a4']], ['s1', ['a0', 'a2']], ['s2', ['a1']],
    ]);
    expect(cards.every((c) => c.fragment)).toBe(true);
    expect(new Set(cards.map((c) => c.key)).size).toBe(3);
    const whole = wholeGroups(cards);
    expect(whole).toHaveLength(1);
    expect([...whole[0].regIds].sort()).toEqual(ids('a', 5));
    expect(whole[0].routines.VT).toBe(5);
    expect(whole[0].squadId).toBeNull();
  });

  it('sorts by club label, then level rank, then group', () => {
    const sessionRegs = [reg('z', 'cz', 'L2'), reg('y', 'ca', 'L2'), reg('x', 'ca', 'L1')];
    const cards = deriveClubGroupCards({
      discipline: 'WAG', sessionRegs, eventRegs: sessionRegs, savedGroups: [], squadOf: new Map(),
      clubLabel: (id) => ({ ca: 'Alpha', cz: 'Zed' }[id] ?? id),
      levelRank: (id) => (id === 'L1' ? 1 : 2),
    });
    expect(cards.map((c) => c.regIds[0])).toEqual(['x', 'y', 'z']);
  });
});

describe('plan editing', () => {
  const plan = (): PlanSquad[] => [
    { id: 's1', name: 'Squad 1', startEvent: 0, regIds: ['a', 'b'] },
    { id: 's2', name: 'Squad 2', startEvent: 1, regIds: ['c'] },
    { id: 's3', name: 'Squad 3', startEvent: 2, regIds: [] },
  ];

  it('planFromSquads drops holding squads, ineligible and duplicate ids', () => {
    const p = planFromSquads([
      { id: 'h', name: 'Holding', startEvent: 0, athleteRegIds: ['a'], holding: true },
      { id: 's1', name: 'Squad A', startEvent: 0, athleteRegIds: ['a', 'gone'] },
      { id: 's2', name: 'Squad B', startEvent: 2, athleteRegIds: ['a', 'b'] },
    ], ['a', 'b']);
    expect(p).toEqual([
      { id: 's1', name: 'Squad A', startEvent: 0, regIds: ['a'] },
      { id: 's2', name: 'Squad B', startEvent: 2, regIds: ['b'] },
    ]);
    expect(planToSquads(p)[1]).toEqual({ id: 's2', name: 'Squad B', startEvent: 2, athleteRegIds: ['b'] });
    expect(squadOfMap(p)).toEqual(new Map([['a', 's1'], ['b', 's2']]));
  });

  it('moveRegs places into a squad, back to the tray, and ignores unknown squads', () => {
    expect(moveRegs(plan(), ['a', 'b'], 's3').map((q) => q.regIds)).toEqual([[], ['c'], ['a', 'b']]);
    expect(moveRegs(plan(), ['c'], null).map((q) => q.regIds)).toEqual([['a', 'b'], [], []]);
    expect(moveRegs(plan(), ['x'], 's2').map((q) => q.regIds)).toEqual([['a', 'b'], ['c', 'x'], []]);
    expect(moveRegs(plan(), ['a'], 'nope')).toEqual(plan());
  });

  it('swapSquadGroups trades every group; position, name and start event stay', () => {
    const next = swapSquadGroups(plan(), 's1', 's3');
    expect(next.map((q) => [q.id, q.name, q.startEvent, q.regIds])).toEqual([
      ['s1', 'Squad 1', 0, []], ['s2', 'Squad 2', 1, ['c']], ['s3', 'Squad 3', 2, ['a', 'b']],
    ]);
    expect(swapSquadGroups(plan(), 's1', 's1')).toEqual(plan());
    expect(swapSquadGroups(plan(), 's1', 'zz')).toEqual(plan());
  });
});

describe('placementChanges', () => {
  it('lists registrations whose squad differs from the plan, with the new squad', () => {
    const plan: PlanSquad[] = [{ id: 's1', name: 'Squad 1', startEvent: 0, regIds: ['a', 'b'] }];
    const regs = [
      { id: 'a', squadId: 's1' }, // unchanged
      { id: 'b', squadId: null }, // newly placed
      { id: 'c', squadId: 's9' }, // taken out (or a stale squad)
      { id: 'd' }, // never placed, still not
    ];
    expect(placementChanges(regs, plan)).toEqual([{ id: 'b', squadId: 's1' }, { id: 'c', squadId: null }]);
  });
});

describe('flights and resizing', () => {
  it('start events spread across the apparatus within each flight', () => {
    expect(Array.from({ length: 8 }, (_, i) => startEventFor(i, 'WAG'))).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(Array.from({ length: 12 }, (_, i) => startEventFor(i, 'MAG'))).toEqual([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]);
  });

  it('flight mode and rows', () => {
    expect(flightModeOf(4, 'WAG')).toBe('one');
    expect(flightModeOf(8, 'WAG')).toBe('two');
    expect(flightModeOf(3, 'WAG')).toBeNull();
    expect(flightModeOf(12, 'MAG')).toBe('two');
    expect(flightRows(8, 'WAG')).toEqual([[0, 1, 2, 3], [4, 5, 6, 7]]);
    expect(flightRows(4, 'WAG')).toEqual([[0, 1, 2, 3]]);
    expect(flightRows(3, 'WAG')).toEqual([[0, 1, 2]]);
  });

  it('initialPlan is one flight of empty squads', () => {
    expect(initialPlan('S', 'WAG')).toEqual([
      { id: 'S-q1', name: 'Squad 1', startEvent: 0, regIds: [] },
      { id: 'S-q2', name: 'Squad 2', startEvent: 1, regIds: [] },
      { id: 'S-q3', name: 'Squad 3', startEvent: 2, regIds: [] },
      { id: 'S-q4', name: 'Squad 4', startEvent: 3, regIds: [] },
    ]);
  });

  it('growing keeps existing squads (ids, placements) and adds flight B', () => {
    const start: PlanSquad[] = [
      { id: 'S-q2', name: 'Squad A', startEvent: 3, regIds: ['a'] },
      { id: 'legacy', name: 'Squad B', startEvent: 0, regIds: ['b'] },
    ];
    const { plan, unplacedRegIds } = resizePlan(start, 8, 'S', 'WAG');
    expect(unplacedRegIds).toEqual([]);
    expect(plan.map((q) => q.id)).toEqual(['S-q2', 'legacy', 'S-q1', 'S-q3', 'S-q4', 'S-q5', 'S-q6', 'S-q7']);
    expect(plan.map((q) => q.name)).toEqual(Array.from({ length: 8 }, (_, i) => `Squad ${i + 1}`));
    expect(plan.map((q) => q.startEvent)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(plan[0].regIds).toEqual(['a']);
    expect(plan[1].regIds).toEqual(['b']);
  });

  it('shrinking sends removed squads’ athletes to the tray', () => {
    const big = resizePlan([], 8, 'S', 'WAG').plan.map((q, i) => ({ ...q, regIds: [`r${i}`] }));
    const { plan, unplacedRegIds } = resizePlan(big, 4, 'S', 'WAG');
    expect(plan).toHaveLength(4);
    expect(plan.map((q) => q.regIds)).toEqual([['r0'], ['r1'], ['r2'], ['r3']]);
    expect(unplacedRegIds).toEqual(['r4', 'r5', 'r6', 'r7']);
  });

  it('cardsUnplacedByResize lists the cards in removed squads', () => {
    const plan = resizePlan([], 8, 'S', 'WAG').plan;
    const card = (key: string, squadId: string | null) => ({ key, squadId } as ClubGroupCard);
    const cards = [card('a', 'S-q1'), card('b', 'S-q6'), card('c', null)];
    expect(cardsUnplacedByResize(plan, 4, cards).map((c) => c.key)).toEqual(['b']);
    expect(cardsUnplacedByResize(plan, 8, cards)).toEqual([]);
  });
});

describe('autoBalance', () => {
  const group = (key: string, n: number, routines: Record<string, number>): ClubGroupCard => ({
    key, clubId: key, levelId: 'L', groupIndex: 0, groupCount: 1, squadId: null,
    regIds: ids(`${key}-`, n), routines, fragment: false,
  });

  it('places biggest groups first where the busiest apparatus total ends lowest', () => {
    const plan = initialPlan('S', 'WAG').slice(0, 2);
    const groups = [
      group('small', 3, { VT: 3, UB: 3, BB: 3, FX: 3 }),
      group('big', 10, { VT: 10, UB: 10, BB: 10, FX: 10 }),
      group('mid', 6, { VT: 6, UB: 6, BB: 6, FX: 6 }),
      group('vt', 4, { VT: 4, UB: 0, BB: 0, FX: 0 }),
    ];
    const next = autoBalance(groups, plan, WAG);
    // big → S1 (peak tie at 10, earliest); mid → S2 (6 < 16); vt → S2 (VT 10 < 14).
    const owner = (key: string) => next.findIndex((q) => q.regIds.includes(`${key}-0`));
    expect(owner('big')).toBe(0);
    expect(owner('mid')).toBe(1);
    expect(owner('vt')).toBe(1);
    // After big|mid+vt: S1 peak 10, S2 peak 10 (VT). small: S1 → 13, S2 → 13 (VT 13);
    // tie on peak → fewer athletes: S1 has 10, S2 has 10 → earliest (S1).
    expect(owner('small')).toBe(0);
    expect(next.map((q) => [q.id, q.name, q.startEvent])).toEqual(plan.map((q) => [q.id, q.name, q.startEvent]));
  });

  it('breaks peak ties by fewest athletes', () => {
    const plan = initialPlan('S', 'WAG').slice(0, 2);
    const groups = [
      group('a', 5, { VT: 5, UB: 0, BB: 0, FX: 0 }),
      group('b', 4, { VT: 0, UB: 5, BB: 0, FX: 0 }),
      group('c', 1, { VT: 0, UB: 0, BB: 0, FX: 0 }),
    ];
    const next = autoBalance(groups, plan, WAG);
    // a → S1; b → S2 (peak 5 vs 5 on S1 → tie, S2 has fewer athletes); c → S2 (tie peak 5, 4 < 5).
    expect(next[0].regIds).toEqual(ids('a-', 5));
    expect(next[1].regIds).toEqual([...ids('b-', 4), ...ids('c-', 1)]);
  });

  it('starts from empty squads (re-places everything) and handles no squads', () => {
    const plan: PlanSquad[] = [{ id: 's', name: 'Squad 1', startEvent: 0, regIds: ['old'] }];
    expect(autoBalance([group('g', 2, { VT: 2 })], plan, WAG)[0].regIds).toEqual(['g-0', 'g-1']);
    expect(autoBalance([group('g', 2, { VT: 2 })], [], WAG)).toEqual([]);
  });
});

describe('squadGuidance', () => {
  it('suggests two flights when one flight averages over ~11 per squad (mockup wording)', () => {
    expect(squadGuidance(79, 4, 'WAG')).toEqual({
      tone: 'warn',
      text: '79 athletes is more than 4 squads usually hold (about 40) — about 20 per squad. Switch to 8 squads in 2 flights.',
    });
  });

  it('stays informational at or under ~11 per squad', () => {
    expect(squadGuidance(44, 4, 'WAG').tone).toBe('info');
    expect(squadGuidance(44, 4, 'WAG').text).toBe('About 40 athletes fit one flight of 4 squads; about 85 fit two flights of 8.');
    expect(squadGuidance(85, 8, 'WAG').tone).toBe('info');
    expect(squadGuidance(0, 0, 'WAG').tone).toBe('info');
  });

  it('MAG scales to 6 / 12 squads (≈60 / ≈128)', () => {
    expect(squadGuidance(66, 6, 'MAG').tone).toBe('info');
    expect(squadGuidance(90, 6, 'MAG').text).toBe('90 athletes is more than 6 squads usually hold (about 60) — about 15 per squad. Switch to 12 squads in 2 flights.');
    expect(squadGuidance(150, 12, 'MAG').text).toBe('150 athletes is more than 12 squads usually hold (about 128) — about 13 per squad. Consider moving a level to another session.');
  });

  it('legacy counts scale the usual capacity', () => {
    expect(squadGuidance(60, 3, 'WAG').text).toBe('60 athletes is more than 3 squads usually hold (about 30) — about 20 per squad. Switch to 8 squads in 2 flights.');
  });
});

describe('T&T plans', () => {
  it('tntDefaultPlan: n squads, starts spread over the events, athletes dealt round-robin', () => {
    const plan = tntDefaultPlan('s1', 3, 4, ['r1', 'r2', 'r3', 'r4', 'r5']);
    expect(plan).toEqual([
      { id: 's1-q1', name: 'Squad A', startEvent: 0, regIds: ['r1', 'r4'] },
      { id: 's1-q2', name: 'Squad B', startEvent: 1, regIds: ['r2', 'r5'] },
      { id: 's1-q3', name: 'Squad C', startEvent: 2, regIds: ['r3'] },
    ]);
    expect(tntDefaultPlan('s1', 2, 4, []).map((q) => q.startEvent)).toEqual([0, 2]);
    expect(tntDefaultPlan('s1', 0, 0, ['r1'])).toEqual([{ id: 's1-q1', name: 'Squad A', startEvent: 0, regIds: ['r1'] }]);
  });

  it('tntCopiedPlan: same count and starts (holding squads ignored), this session\'s ids and athletes', () => {
    const template = [
      { id: 'h', name: 'Holding', startEvent: 3, athleteRegIds: ['x'], holding: true },
      { id: 'src-q1', name: 'Early', startEvent: 2, athleteRegIds: ['x1'] },
      { id: 'src-q2', name: 'Late', startEvent: 0, athleteRegIds: [] },
    ];
    expect(tntCopiedPlan('s2', template, ['a', 'b', 'c'])).toEqual([
      { id: 's2-q1', name: 'Squad A', startEvent: 2, regIds: ['a', 'c'] },
      { id: 's2-q2', name: 'Squad B', startEvent: 0, regIds: ['b'] },
    ]);
    expect(tntCopiedPlan('s2', [], ['a'])).toEqual([{ id: 's2-q1', name: 'Squad A', startEvent: 0, regIds: ['a'] }]);
  });
});

describe('squadEligible', () => {
  it('excludes refunded, waitlisted and fully scratched registrations (C-11: competesAtLevel)', () => {
    expect(squadEligible({ refunded: false, waitlisted: false, apparatus: ['VT'] })).toBe(true);
    expect(squadEligible({ apparatus: ['TR'] })).toBe(true);
    expect(squadEligible({ refunded: true, apparatus: ['VT'] })).toBe(false);
    expect(squadEligible({ waitlisted: true, apparatus: ['VT'] })).toBe(false);
    expect(squadEligible({ apparatus: [], withdrawnAt: '2026-10-01T00:00:00Z' })).toBe(false);
    expect(squadEligible({})).toBe(false);
  });
});

describe('per-apparatus cap in default groups (C-11)', () => {
  it('16 athletes split across apparatus stay ONE group (no apparatus over 12)', () => {
    const eventRegs = ids('m', 16).map((id, i) => reg(id, 'c', 'L', i < 8 ? ['VT', 'UB'] : ['BB', 'FX']));
    const cards = deriveClubGroupCards({ discipline: 'WAG', sessionRegs: eventRegs, eventRegs, savedGroups: [], squadOf: new Map() });
    expect(cards).toHaveLength(1);
    expect(cards[0].regIds).toHaveLength(16);
  });
});
