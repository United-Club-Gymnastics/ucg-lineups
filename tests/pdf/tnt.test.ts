import { describe, expect, it } from 'vitest';
import { synchroPages, SYNCHRO_PAIRS_PER_PAGE } from '../../src/lib/pdf/synchro-sheet-content';
import { byClubThenName, tntRotationPages, TNT_ROTATION_PAGE_UNITS } from '../../src/lib/pdf/tnt-rotation-content';
import { arrivalAt, paginate, PASS_COLUMNS, TNT_BLANKS, tntScorecardPages, TR_COLUMNS } from '../../src/lib/pdf/tnt-scorecards-content';
import type { TntPerson, TntSessionInput } from '../../src/lib/pdf/session-input';

const MEET = { name: 'Test Nationals', date: 'Oct 22–25, 2026' };
const person = (name: string, club: string, levels: TntPerson['levels'], independent = false): TntPerson => ({ id: `${club}-${name}`, name, clubName: club, independent, levels });
const all = (n: number, level = 'IF', prefix = 'P'): TntPerson[] => Array.from({ length: n }, (_, i) => person(`${prefix}${String(i).padStart(2, '0')}`, 'Club', { TR: level, DM: level, TU: level }));

function input(squads: TntPerson[][], extra: Partial<TntSessionInput> = {}): TntSessionInput {
  return {
    meet: MEET, session: { name: 'Session 1', location: 'Purple', levelCodes: ['NF', 'IF', 'HF'] }, competitionTime: '', synchroOnly: [], flights: [], unplaced: 0, noSquads: false, pairsMissing: false,
    squads: [0, 1, 2].map((i) => ({
      index: i, letter: 'ABC'[i], athletes: squads[i] ?? [],
      order: { TR: (squads[i] ?? []).filter((p) => p.levels.TR), DM: (squads[i] ?? []).filter((p) => p.levels.DM), TU: (squads[i] ?? []).filter((p) => p.levels.TU) },
    })),
    ...extra,
  };
}

describe('paginate (10 rows a page, 5 blanks together on the last page with an athlete above them)', () => {
  it('holds for every list length', () => {
    for (let n = 0; n <= 60; n++) {
      const list = Array.from({ length: n }, (_, i) => i);
      const pages = paginate(list);
      if (n === 0) { expect(pages).toEqual([]); continue; }
      const last = pages[pages.length - 1];
      expect(pages.flat().filter((x) => x !== null)).toEqual(list); // saved order, nobody lost
      expect(last.filter((x) => x === null)).toHaveLength(TNT_BLANKS);
      expect(last.slice(-TNT_BLANKS).every((x) => x === null)).toBe(true);
      expect(last.some((x) => x !== null)).toBe(true); // never a page of only blanks
      expect(pages.slice(0, -1).every((p) => p.every((x) => x !== null))).toBe(true); // blanks only on the last page
      expect(pages.every((p) => p.length <= 10)).toBe(true);
    }
  });
  it('examples', () => {
    expect(paginate(Array.from({ length: 4 }, (_, i) => i)).map((p) => p.length)).toEqual([9]);
    expect(paginate(Array.from({ length: 5 }, (_, i) => i)).map((p) => p.length)).toEqual([10]);
    expect(paginate(Array.from({ length: 6 }, (_, i) => i)).map((p) => p.length)).toEqual([5, 1 + 5]); // prototype rule: blanks stay together with at least one athlete
    expect(paginate(Array.from({ length: 10 }, (_, i) => i)).map((p) => p.length)).toEqual([9, 6]);
    expect(paginate(Array.from({ length: 15 }, (_, i) => i)).map((p) => p.length)).toEqual([10, 10]);
  });
});

