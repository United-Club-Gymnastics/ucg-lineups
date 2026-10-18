import { describe, expect, it } from 'vitest';
import {
  TNT_CAP, autoBalance, defaultOrder, inSquads, isSynchroOnly, mixedLevels, mixedText, moveAthlete, normalizeOrders, orderFor, primaryLevel,
  restoreTntSquads, rotationFor, sizeStatus, type TntAthlete,
} from '../../src/lib/tnt-squads';

let n = 0;
const mk = (clubName: string, levels: TntAthlete['levels'], over: Partial<TntAthlete> = {}): TntAthlete => {
  n++;
  const first = over.first ?? `F${String(n).padStart(3, '0')}`;
  return { id: `TNT_${clubName}_${first}_${over.last ?? 'Test'}`, first, last: 'Test', clubId: clubName.toLowerCase().replace(/\s+/g, '-'), clubName, independent: false, levels, ...over };
};
const all3 = (l: string): TntAthlete['levels'] => ({ TR: l, DM: l, TU: l });
const club = (name: string, k: number, l: string) => Array.from({ length: k }, () => mk(name, all3(l)));
const byIdOf = (xs: TntAthlete[]) => new Map(xs.map((a) => [a.id, a]));
const sizes = (s: string[][]) => s.map((x) => x.length);

describe('primaryLevel', () => {
  it('is the level on most of TR/DM/TU', () => {
    expect(primaryLevel({ levels: { TR: 'IF', DM: 'IF', TU: 'NF' } })).toBe('IF');
    expect(primaryLevel({ levels: { TR: 'NF', DM: 'HF', TU: 'HF' } })).toBe('HF');
  });
  it('a tie goes to the higher level', () => {
    expect(primaryLevel({ levels: { TR: 'NF', DM: 'IF' } })).toBe('IF');
    expect(primaryLevel({ levels: { TR: 'HF', DM: 'NF' } })).toBe('HF');
    expect(primaryLevel({ levels: { TR: 'IF', DM: 'HF', TU: 'NF' } })).toBe('HF');
  });
  it('ignores synchro and has no level without events', () => {
    expect(primaryLevel({ levels: { SY: 'HF', TR: 'NF' } })).toBe('NF');
    expect(primaryLevel({ levels: { SY: 'HF' } })).toBeUndefined();
  });
});

describe('rotation', () => {
  it('A TR>DM>TU, B DM>TU>TR, C TU>TR>DM', () => {
    expect([0, 1, 2].map((i) => rotationFor(i).join('>'))).toEqual(['TR>DM>TU', 'DM>TU>TR', 'TU>TR>DM']);
  });
});

describe('squad size flags', () => {
  it('ok to 12, high 13-15, over above 15', () => {
    expect([10, 12, 13, 15, 16].map(sizeStatus)).toEqual(['ok', 'ok', 'high', 'high', 'over']);
  });
});

describe('mixed levels (per event)', () => {
  it('lists only the events with more than one level, highest first', () => {
    const xs = [
      mk('A', { TR: 'HF', DM: 'IF', TU: 'NF' }), mk('B', { TR: 'IF', DM: 'IF', TU: 'NF' }), mk('C', { TR: 'HF', DM: 'NF', TU: 'NF' }),
    ];
    const m = mixedLevels(xs.map((a) => a.id), byIdOf(xs));
    expect(m).toEqual([{ event: 'TR', levels: ['HF', 'IF'] }, { event: 'DM', levels: ['IF', 'NF'] }]);
    expect(mixedText(m)).toBe('TR HF/IF · DM IF/NF');
  });
  it('is empty when each event has one level, and ignores people not entered on the event', () => {
    const xs = [mk('A', { TR: 'HF' }), mk('B', { TR: 'HF', DM: 'NF' }), mk('C', { DM: 'NF' })];
    expect(mixedLevels(xs.map((a) => a.id), byIdOf(xs))).toEqual([]);
  });
});

describe('synchro only', () => {
  it('is entered in SY and nothing else', () => {
    expect(isSynchroOnly(mk('A', { SY: 'IF' }))).toBe(true);
    expect(isSynchroOnly(mk('A', { SY: 'IF', TR: 'IF' }))).toBe(false);
    expect(inSquads(mk('A', { SY: 'IF' }))).toBe(false);
  });
});

