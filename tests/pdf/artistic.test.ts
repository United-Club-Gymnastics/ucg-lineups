import { describe, expect, it } from 'vitest';
import { arrivalOrder, squadCountFor, type RotationPattern } from '../../src/lib/rotation';
import { artisticRotationPages, groupLabel, ROTATION_PAGE_UNITS } from '../../src/lib/pdf/artistic-rotation-content';
import { numberPages } from '../../src/lib/pdf/model';
import { renderPdf } from '../../src/lib/pdf/render';
import { artisticScorecardPages, INFINITY_COLUMNS, SCORECARD_ROWS, STANDARD_COLUMNS } from '../../src/lib/pdf/artistic-scorecards-content';
import type { ArtisticGroupInput, ArtisticSessionInput } from '../../src/lib/pdf/session-input';

const MEET = { name: 'Test Nationals', date: 'Oct 22–25, 2026' };
const MAG = ['FX', 'PH', 'SR', 'VT', 'PB', 'HB'];
const WAG = ['VT', 'UB', 'BB', 'FX'];

function group(club: string, level: string, names: string[], o: Partial<ArtisticGroupInput> = {}, codes = MAG): ArtisticGroupInput {
  return {
    key: `${club}::${level}::0`, independent: false, clubName: club, levelCode: level, groupIndex: 0, groupCount: 1,
    order: Object.fromEntries(codes.map((c) => [c, names.map((n) => ({ id: `${club}-${n}`, name: n }))])),
    routines: Object.fromEntries(codes.map((c) => [c, names.length])), ...o,
  };
}

function input(discipline: 'MAG' | 'WAG', pattern: RotationPattern, groups: ArtisticGroupInput[][], extra: Partial<ArtisticSessionInput> = {}): ArtisticSessionInput {
  const n = squadCountFor(pattern, discipline);
  return {
    meet: MEET, session: { number: 1, gym: 'Orange', discipline, levelCodes: ['Dev', 'Int', 'Adv', 'XS', 'Inf'] }, pattern,
    schedule: { stretch: '7:30 AM', warmups: '7:50 AM', competition: '8:00 AM' }, athleteCount: 10,
    squads: Array.from({ length: n }, (_, i) => ({ index: i, letter: String.fromCharCode(65 + i), groups: groups[i] ?? [] })),
    unplaced: 0, noSquads: false, ...extra,
  };
}

const everySquad = (discipline: 'MAG' | 'WAG', pattern: RotationPattern) =>
  Array.from({ length: squadCountFor(pattern, discipline) }, (_, i) => [group(`Club ${i}`, 'Dev', [`Ath ${i}`], {}, discipline === 'MAG' ? MAG : WAG)]);