describe('T&T scorecards', () => {
  it('per event TR, DM, TU with squads in arrival order (TR: A, C, B)', () => {
    expect(arrivalAt('TR')).toEqual([0, 2, 1]);
    expect(arrivalAt('DM')).toEqual([1, 0, 2]);
    expect(arrivalAt('TU')).toEqual([2, 1, 0]);
    const pages = tntScorecardPages(input([all(3), all(3), all(3)]));
    expect(pages.map((p) => `${p.event}${p.squad}`)).toEqual(['TRA', 'TRC', 'TRB', 'DMB', 'DMA', 'DMC', 'TUC', 'TUB', 'TUA']);
    expect(pages.filter((p) => p.event === 'TR').map((p) => p.jump)).toEqual([{ group: 'TR', label: 'A' }, { group: 'TR', label: 'C' }, { group: 'TR', label: 'B' }]);
  });

  it('titles and "page n of m" per squad list', () => {
    const pages = tntScorecardPages(input([all(12), [], []]));
    expect(pages.map((p) => p.title)).toEqual(['Trampoline Score Sheet', 'Trampoline Score Sheet', 'Double Mini Score Sheet', 'Double Mini Score Sheet', 'Tumbling Score Sheet', 'Tumbling Score Sheet']);
    expect(pages[0].subtitle).toBe('Session 1 – Purple · Squad A · rotation 1 · page 1 of 2');
    expect(pages[1].subtitle).toBe('Session 1 – Purple · Squad A · rotation 1 · page 2 of 2');
    expect(pages[1].squadPage).toEqual({ n: 2, of: 2 });
    expect(pages[0].jump.label).toBe('A1');
  });

  it('only athletes entered on the event, in the saved order, then 5 blanks', () => {
    const a = person('A', 'C', { TR: 'IF' });
    const b = person('B', 'C', { DM: 'IF' });
    const c = person('C', 'C', { TR: 'NF', DM: 'NF' });
    const sq = input([[a, b, c], [], []]);
    sq.squads[0].order.TR = [c, a]; // a custom order
    const [tr] = tntScorecardPages(sq);
    expect(tr.rows.map((r) => r.name)).toEqual(['C', 'A', '', '', '', '', '']);
    expect(tr.rows.filter((r) => r.blank)).toHaveLength(5);
  });

  it('TR columns: E1 E2 HD SJ ND heavy, Final not; one row per athlete', () => {
    const [p] = tntScorecardPages(input([all(2), [], []]));
    expect(p.columns).toBe(TR_COLUMNS);
    expect(p.columns.map((c) => c.header)).toEqual(['Scratch?', 'Name / Club', 'Level', 'E1', 'E2', 'HD', 'SJ', 'ND', 'Final']);
    expect(p.columns.filter((c) => c.heavy).map((c) => c.header)).toEqual(['E1', 'E2', 'HD', 'SJ', 'ND']);
    expect(p.passes).toBe(1);
  });

  it('High Flyers get two trampoline routine lines (Final stays one box); blanks too when the squad has a High Flyer (Julia 2026-10-23)', () => {
    const pages = tntScorecardPages(input([[...all(1, 'HF', 'H'), ...all(1, 'IF', 'I')], all(2, 'NF'), []]));
    const trA = pages.find((p) => p.event === 'TR' && p.squad === 'A')!;
    expect(trA.rows.map((r) => r.passes ?? trA.passes)).toEqual([2, 1, 2, 2, 2, 2, 2]);
    expect(trA.columns.find((c) => c.id === 'final')!.single).toBe(true);
    expect(trA.columns.filter((c) => c.kind === 'box' && !c.single).map((c) => c.id)).toEqual(['e1', 'e2', 'hd', 'sj', 'nd']);
    expect(trA.key).toMatch(/High Flyers: one line per routine/);
    // No High Flyer in the squad: one line everywhere, no note.
    const trB = pages.find((p) => p.event === 'TR' && p.squad === 'B')!;
    expect(trB.rows.every((r) => (r.passes ?? trB.passes) === 1)).toBe(true);
    expect(trB.key).not.toMatch(/High Flyers/);
    // Double Mini and Tumbling are unchanged: two passes for everyone.
    const dmA = pages.find((p) => p.event === 'DM' && p.squad === 'A')!;
    expect(dmA.rows.every((r) => r.passes === undefined) && dmA.passes === 2).toBe(true);
  });

  it('DM and TU columns: E1 E2 E3 SJ ND heavy, Final not; two rows per athlete', () => {
    const pages = tntScorecardPages(input([all(2), [], []]));
    const dm = pages.find((p) => p.event === 'DM')!;
    const tu = pages.find((p) => p.event === 'TU')!;
    for (const p of [dm, tu]) {
      expect(p.columns).toBe(PASS_COLUMNS);
      expect(p.columns.map((c) => c.header).slice(3)).toEqual(['E1', 'E2', 'E3', 'SJ', 'ND', 'Final']);
      expect(p.columns.filter((c) => c.heavy).map((c) => c.header)).toEqual(['E1', 'E2', 'E3', 'SJ', 'ND']);
      expect(p.passes).toBe(2);
      expect(p.key).toContain('Two rows per athlete');
    }
  });

  it('heavy rule where the level on that event changes', () => {
    const sq = [person('A', 'C', { TR: 'HF', DM: 'IF' }), person('B', 'C', { TR: 'HF', DM: 'NF' }), person('C', 'C', { TR: 'IF', DM: 'NF' })];
    const pages = tntScorecardPages(input([sq, [], []]));
    expect(pages.find((p) => p.event === 'TR')!.rows.slice(0, 3).map((r) => r.levelBreak)).toEqual([false, false, true]);
    expect(pages.find((p) => p.event === 'DM')!.rows.slice(0, 3).map((r) => r.levelBreak)).toEqual([false, true, false]);
  });

  it('an empty squad has no pages; no NAIGC wording', () => {
    expect(tntScorecardPages(input([[], [], []]))).toEqual([]);
    expect(JSON.stringify(tntScorecardPages(input([all(1), [], []])))).not.toMatch(/NAIGC/);
  });
});