describe('autoBalance', () => {
  it('never places synchro-only athletes and puts everyone else in exactly one squad', () => {
    const xs = [...club('Alpha', 6, 'NF'), ...club('Beta', 5, 'IF'), mk('Gamma', { SY: 'HF' }), mk('Gamma', { SY: 'NF' })];
    const s = autoBalance(xs);
    expect(s).toHaveLength(3);
    const placed = s.flat();
    expect(placed).toHaveLength(11);
    expect(new Set(placed).size).toBe(11);
    expect(placed.some((id) => xs.find((a) => a.id === id && isSynchroOnly(a)))).toBe(false);
  });

  it('keeps a club together and never goes over 15 when it can be avoided', () => {
    const xs = [...club('Alpha', 14, 'NF'), ...club('Beta', 12, 'IF'), ...club('Gamma', 9, 'HF')];
    const s = autoBalance(xs);
    for (const c of ['Alpha', 'Beta', 'Gamma']) {
      const where = new Set(s.map((ids, i) => (ids.some((id) => id.includes(`_${c}_`)) ? i : -1)).filter((i) => i >= 0));
      expect(where.size).toBe(1);
    }
    expect(Math.max(...sizes(s))).toBeLessThanOrEqual(TNT_CAP);
  });

  it('splits a club over 15 by level, near-equal pieces, never over 15', () => {
    const big = [...club('Big', 14, 'NF'), ...club('Big', 5, 'HF')]; // 19 athletes
    const xs = [...big, ...club('Small', 4, 'IF')];
    const s = autoBalance(xs);
    expect(Math.max(...sizes(s))).toBeLessThanOrEqual(TNT_CAP);
    const level = (id: string) => primaryLevel(byIdOf(xs).get(id)!);
    // each squad's Big athletes are a single level
    for (const ids of s) {
      const lv = new Set(ids.filter((id) => id.includes('_Big_')).map(level));
      expect(lv.size).toBeLessThanOrEqual(1);
    }
    expect(s.flat()).toHaveLength(23);
  });

  it('splits one big single-level club into pieces of near-equal size, not 12 + a tail', () => {
    const xs = club('Huge', 16, 'IF');
    const s = autoBalance(xs);
    expect(sizes(s).sort((a, b) => b - a)).toEqual([8, 8, 0]);
  });

  it('keeps levels together using the most common level, tie to the higher', () => {
    const nf = Array.from({ length: 4 }, () => mk('One', { TR: 'NF', DM: 'NF', TU: 'IF' })); // primary NF
    const hf = Array.from({ length: 4 }, () => mk('Two', { TR: 'HF', DM: 'NF' })); // tie -> HF
    const hf2 = Array.from({ length: 3 }, () => mk('Three', all3('HF')));
    const nf2 = Array.from({ length: 3 }, () => mk('Four', all3('NF')));
    const xs = [...nf, ...hf, ...hf2, ...nf2];
    const s = autoBalance(xs);
    const level = (id: string) => primaryLevel(byIdOf(xs).get(id)!);
    // no squad mixes primary levels (the NF-primary athletes with one IF event count as NF; the NF/HF tie counts as HF)
    for (const ids of s) expect(new Set(ids.map(level)).size).toBeLessThanOrEqual(1);
    expect(level(nf[0].id)).toBe('NF');
    expect(level(hf[0].id)).toBe('HF');
    expect(s.flat()).toHaveLength(14);
  });

  it('treats independents as units of one and keeps the squads even', () => {
    const xs = Array.from({ length: 9 }, (_, i) => mk('Independent', all3('NF'), { independent: true, clubId: 'independent', id: `TNT_ind_${i}` }));
    const s = autoBalance(xs);
    expect(sizes(s).sort()).toEqual([3, 3, 3]);
  });

  it('flags nothing by itself when more than 45 athletes force a squad over 15 (it still places everyone)', () => {
    const xs = [...club('A', 15, 'NF'), ...club('B', 15, 'IF'), ...club('C', 15, 'HF'), ...club('D', 2, 'NF')];
    const s = autoBalance(xs);
    expect(s.flat()).toHaveLength(47);
    expect(Math.max(...sizes(s))).toBeGreaterThan(TNT_CAP);
  });

  it('is deterministic', () => {
    const xs = [...club('Alpha', 7, 'NF'), ...club('Beta', 9, 'IF')];
    expect(autoBalance(xs)).toEqual(autoBalance(xs));
  });
});

describe('moveAthlete', () => {
  it('moves to the end of a squad or out to unplaced', () => {
    expect(moveAthlete([['a', 'b'], ['c'], []], 'a', 1)).toEqual([['b'], ['c', 'a'], []]);
    expect(moveAthlete([['a', 'b'], ['c'], []], 'c', null)).toEqual([['a', 'b'], [], []]);
  });
});

describe('default order', () => {
  it('is HF > IF > NF, then full club name A-Z, then first name, then last name', () => {
    const xs = [
      mk('Zed Club', { TR: 'NF' }, { first: 'Ann' }),
      mk('Alpha Club', { TR: 'IF' }, { first: 'Bob' }),
      mk('Alpha Club', { TR: 'IF' }, { first: 'Abe', last: 'Zz' }),
      mk('Alpha Club', { TR: 'IF' }, { first: 'Abe', last: 'Aa' }),
      mk('Beta Club', { TR: 'HF' }, { first: 'Cy' }),
      mk('Alpha Club', { TR: 'NF' }, { first: 'Dee' }),
    ];
    const ord = defaultOrder(xs.map((a) => a.id), 'TR', byIdOf(xs)).map((id) => byIdOf(xs).get(id)!);
    expect(ord.map((a) => `${a.levels.TR} ${a.clubName} ${a.first} ${a.last}`)).toEqual([
      'HF Beta Club Cy Test', 'IF Alpha Club Abe Aa', 'IF Alpha Club Abe Zz', 'IF Alpha Club Bob Test', 'NF Alpha Club Dee Test', 'NF Zed Club Ann Test',
    ]);
  });

  it('uses the level on that event and only includes athletes entered on it', () => {
    const a = mk('A', { TR: 'HF', DM: 'NF' }, { first: 'Hi' });
    const b = mk('A', { TR: 'NF', DM: 'HF' }, { first: 'Lo' });
    const c = mk('A', { TU: 'HF' }, { first: 'None' });
    const m = byIdOf([a, b, c]);
    expect(orderFor([a.id, b.id, c.id], 'TR', undefined, m)).toEqual([a.id, b.id]);
    expect(orderFor([a.id, b.id, c.id], 'DM', undefined, m)).toEqual([b.id, a.id]);
    expect(orderFor([a.id, b.id, c.id], 'TU', undefined, m)).toEqual([c.id]);
  });
});