describe('artistic scorecards', () => {
  it('apparatus in Olympic order, squads in arrival order (one flight MAG floor: A, F, E, D, C, B)', () => {
    const pages = artisticScorecardPages(input('MAG', 'one', everySquad('MAG', 'one')));
    expect(pages).toHaveLength(36);
    expect(pages.map((p) => p.band.code).filter((c, i, a) => a.indexOf(c) === i)).toEqual(MAG);
    expect(pages.slice(0, 6).map((p) => p.band.squad)).toEqual(['A', 'F', 'E', 'D', 'C', 'B']);
    expect(pages.slice(0, 6).map((p) => p.band.rotation)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(pages.slice(0, 6).map((p) => p.jump)).toEqual(['A', 'F', 'E', 'D', 'C', 'B'].map((label) => ({ group: 'FX', label })));
  });

  it('every page follows arrivalOrder for its apparatus, in any pattern', () => {
    for (const pattern of ['one', 'parallel'] as RotationPattern[]) {
      for (const d of ['MAG', 'WAG'] as const) {
        const pages = artisticScorecardPages(input(d, pattern, everySquad(d, pattern)));
        for (const code of d === 'MAG' ? MAG : WAG) {
          const letters = pages.filter((p) => p.band.code === code).map((p) => p.band.squad);
          expect(letters).toEqual(arrivalOrder(code, pattern, d).map((i) => String.fromCharCode(65 + i)));
        }
      }
    }
  });

  it('names header, gym, session and A/B equipment (VT-A) in the band', () => {
    const pages = artisticScorecardPages(input('WAG', 'parallel', everySquad('WAG', 'parallel')));
    expect(pages[0]).toMatchObject({ gym: 'Orange Gym', session: 'Session 1 – Orange', meet: MEET });
    expect(pages[0].band).toMatchObject({ squad: 'A', apparatus: 'Vault', equipment: 'VT-A', rotation: 1, discipline: 'WAG' });
    const one = artisticScorecardPages(input('MAG', 'one', everySquad('MAG', 'one')));
    expect(one[0].band.equipment).toBe('');
  });

  it('always exactly 15 rows: athletes, then blanks', () => {
    const names = Array.from({ length: 11 }, (_, i) => `A${i}`);
    const [p] = artisticScorecardPages(input('MAG', 'one', [[group('Club', 'Dev', names)]]));
    expect(p.rows).toHaveLength(SCORECARD_ROWS);
    expect(p.rows.slice(0, 11).every((r) => !r.blank)).toBe(true);
    expect(p.rows.slice(11).every((r) => r.blank && r.athlete === '' && !r.levelBreak)).toBe(true);
  });

  it('more than 15 on an apparatus still lists everyone', () => {
    const names = Array.from({ length: 17 }, (_, i) => `A${i}`);
    const [p] = artisticScorecardPages(input('MAG', 'one', [[group('Club', 'Dev', names)]]));
    expect(p.rows).toHaveLength(17);
    expect(p.rows.every((r) => !r.blank)).toBe(true);
  });

  it('lists each club group in its order for that apparatus, groups in squad order', () => {
    const g1 = group('Alpha', 'Dev', ['Zed', 'Ann'], { order: { FX: [{ id: 'z', name: 'Zed' }, { id: 'a', name: 'Ann' }], PH: [{ id: 'a', name: 'Ann' }, { id: 'z', name: 'Zed' }] } });
    const g2 = group('Beta', 'Int', ['Cy']);
    const pages = artisticScorecardPages(input('MAG', 'one', [[g1, g2]]));
    const fx = pages.find((p) => p.band.code === 'FX')!;
    const ph = pages.find((p) => p.band.code === 'PH')!;
    expect(fx.rows.filter((r) => !r.blank).map((r) => r.athlete)).toEqual(['Zed', 'Ann', 'Cy']);
    expect(fx.rows.filter((r) => !r.blank).map((r) => r.club)).toEqual(['Alpha', 'Alpha', 'Beta']);
    expect(ph.rows.filter((r) => !r.blank).map((r) => r.athlete)).toEqual(['Ann', 'Zed', 'Cy']);
  });

  it('heavy double rule where the level changes, never on blanks, never in Infinity', () => {
    const [p] = artisticScorecardPages(input('MAG', 'one', [[group('A', 'Dev', ['x', 'y']), group('B', 'Dev', ['z']), group('C', 'Int', ['w'])]]));
    expect(p.rows.map((r) => r.levelBreak).slice(0, 5)).toEqual([false, false, false, true, false]);
    const inf = artisticScorecardPages(input('WAG', 'one', [[group('A', 'Inf', ['x'], {}, WAG), group('B', 'Inf', ['y'], {}, WAG)]]))[0];
    expect(inf.infinity).toBe(true);
    expect(inf.rows.some((r) => r.levelBreak)).toBe(false);
  });

  it('standard columns: SV and Final Score are heavy, the rest are not', () => {
    const [p] = artisticScorecardPages(input('MAG', 'one', [[group('A', 'Dev', ['x'])]]));
    expect(p.infinity).toBe(false);
    expect(p.columns).toBe(STANDARD_COLUMNS);
    expect(p.columns.map((c) => c.header)).toEqual(['Level', 'Athlete', 'Club', 'SV', 'ND', 'J1 Score', 'J2 Score', 'Final Score', 'Scratch?']);
    expect(p.columns.filter((c) => c.heavy).map((c) => c.header)).toEqual(['SV', 'Final Score']);
    expect(p.columns.filter((c) => c.sub).map((c) => [c.header, c.sub])).toEqual([['J1 Score', 'incl. ND'], ['J2 Score', 'incl. ND']]);
  });

  it('Infinity columns: SV (10 + D-score), E-score (incl. ND), ND, Final Score; SV and Final heavy', () => {
    const [p] = artisticScorecardPages(input('WAG', 'one', [[group('A', 'Inf', ['x'], {}, WAG)]]));
    expect(p.columns).toBe(INFINITY_COLUMNS);
    expect(p.columns.map((c) => c.header)).toEqual(['Level', 'Athlete', 'Club', 'SV', 'E-score', 'ND', 'Final Score', 'Scratch?']);
    expect(p.columns.find((c) => c.id === 'sv')!.sub).toBe('10 + D-score');
    expect(p.columns.find((c) => c.id === 'e')!.sub).toBe('incl. ND');
    expect(p.columns.filter((c) => c.heavy).map((c) => c.header)).toEqual(['SV', 'Final Score']);
    expect(p.rows[0].level).toBe('Inf');
  });

  it('a squad that mixes Infinity with another level uses the standard sheet (and rules)', () => {
    const [p] = artisticScorecardPages(input('WAG', 'one', [[group('A', 'XS', ['x'], {}, WAG), group('B', 'Inf', ['y'], {}, WAG)]]));
    expect(p.infinity).toBe(false);
    expect(p.rows[1].levelBreak).toBe(true);
  });

  it('skips a squad with nobody on that apparatus, and an unplaced session has no pages', () => {
    const g = group('A', 'Dev', ['x'], { order: { FX: [{ id: 'x', name: 'x' }] } });
    const pages = artisticScorecardPages(input('MAG', 'one', [[g]]));
    expect(pages.map((p) => p.band.code)).toEqual(['FX']);
    expect(artisticScorecardPages(input('MAG', 'one', [], { noSquads: true }))).toEqual([]);
  });

  it('carries the heavy-box key and black-and-white wording only', () => {
    const [p] = artisticScorecardPages(input('MAG', 'one', [[group('A', 'Dev', ['x'])]]));
    expect(p.key).toBe('Heavy boxes are the scores entered in ScoreFlippers.');
    expect(JSON.stringify(p)).not.toMatch(/NAIGC/i);
  });
});

describe('artistic rotation sheet', () => {
  it('titles, schedule and athlete count; no "Session Rotation Report" or "(MAG)"', () => {
    const [p] = artisticRotationPages(input('MAG', 'one', [[group('Alpha', 'Dev', ['x']), group('Beta', 'Int', ['y'])], [group('Gamma', 'Adv', ['z'])]]));
    expect(p.title).toBe('Test Nationals – Session 1 – Orange');
    expect(p.subtitle).toBe('MAG – Orange Gym – Dev, Int, Adv');
    expect(p.schedule).toEqual([{ label: 'Open Stretch', time: '7:30 AM' }, { label: 'Timed Warm-ups', time: '7:50 AM' }, { label: 'Competition', time: '8:00 AM' }]);
    expect(p.athleteCount).toBe(10);
    expect(JSON.stringify(p)).not.toMatch(/Session Rotation Report|\(MAG\)|NAIGC/);
  });

  it('one page per session; a header per squad with the apparatus in rotation order', () => {
    const pages = artisticRotationPages(input('MAG', 'one', everySquad('MAG', 'one')));
    expect(pages).toHaveLength(1);
    expect(pages[0].squads.map((s) => s.heading)).toEqual(['Squad A', 'Squad B', 'Squad C', 'Squad D', 'Squad E', 'Squad F']);
    expect(pages[0].squads[0].columns).toEqual(MAG);
    expect(pages[0].squads[1].columns).toEqual(['PH', 'SR', 'VT', 'PB', 'HB', 'FX']);
  });

  it('shows A/B equipment as the pattern says, with no BYE column', () => {
    const [p] = artisticRotationPages(input('WAG', 'parallel', everySquad('WAG', 'parallel')));
    expect(p.columnCount).toBe(4);
    expect(p.squads[0].columns).toEqual(['VT-A', 'UB-A', 'BB-A', 'FX-A']);
    expect(p.squads[1].columns).toEqual(['VT-B', 'UB-B', 'BB-B', 'FX-B']);
    expect(p.squads[1].rows[0].counts).toEqual([1, 1, 1, 1]);
    expect(JSON.stringify(p)).not.toContain('BYE');
  });

  it('rows are Club – Level (+ · Group B), with routine counts per apparatus', () => {
    const a = group('Alpha Gymnastics', 'Dev', ['x', 'y', 'z'], { routines: { FX: 3, PH: 2, SR: 0, VT: 3, PB: 1, HB: 3 }, groupCount: 2, groupIndex: 1 });
    const b = group('Beta', 'Dev', ['q']);
    expect(groupLabel(a)).toBe('Alpha Gymnastics – Dev · Group B');
    const [p] = artisticRotationPages(input('MAG', 'one', [[a, b]]));
    expect(p.squads[0].rows.map((r) => r.label)).toEqual(['Alpha Gymnastics – Dev · Group B', 'Beta – Dev']);
    expect(p.squads[0].rows[0].counts).toEqual([3, 2, 0, 3, 1, 3]);
  });

  it('dashed rule between levels only; alternate rows tinted', () => {
    const [p] = artisticRotationPages(input('MAG', 'one', [[group('A', 'Dev', ['x']), group('B', 'Dev', ['y']), group('C', 'Int', ['z'])]]));
    expect(p.squads[0].rows.map((r) => r.levelBreak)).toEqual([false, false, true]);
    expect(p.squads[0].rows.map((r) => r.alt)).toEqual([false, true, false]);
  });

  it('one row per independent level, counts added up', () => {
    const i1 = group('Independent Community Athlete', 'Int', ['a'], { independent: true, routines: { FX: 1, HB: 1 } });
    const i2 = group('Independent Community Athlete', 'Int', ['b'], { independent: true, routines: { FX: 1, VT: 1 } });
    const [p] = artisticRotationPages(input('MAG', 'one', [[group('Club', 'Int', ['c']), i1, i2]]));
    expect(p.squads[0].rows.map((r) => r.label)).toEqual(['Club – Int', 'Independent Community Athlete – Int']);
    expect(p.squads[0].rows[1].counts).toEqual([2, 0, 0, 1, 0, 1]);
  });

  it('an empty squad says so; the sheet continues on a second page only past the page budget', () => {
    const [p] = artisticRotationPages(input('MAG', 'one', [[group('A', 'Dev', ['x'])]]));
    expect(p.squads[1].empty).toBe(true);
    const many = Array.from({ length: 12 }, () => Array.from({ length: 6 }, (_, k) => group(`Club ${k}`, 'Dev', ['x'])));
    const pages = artisticRotationPages(input('MAG', 'parallel', many));
    expect(pages.length).toBeGreaterThan(1);
    for (const pg of pages) expect(pg.units).toBeLessThanOrEqual(ROTATION_PAGE_UNITS);
    expect(pages.flatMap((pg) => pg.squads.map((s) => s.letter))).toEqual('ABCDEFGHIJKL'.split(''));
  });

  it('the level line lists only levels that are present, in session order', () => {
    const [p] = artisticRotationPages(input('MAG', 'one', [[group('A', 'Adv', ['x']), group('B', 'Dev', ['y'])]]));
    expect(p.subtitle).toBe('MAG – Orange Gym – Dev, Adv');
  });
});

describe('alternative patterns: rotation sheet and scorecards', () => {
  const wag7 = () => artisticRotationPages(input('WAG', 'wag-7', everySquad('WAG', 'wag-7')));
  const raw = (pages: ReturnType<typeof wag7>) => renderPdf(numberPages(pages, 'x'), 'x', false).output();

  it('WAG 7 squads: BYE columns, equipment names, notes and the timeline', () => {
    const pages = wag7();
    expect(pages).toHaveLength(1);
    const [p] = pages;
    expect(p.columnCount).toBe(5);
    expect(p.hasNotes).toBe(true);
    expect(p.squads.map((s) => s.columns)).toEqual([
      ['', 'VT-Platform', 'UB', 'BB-B', 'FX'],
      ['BYE', 'VT-Ground', 'UB', 'BB-A', 'FX'],
      ['', 'UB', 'BB-A', 'FX', 'VT-Platform'],
      ['', 'BB-A', 'FX', 'VT-Platform', 'UB'],
      ['BYE', 'BB-B', 'FX', 'VT-Ground', 'UB'],
      ['', 'FX', 'VT-Platform', 'UB', 'BB-B'],
      ['BYE', 'FX', 'VT-Ground', 'UB', 'BB-A'],
    ]);
    // counts sit under their equipment; the BYE / blank column has none
    expect(p.squads[0].rows[0].counts).toEqual([null, 1, 1, 1, 1]);
    expect(p.squads[1].rows[0].counts).toEqual([null, 1, 1, 1, 1]);
    expect(p.squads[2].notes).toEqual(['FX after Squad E']);
    expect(p.squads[6].notes).toEqual(['Bump touch warm-up once F starts competing', 'UB/FX after Squad F']);
    expect(p.columnWidth).toBeGreaterThan(46);
    expect(p.timeline!.header).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(p.timeline!.rows.map((r) => r.letter)).toEqual('ABCDEFG'.split(''));
    expect(p.timeline!.rows[0].cells).toEqual(['(W) VT-P', '(C) VT-P', '(W/C) UB', '(W) BB-B', '(C) BB-B', '(W) FX', '(C) FX', '-']);
    expect(p.timeline!.rows[6].cells[0]).toBe('BYE');
    expect(p.units).toBeLessThanOrEqual(ROTATION_PAGE_UNITS);
  });

  it('the PDF prints the notes and the timeline, in black and white', () => {
    const out = raw(wag7());
    // jsPDF escapes parentheses in text strings, so a printed `(W/C) UB` is `\(W/C\) UB` in the stream.
    for (const t of ['UB/FX after Squad C', 'UB after Squad B', 'Bump touch warm-up once F starts', 'VT-Platform', 'VT-Ground', 'BYE', '\\(W/C\\) UB', '\\(C\\) VT-P', '\\(W\\) BB-B']) {
      expect(out.includes(t), t).toBe(true);
    }
    expect(out).not.toMatch(/\d(?:\.\d+)? \d(?:\.\d+)? \d(?:\.\d+)? (?:rg|RG)\b/);
  });

  it('patterns without notes or a timeline draw as before (no notes column, no timeline)', () => {
    const [p] = artisticRotationPages(input('MAG', 'mag-3', everySquad('MAG', 'mag-3')));
    expect(p.hasNotes).toBe(false);
    expect(p.timeline).toBeNull();
    expect(p.squads.every((s) => s.notes.length === 0)).toBe(true);
    expect(p.columnWidth).toBe(46);
    const [a] = artisticRotationPages(input('WAG', 'parallel', everySquad('WAG', 'parallel')));
    expect(a.timeline).toBeNull();
    expect(a.columnWidth).toBe(46);
  });

  it('MAG 3 squads: three squads, fixed orders, six columns each', () => {
    const [p] = artisticRotationPages(input('MAG', 'mag-3', everySquad('MAG', 'mag-3')));
    expect(p.squads.map((s) => s.heading)).toEqual(['Squad A', 'Squad B', 'Squad C']);
    expect(p.squads.map((s) => s.columns.join(' '))).toEqual(['FX PH SR VT PB HB', 'PH SR FX PB HB VT', 'SR FX PH HB VT PB']);
  });

  it('MAG 3 squads, WAG overlap: its own orders on the sheet', () => {
    const [p] = artisticRotationPages(input('MAG', 'mag-3-wag', everySquad('MAG', 'mag-3-wag')));
    expect(p.squads.map((s) => s.columns.join(' '))).toEqual(['FX VT PB PH SR HB', 'VT PB FX SR HB PH', 'PB FX VT HB PH SR']);
    expect(JSON.stringify(p)).not.toContain('BYE');
    const out = raw([p]);
    expect(out).toMatch(/\(PB\) Tj/);
  });

  it('WAG 7 squads: scorecard pages in compete order, with the equipment name in the band', () => {
    const pages = artisticScorecardPages(input('WAG', 'wag-7', everySquad('WAG', 'wag-7')));
    expect(pages).toHaveLength(28);
    const vault = pages.filter((p) => p.band.code === 'VT');
    expect(vault.map((p) => p.band.squad).join('')).toBe('ABFGDEC');
    expect(vault.map((p) => p.band.equipment)).toEqual(['VT-Platform', 'VT-Ground', 'VT-Platform', 'VT-Ground', 'VT-Platform', 'VT-Ground', 'VT-Platform']);
    expect(vault.map((p) => p.band.rotation)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(pages.filter((p) => p.band.code === 'BB').map((p) => p.band.equipment)).toEqual(['BB-A', 'BB-B', 'BB-A', 'BB-B', 'BB-A', 'BB-B', 'BB-A']);
    expect(pages.filter((p) => p.band.code === 'UB').every((p) => p.band.equipment === '')).toBe(true);
    for (const code of WAG) {
      expect(pages.filter((p) => p.band.code === code).map((p) => p.band.squad)).toEqual(arrivalOrder(code, 'wag-7', 'WAG').map((i) => String.fromCharCode(65 + i)));
    }
  });

  it('MAG 3 squads: scorecards follow arrivalOrder', () => {
    for (const pattern of ['mag-2', 'mag-3', 'mag-3-wag']) {
      const pages = artisticScorecardPages(input('MAG', pattern, everySquad('MAG', pattern)));
      for (const code of MAG) {
        expect(pages.filter((p) => p.band.code === code).map((p) => p.band.squad)).toEqual(arrivalOrder(code, pattern, 'MAG').map((i) => String.fromCharCode(65 + i)));
      }
    }
  });
});