describe('synchro sheet', () => {
  const pair = (i: number, level: string) => ({ id: `p${i}`, names: `A${i} & B${i}`, clubs: 'Club', level });
  it('7 pairs a page, by flight, with the page counted per flight', () => {
    const flights = [{ name: 'A', pairs: Array.from({ length: 15 }, (_, i) => pair(i, 'IF')) }, { name: 'B', pairs: [pair(99, 'NF')] }];
    const pages = synchroPages(input([[], [], []], { flights }));
    expect(pages.map((p) => p.pairs.length)).toEqual([SYNCHRO_PAIRS_PER_PAGE, SYNCHRO_PAIRS_PER_PAGE, 1, 1]);
    expect(pages[0].subtitle).toBe('Session 1 – Purple · Flight A · page 1 of 3');
    expect(pages[3].subtitle).toBe('Session 1 – Purple · Flight B · page 1 of 1');
    expect(pages.map((p) => p.jump.label)).toEqual(['A1', 'A2', 'A3', 'B']);
  });
  it('row 1 A1-E1 A1-E2 A1-HD SJ ND, row 2 A2-E1 A2-E2 A2-HD Sync Final; heavy = all but Final', () => {
    const [p] = synchroPages(input([[], [], []], { flights: [{ name: 'A', pairs: [pair(1, 'IF')] }] }));
    expect(p.row1.map((c) => c.header)).toEqual(['A1 - E1', 'A1 - E2', 'A1 - HD', 'SJ', 'ND']);
    expect(p.row2.map((c) => c.header)).toEqual(['A2 - E1', 'A2 - E2', 'A2 - HD', 'Sync', 'Final']);
    expect([...p.row1, ...p.row2].filter((c) => !c.heavy).map((c) => c.header)).toEqual(['Final']);
  });
  it('heavy rule where the level changes', () => {
    const [p] = synchroPages(input([[], [], []], { flights: [{ name: 'A', pairs: [pair(1, 'HF'), pair(2, 'HF'), pair(3, 'IF')] }] }));
    expect(p.pairs.map((q) => q.levelBreak)).toEqual([false, false, true]);
  });
  it('no flights, no pages', () => {
    expect(synchroPages(input([[], [], []]))).toEqual([]);
  });
});