describe('order reconcile', () => {
  const a = mk('A', { TR: 'HF' }, { first: 'A1' });
  const b = mk('A', { TR: 'HF' }, { first: 'A2' });
  const c = mk('A', { TR: 'IF' }, { first: 'A3' });
  const d = mk('A', { TR: 'NF' }, { first: 'A4' });
  const m = byIdOf([a, b, c, d]);

  it('keeps the saved order, drops people who left the squad or the event', () => {
    expect(orderFor([a.id, b.id, c.id], 'TR', [c.id, b.id, a.id, d.id], m)).toEqual([c.id, b.id, a.id]);
  });
  it('puts a newcomer at their default spot among the saved order', () => {
    // admin moved the IF first; the new NF goes after everyone who sorts before it, the new HF before the first IF/NF that follows
    const r = orderFor([a.id, b.id, c.id, d.id], 'TR', [c.id, a.id], m);
    expect(r).toEqual([b.id, c.id, a.id, d.id]);
    expect(r.indexOf(b.id)).toBeLessThan(r.indexOf(c.id)); // HF newcomer ahead of the first saved athlete that sorts after it
    expect(r.indexOf(d.id)).toBe(3); // NF newcomer goes last
  });
  it('without a saved order a newcomer is simply in default order', () => {
    expect(orderFor([d.id, c.id, b.id, a.id], 'TR', undefined, m)).toEqual([a.id, b.id, c.id, d.id]);
  });
  it('a saved default-equal order plus a newcomer is the default order', () => {
    expect(orderFor([a.id, b.id, c.id, d.id], 'TR', [a.id, c.id, d.id], m)).toEqual([a.id, b.id, c.id, d.id]);
  });
  it('normalizeOrders keeps only non-default orders, reconciled to the squads', () => {
    const squads = [[a.id, b.id, c.id], [d.id], []];
    const out = normalizeOrders(squads, { A_TR: [c.id, a.id, b.id, d.id], B_TR: [d.id], C_TR: [a.id], A_DM: [a.id] }, m);
    expect(out).toEqual({ A_TR: [c.id, a.id, b.id] });
  });
});

describe('restoreTntSquads', () => {
  const xs = [...club('Alpha', 3, 'NF'), ...club('Beta', 2, 'IF')];
  const describe_ = (id: string) => id;
  it('places nothing when nothing is saved', () => {
    const r = restoreTntSquads({ stored: null, eligible: xs, describe: describe_ });
    expect(r.squads.flat()).toEqual([]);
    expect(r.tray).toHaveLength(5);
    expect(r.changes).toEqual([]);
  });
  it('keeps saved squads, drops athletes who left, tray + notice for newcomers', () => {
    const [a1, a2, a3, b1, b2] = xs;
    const stored = {
      squads: [{ name: 'A', athleteIds: [a1.id, a2.id, 'TNT_gone_x'] }, { name: 'B', athleteIds: [b1.id] }, { name: 'C', athleteIds: [] }],
      trayAthleteIds: [a3.id],
    };
    // b2 is new (not known); a3 was deliberately unplaced
    const r = restoreTntSquads({ stored, eligible: xs, describe: describe_ });
    expect(r.squads).toEqual([[a1.id, a2.id], [b1.id], []]);
    expect(r.tray.sort()).toEqual([a3.id, b2.id].sort());
    expect(r.changes).toEqual([
      { kind: 'dropped', squad: 'Squad A', names: ['TNT_gone_x'] },
      { kind: 'added', names: [b2.id] },
    ]);
    expect(r.movedCount).toBe(2);
  });
  it('an athlete who became synchro-only drops out of the squad', () => {
    const [a1] = xs;
    const eligible = xs.filter((a) => a.id !== a1.id);
    const r = restoreTntSquads({ stored: { squads: [{ name: 'A', athleteIds: [a1.id] }, { name: 'B', athleteIds: [] }, { name: 'C', athleteIds: [] }], trayAthleteIds: [] }, eligible, describe: describe_ });
    expect(r.squads[0]).toEqual([]);
    expect(r.changes[0]).toMatchObject({ kind: 'dropped', squad: 'Squad A' });
  });
});
