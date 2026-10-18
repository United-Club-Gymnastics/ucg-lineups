import { describe, expect, it } from 'vitest';
import { apparatusLookup } from '../../src/lib/competition-order';
import { rotationFor } from '../../src/lib/rotation';
import type { RotationPattern } from '../../src/lib/rotation';
import {
  autoBalance, buildCards, capacityGuide, cardLabel, clearPlan, emptyPlan, moveCard, planStats, placedKeys, reconcilePlan,
  sortKeys, squadSpecialists, squadStats, swapSquads, unplacedCards, type SquadCard,
} from '../../src/lib/squad-balance';
import type { GroupReg } from '../../src/lib/squad-builder';

const MAG_ALL = ['FX', 'PH', 'SR', 'VT', 'PB', 'HB'];
const WAG_ALL = ['VT', 'UB', 'BB', 'FX'];

const group = (clubId: string, levelId: string, n: number, apparatus: string[]): GroupReg[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${clubId}-${levelId}-${String(i).padStart(2, '0')}`, clubId: clubId || null, levelId, apparatus }));

const RANK: Record<string, number> = { Dev: 0, Int: 1, Adv: 2, XS: 0, XP: 1, XD: 2, L9: 3, Inf: 4 };
const levelRank = (l: string) => RANK[l] ?? 9;

function setup(discipline: 'MAG' | 'WAG', regs: GroupReg[], pattern: RotationPattern = 'one', saved = [] as { clubId: string; levelId: string; groups: string[][] }[]) {
  const sorted = [...regs].sort((a, b) => a.id.localeCompare(b.id));
  const clubLabel = (id: string) => `Club ${id}`;
  const cards = buildCards({ discipline, sessionRegs: sorted, savedGroups: saved, clubLabel, levelRank });
  const ctx = { discipline, apparatusOf: apparatusLookup(sorted), levelRank, clubLabel };
  const plan = autoBalance({ ...ctx, cards, pattern });
  const byKey = new Map(cards.map((c) => [c.key, c]));
  const stats = planStats(plan, byKey, discipline, levelRank);
  return { cards, ctx, plan, byKey, stats };
}

const squadLevels = (r: ReturnType<typeof setup>) => r.stats.map((s) => s.levels);

describe('auto-balance basics', () => {
  it('places every card exactly once, deterministically', () => {
    const regs = [
      ...group('a', 'Dev', 9, MAG_ALL), ...group('b', 'Dev', 7, MAG_ALL), ...group('c', 'Int', 12, MAG_ALL),
      ...group('d', 'Adv', 5, MAG_ALL), ...group('', 'Adv', 1, ['FX']),
    ];
    const r = setup('MAG', regs);
    const keys = r.plan.flatMap((s) => s.cardKeys);
    expect(keys.sort()).toEqual(r.cards.map((c) => c.key).sort());
    expect(new Set(keys).size).toBe(keys.length);
    expect(setup('MAG', regs).plan).toEqual(r.plan);
    expect(r.plan.map((s) => s.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('never goes over the per-apparatus cap when it can be avoided (MAG 15, WAG 12)', () => {
    const mag = setup('MAG', [
      ...group('a', 'Dev', 14, MAG_ALL), ...group('b', 'Dev', 14, MAG_ALL), ...group('c', 'Dev', 14, MAG_ALL),
      ...group('d', 'Int', 10, MAG_ALL), ...group('e', 'Int', 10, MAG_ALL), ...group('f', 'Adv', 8, MAG_ALL),
    ]);
    expect(mag.stats.every((s) => s.overCap.length === 0)).toBe(true);
    const wag = setup('WAG', [
      ...group('a', 'XS', 11, WAG_ALL), ...group('b', 'XS', 11, WAG_ALL), ...group('c', 'XP', 11, WAG_ALL), ...group('d', 'XP', 11, WAG_ALL),
    ]);
    expect(wag.stats.every((s) => s.overCap.length === 0 && s.athletes === 11)).toBe(true);
  });

  it('when the cap cannot be met, still places everything and flags it', () => {
    const r = setup('WAG', [...group('a', 'XS', 12, WAG_ALL), ...group('b', 'XS', 12, WAG_ALL), ...group('c', 'XS', 12, WAG_ALL), ...group('d', 'XS', 12, WAG_ALL), ...group('e', 'XS', 12, WAG_ALL)]);
    expect(r.plan.flatMap((s) => s.cardKeys)).toHaveLength(5);
    expect(r.stats.some((s) => s.overCap.length > 0)).toBe(true);
  });

  it('empty input gives empty squads', () => {
    const r = setup('WAG', []);
    expect(r.plan).toHaveLength(4);
    expect(r.plan.every((s) => s.cardKeys.length === 0)).toBe(true);
  });
});

describe('club together', () => {
  it('keeps a whole club in one squad when it fits', () => {
    const regs = [
      ...group('a', 'Dev', 5, MAG_ALL), ...group('a', 'Int', 5, MAG_ALL), ...group('a', 'Adv', 4, MAG_ALL),
      ...group('b', 'Dev', 10, MAG_ALL), ...group('c', 'Int', 10, MAG_ALL), ...group('d', 'Adv', 10, MAG_ALL),
    ];
    const r = setup('MAG', regs);
    const squadOfClub = (club: string) => new Set(r.plan.map((s, i) => (s.cardKeys.some((k) => r.byKey.get(k)!.clubId === club) ? i : -1)).filter((i) => i >= 0));
    expect(squadOfClub('a').size).toBe(1);
  });

  it('splits a club too big for one squad per level, each level a unit', () => {
    const regs = [
      ...group('big', 'Dev', 10, MAG_ALL), ...group('big', 'Int', 10, MAG_ALL), ...group('big', 'Adv', 10, MAG_ALL),
      ...group('x', 'Dev', 6, MAG_ALL), ...group('y', 'Int', 6, MAG_ALL),
    ];
    const r = setup('MAG', regs);
    const where = (level: string) => r.plan.findIndex((s) => s.cardKeys.some((k) => r.byKey.get(k)!.clubId === 'big' && r.byKey.get(k)!.levelId === level));
    const squads = ['Dev', 'Int', 'Adv'].map(where);
    expect(new Set(squads).size).toBe(3);
    // one level of a club never straddles squads
    for (const level of ['Dev', 'Int', 'Adv']) {
      const hits = r.plan.filter((s) => s.cardKeys.some((k) => r.byKey.get(k)!.clubId === 'big' && r.byKey.get(k)!.levelId === level));
      expect(hits).toHaveLength(1);
    }
  });

  it('a level over one squad goes group by group, each piece in its own squad within the cap', () => {
    const regs = [...group('big', 'Dev', 20, WAG_ALL), ...group('o1', 'Int', 2, WAG_ALL), ...group('o2', 'Adv', 2, WAG_ALL)];
    const r = setup('WAG', regs);
    const bigSquads = r.plan.map((s, i) => (s.cardKeys.some((k) => r.byKey.get(k)!.clubId === 'big') ? i : -1)).filter((i) => i >= 0);
    expect(bigSquads.length).toBe(2);
    expect(r.stats.every((s) => s.overCap.length === 0)).toBe(true);
  });

  it('a later piece of a club prefers a squad already holding that club, even if that mixes levels', () => {
    const regs = [...group('big', 'Dev', 20, MAG_ALL), ...group('big', 'Int', 4, MAG_ALL), ...group('o', 'Adv', 3, MAG_ALL)];
    const r = setup('MAG', regs);
    const intSquad = r.plan.findIndex((s) => s.cardKeys.some((k) => r.byKey.get(k)!.levelId === 'Int'));
    expect(r.plan[intSquad].cardKeys.some((k) => { const c = r.byKey.get(k)!; return c.clubId === 'big' && c.levelId === 'Dev'; })).toBe(true);
  });

  it('with saved groups, uses the club-chosen split', () => {
    const regs = group('a', 'Dev', 6, WAG_ALL);
    const ids = regs.map((x) => x.id);
    const r = setup('WAG', regs, 'one', [{ clubId: 'a', levelId: 'Dev', groups: [ids.slice(0, 2), ids.slice(2)] }]);
    expect(r.cards.map((c) => c.regIds.length).sort()).toEqual([2, 4]);
  });
});

describe('single level and Infinity', () => {
  it('keeps squads single-level where it can', () => {
    const regs = [
      ...group('a', 'XS', 10, WAG_ALL), ...group('b', 'XP', 10, WAG_ALL), ...group('c', 'XD', 10, WAG_ALL), ...group('d', 'L9', 10, WAG_ALL),
    ];
    const r = setup('WAG', regs);
    expect(squadLevels(r).every((l) => l.length === 1)).toBe(true);
  });

  it('Infinity never shares a squad with another level, even when a club has both', () => {
    const regs = [
      ...group('a', 'Inf', 4, WAG_ALL), ...group('a', 'L9', 5, WAG_ALL), // one club with Infinity and Level 9
      ...group('b', 'Inf', 3, WAG_ALL), ...group('c', 'L9', 8, WAG_ALL), ...group('d', 'XS', 9, WAG_ALL), ...group('e', 'XP', 7, WAG_ALL),
    ];
    for (const pattern of ['one', 'parallel', 'byes'] as const) {
      const r = setup('WAG', regs, pattern);
      for (const s of r.stats) if (s.levels.includes('Inf')) expect(s.levels).toEqual(['Inf']);
      expect(r.stats.every((s) => !s.infinityMixed)).toBe(true);
    }
  });

  it('keeps Infinity apart across many random sessions, without wasting squads on it', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    for (let t = 0; t < 60; t++) {
      const regs: GroupReg[] = [];
      const levels = ['XS', 'XP', 'XD', 'L9', 'Inf'];
      const clubs = 4 + Math.floor(rnd() * 8);
      for (let c = 0; c < clubs; c++) {
        for (const lv of levels) if (rnd() < 0.45) regs.push(...group(`c${c}`, lv, 1 + Math.floor(rnd() * 7), rnd() < 0.2 ? ['VT'] : WAG_ALL));
      }
      if (regs.length === 0) continue;
      const r = setup('WAG', regs, t % 2 ? 'byes' : 'parallel');
      for (const s of r.stats) if (s.levels.includes('Inf')) expect(s.levels).toEqual(['Inf']);
      expect(r.plan.flatMap((s) => s.cardKeys)).toHaveLength(r.cards.length);
    }
  });

  it('a lone small Infinity group takes one squad and the rest still get squads', () => {
    const regs = [...group('a', 'Inf', 2, WAG_ALL), ...group('b', 'XS', 10, WAG_ALL), ...group('c', 'XP', 10, WAG_ALL), ...group('d', 'XD', 10, WAG_ALL)];
    const r = setup('WAG', regs);
    expect(r.stats.filter((s) => s.levels.includes('Inf'))).toHaveLength(1);
    expect(r.stats.filter((s) => s.athletes > 0)).toHaveLength(4);
  });

  it('a manual mix is flagged, not blocked', () => {
    const r = setup('WAG', [...group('a', 'Inf', 2, WAG_ALL), ...group('b', 'L9', 3, WAG_ALL)]);
    const [inf, l9] = r.cards;
    const plan = moveCard(moveCard(emptyPlan('one', 'WAG'), inf.key, 0), l9.key, 0);
    const s = squadStats([inf, l9], 'WAG', levelRank);
    expect(plan[0].cardKeys).toHaveLength(2);
    expect(s).toMatchObject({ mixed: true, infinityMixed: true, levels: ['L9', 'Inf'] });
  });
});

describe('specialists and evening out', () => {
  it('a 1-2 apparatus athlete goes to the squad that reaches their apparatus first (one flight MAG)', () => {
    const regs = [...'abcdef'].flatMap((c) => group(c, 'Dev', 6, MAG_ALL));
    regs.push(...group('', 'Dev', 1, ['HB'])); // independent, High Bar only
    const r = setup('MAG', regs);
    const indep = r.cards.find((c) => c.independentRegId)!;
    const where = r.plan.findIndex((s) => s.cardKeys.includes(indep.key));
    expect(where).toBe(5); // squad F starts on High Bar
  });

  it('counts a bye as time lost (2024 pattern): picks the A squad that starts on the apparatus', () => {
    const regs = [...'abcdefgh'].flatMap((c) => group(c, 'XS', 6, WAG_ALL));
    regs.push(...group('', 'XS', 1, ['BB']));
    const r = setup('WAG', regs, 'byes');
    const indep = r.cards.find((c) => c.independentRegId)!;
    expect(r.plan.findIndex((s) => s.cardKeys.includes(indep.key))).toBe(4); // squad E: BB-A first
  });

  it('squadSpecialists reports the rotation they first compete', () => {
    const lookup = apparatusLookup([{ id: 'x', apparatus: ['BB'] }, { id: 'y', apparatus: WAG_ALL }, { id: 'z', apparatus: ['UB', 'FX'] }]);
    expect(squadSpecialists(['x', 'y', 'z'], lookup, 1, 'byes', 'WAG')).toEqual([
      { regId: 'x', apparatus: ['BB'], firstRotation: 4 },
      { regId: 'z', apparatus: ['UB', 'FX'], firstRotation: 3 },
    ]);
    expect(rotationFor(1, 'byes', 'WAG')[3]).toBe('BB-B');
  });

  it('evens out the busiest apparatus: 12 equal clubs in 6 squads is 2 each', () => {
    const regs = [...'abcdefghijkl'].flatMap((c) => group(c, 'Dev', 5, MAG_ALL));
    const r = setup('MAG', regs);
    expect(r.stats.map((s) => s.athletes)).toEqual([10, 10, 10, 10, 10, 10]);
  });
});

describe('squad listing order', () => {
  it('sortKeys: level, then club name, independents after clubs, then group', () => {
    const regs = [
      ...group('z', 'Dev', 1, ['VT']), ...group('', 'Dev', 1, ['VT']), ...group('b', 'Dev', 1, ['VT']),
      ...group('m', 'Int', 1, ['VT']), ...group('a', 'Int', 1, ['VT']), ...group('a', 'Adv', 1, ['VT']),
    ];
    const { cards, ctx } = setup('WAG', regs);
    const byKey = new Map(cards.map((c) => [c.key, c]));
    const shuffled = [...cards].reverse().map((c) => c.key);
    const labels = sortKeys(shuffled, byKey, ctx).map((k) => { const c = byKey.get(k)!; return `${c.levelId}:${c.clubId || 'indep'}`; });
    expect(labels).toEqual(['Dev:b', 'Dev:z', 'Dev:indep', 'Int:a', 'Int:m', 'Adv:a']);
  });

  it('autoBalance returns each squad already in that order', () => {
    const regs = [...group('z', 'Dev', 2, ['VT']), ...group('b', 'Dev', 2, ['VT']), ...group('a', 'Adv', 2, ['VT']), ...group('c', 'Int', 2, ['VT'])];
    const { plan, ctx, byKey } = setup('WAG', regs);
    for (const sq of plan) expect(sortKeys(sq.cardKeys, byKey, ctx)).toEqual(sq.cardKeys);
  });
});

describe('plan operations', () => {
  const cards = (): SquadCard[] => setup('WAG', [...group('a', 'XS', 2, WAG_ALL), ...group('b', 'XP', 2, WAG_ALL), ...group('c', 'XD', 2, WAG_ALL)]).cards;

  it('moveCard moves between squads and to the tray', () => {
    const [a, b] = cards();
    let plan = moveCard(emptyPlan('one', 'WAG'), a.key, 1);
    plan = moveCard(plan, b.key, 1);
    expect(plan[1].cardKeys).toEqual([a.key, b.key]);
    plan = moveCard(plan, a.key, 3);
    expect(plan[1].cardKeys).toEqual([b.key]);
    expect(plan[3].cardKeys).toEqual([a.key]);
    plan = moveCard(plan, a.key, null);
    expect([...placedKeys(plan)]).toEqual([b.key]);
    expect(moveCard(plan, b.key, 99)).toEqual(plan);
  });

  it('swapSquads trades all cards and leaves names; same or unknown index is a copy', () => {
    const [a, b, c] = cards();
    let plan = moveCard(moveCard(moveCard(emptyPlan('one', 'WAG'), a.key, 0), b.key, 0), c.key, 2);
    const swapped = swapSquads(plan, 0, 2);
    expect(swapped.map((s) => s.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(swapped[0].cardKeys).toEqual([c.key]);
    expect(swapped[2].cardKeys).toEqual([a.key, b.key]);
    expect(plan[0].cardKeys).toEqual([a.key, b.key]); // input untouched
    expect(swapSquads(plan, 1, 1)).toEqual(plan);
    expect(swapSquads(plan, 0, 9)).toEqual(plan);
    plan = swapSquads(swapped, 0, 2);
    expect(plan[0].cardKeys).toEqual([a.key, b.key]);
  });

  it('clearPlan and unplacedCards', () => {
    const cs = cards();
    const plan = moveCard(emptyPlan('one', 'WAG'), cs[0].key, 0);
    expect(unplacedCards(plan, cs).map((c) => c.key)).toEqual([cs[1].key, cs[2].key]);
    expect(clearPlan(plan).every((s) => s.cardKeys.length === 0)).toBe(true);
  });

  it('reconcilePlan drops unknown and duplicate keys and resizes to the pattern', () => {
    const stored = [{ cardKeys: ['k1', 'gone', 'k2'] }, { cardKeys: ['k2', 'k3'] }, { cardKeys: 'bad' }, { cardKeys: [] }, { cardKeys: ['k4'] }];
    const one = reconcilePlan(stored, 'one', 'WAG', ['k1', 'k2', 'k3', 'k4']);
    expect(one).toHaveLength(4);
    expect(one.map((s) => s.cardKeys)).toEqual([['k1', 'k2'], ['k3'], [], []]);
    const two = reconcilePlan(stored, 'parallel', 'WAG', ['k1', 'k2', 'k3', 'k4']);
    expect(two).toHaveLength(8);
    expect(two[4].cardKeys).toEqual(['k4']);
    expect(reconcilePlan(undefined, 'one', 'MAG', [])).toHaveLength(6);
  });
});

describe('stats, labels and capacity', () => {
  it('squadStats counts routines, flags over-cap and mixed levels', () => {
    const { cards } = setup('WAG', [...group('a', 'XS', 13, ['VT', 'UB']), ...group('b', 'XP', 2, ['VT'])]);
    const s = squadStats(cards, 'WAG', levelRank);
    expect(s.athletes).toBe(cards.reduce((t, c) => t + c.regIds.length, 0));
    expect(s.routines.VT).toBe(15);
    expect(s.overCap).toContain('VT');
    expect(s.mixed).toBe(true);
  });

  it('cardLabel', () => {
    const { cards } = setup('WAG', [...group('a', 'XS', 20, WAG_ALL), ...group('', 'XP', 1, WAG_ALL)]);
    const ctx = { clubLabel: (id: string) => `Club ${id}`, independentLabel: (id: string) => `Pat (${id.length})` };
    const labels = cards.map((c) => cardLabel(c, c.levelId, ctx));
    expect(labels.some((l) => l.startsWith('Club a – XS · Group A'))).toBe(true);
    expect(labels.some((l) => l.includes('(Independent) – XP'))).toBe(true);
  });

  it('capacity guide: MAG 80/160, WAG 40/85, warns above, never blocks', () => {
    expect(capacityGuide(80, 'one', 'MAG')).toMatchObject({ tone: 'info', fit: 80, squads: 6 });
    expect(capacityGuide(81, 'one', 'MAG')).toMatchObject({ tone: 'warn', fit: 80 });
    expect(capacityGuide(81, 'one', 'MAG').text).toContain('two flights');
    expect(capacityGuide(160, 'parallel', 'MAG')).toMatchObject({ tone: 'info', fit: 160, squads: 12 });
    expect(capacityGuide(161, 'byes', 'MAG').tone).toBe('warn');
    expect(capacityGuide(85, 'byes', 'WAG')).toMatchObject({ tone: 'info', fit: 85, squads: 8 });
    expect(capacityGuide(86, 'parallel', 'WAG').tone).toBe('warn');
    expect(capacityGuide(41, 'one', 'WAG').tone).toBe('warn');
    expect(capacityGuide(40, 'one', 'WAG').tone).toBe('info');
  });
});