describe('T&T rotation sheet', () => {
  it('title with the competition time (when set), per-squad tables, synchro only, flights', () => {
    const sq = [[person('Zed', 'B Club', { TR: 'NF' }), person('Amy', 'A Club', { TR: 'IF', SY: 'IF' }), person('Ian', 'Independent Community Athlete', { DM: 'HF' }, true), person('Bea', 'A Club', { TU: 'IF' })], [], []];
    const flights = [{ name: 'A', pairs: [{ id: 'p', names: 'Amy & Cal', clubs: 'A Club', level: 'IF' }] }];
    const [p] = tntRotationPages(input(sq, { competitionTime: 'Thursday 7:30 AM', synchroOnly: [person('Syd', 'S Club', { SY: 'NF' })], flights }));
    expect(p.title).toBe('T&T Session 1 – Purple · Thursday 7:30 AM');
    expect(p.subtitle).toBe('Test Nationals · Purple Gym · NF, IF, HF');
    expect(p.tables.map((t) => t.heading)).toEqual(['Squad A: Trampoline > Double Mini > Tumbling', 'Squad B: Double Mini > Tumbling > Trampoline', 'Squad C: Tumbling > Trampoline > Double Mini', 'Synchro only', 'Synchro flights']);
    expect(p.tables[0].columns).toEqual(['Athlete', 'Club', 'Squad', 'TR', 'DM', 'TU', 'SY']);
    // club, then first name; independents last
    expect(p.tables[0].rows.map((r) => r.cells[0])).toEqual(['Amy', 'Bea', 'Zed', 'Ian']);
    expect(p.tables[0].rows[0].cells).toEqual(['Amy', 'A Club', 'A', 'IF', '', '', 'IF']);
    expect(p.tables[3].rows[0].cells).toEqual(['Syd', 'S Club', '–', '', '', '', 'NF']);
    expect(p.tables[4].rows[0].cells).toEqual(['Flight A', 'Amy & Cal', 'A Club', 'IF']);
  });
  it('no time set: just the session; no synchro-only table without synchro-only athletes', () => {
    const [p] = tntRotationPages(input([all(1), [], []]));
    expect(p.title).toBe('T&T Session 1 – Purple');
    expect(p.tables.map((t) => t.heading)).toHaveLength(3);
  });
  it('sorts club then first name, independents last', () => {
    const xs = [person('B', 'Z', {}, true), person('B', 'A', {}), person('A', 'A', {})].sort(byClubThenName);
    expect(xs.map((x) => `${x.clubName}/${x.name}`)).toEqual(['A/A', 'A/B', 'Z/B']);
  });
  it('a long list carries on to the next page with its heading, nobody lost, within the page budget', () => {
    const big = Array.from({ length: 70 }, (_, i) => person(`N${String(i).padStart(2, '0')}`, 'Club', { TR: 'IF' }));
    const pages = tntRotationPages(input([big, all(3), all(2)]));
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) expect(p.units).toBeLessThanOrEqual(TNT_ROTATION_PAGE_UNITS + 1);
    const rowsA = pages.flatMap((p) => p.tables.filter((t) => t.heading.startsWith('Squad A')).flatMap((t) => t.rows.map((r) => r.cells[0])));
    expect(rowsA).toHaveLength(70);
    expect(pages[1].tables[0].continued).toBe(true);
    expect(pages[1].tables[0].heading.startsWith('Squad A')).toBe(true);
    // never strand a table with a single row on a page
    for (const p of pages) for (const t of p.tables) expect(t.rows.length).toBeGreaterThanOrEqual(2);
  });
});
