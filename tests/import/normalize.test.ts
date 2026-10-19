import { describe, expect, it } from 'vitest';
import { assembleInput } from '../../src/lib/import/assemble';
import { detectWorkbook, type Detected } from '../../src/lib/import/detect';
import { mapLevel, normalizeImport, slug, splitEmails, tntLevelCode } from '../../src/lib/import/normalize';
import { readWorkbook } from '../../src/lib/import/read-workbook';
import { ATH_HEADERS, MAG_HEADERS, TNT_HEADERS, WAG_HEADERS, athRow, makeWorkbook } from './helpers';

const a = (o: Partial<Parameters<typeof athRow>[0]> & { bib?: string }) =>
  athRow({ bib: '', first: 'Ada', last: 'Test', level: 'Platinum', short: 'XP', type: 'WAG', club: 'Alpha Gymnastics', session: 'Session 1 - Orange', ...o });

async function run(sheets: {
  ath: unknown[][]; wag?: unknown[][]; mag?: unknown[][]; tnt?: unknown[][]; emails?: unknown[][]; emailHeaders?: string[];
}) {
  const found: Detected[] = [];
  const add = async (rows?: unknown[][], headers?: string[]) => {
    if (!rows) return;
    const buf = await makeWorkbook({ Sheet: [headers!, ...rows] as never });
    found.push(detectWorkbook(await readWorkbook(buf))!);
  };
  await add(sheets.ath, ATH_HEADERS);
  await add(sheets.wag, WAG_HEADERS);
  await add(sheets.mag, MAG_HEADERS);
  await add(sheets.tnt, TNT_HEADERS);
  await add(sheets.emails, sheets.emailHeaders ?? ['Club', 'Email']);
  return normalizeImport(assembleInput(found)!);
}

const noNoise = (m: { warnings: { code: string }[] }) => m.warnings.filter((w) => w.code !== 'no-export');

import { parseSessionString } from '../../src/lib/session-names';

describe('helpers', () => {
  it('parses sessions', () => {
    expect(parseSessionString('Session 1 - Orange')).toMatchObject({ name: 'Session 1', location: 'Orange', number: 1 });
    expect(parseSessionString('session 12 – purple')).toMatchObject({ name: 'Session 12', location: 'Purple', number: 12 });
    expect(parseSessionString('Brunch')).toMatchObject({ name: 'Brunch', location: '', hasLocation: false });
  });
  it('slugs club names', () => {
    expect(slug("Arizona State Men's Gymnastics")).toBe('arizona-state-men-s-gymnastics');
    expect(slug('Club & Co.')).toBe('club-and-co');
  });
  it('splits multi-address cells', () => {
    expect(splitEmails('A@x.org; b@x.org, a@x.org  c@x.org')).toEqual(['a@x.org', 'b@x.org', 'c@x.org']);
    expect(splitEmails('not an email')).toEqual([]);
  });
  it('maps levels', () => {
    expect(mapLevel('NAIGC Open Scoring', 'Open')).toEqual({ code: 'Inf', name: 'Infinity' });
    expect(mapLevel('NAIGC Open Scoring', '')).toEqual({ code: 'Inf', name: 'Infinity' });
    expect(mapLevel('NAIGC Developmental', 'Dev')).toEqual({ code: 'Dev', name: 'Developmental' });
    expect(mapLevel('NAIGC Advanced (GymACT)', 'Adv')).toEqual({ code: 'Adv', name: 'Advanced (GymACT)' });
    expect(mapLevel('Level 9', 'L9')).toEqual({ code: 'L9', name: 'Level 9' });
    // fall back to names when no short name
    expect(mapLevel('Silver', '').code).toBe('XS');
    expect(mapLevel('Platinum', '').code).toBe('XP');
    expect(mapLevel('Diamond', '').code).toBe('XD');
    expect(mapLevel('NAIGC Intermediate', '').code).toBe('Int');
    expect(mapLevel('Intermediate Flyers', '').code).toBe('IF');
    expect(mapLevel('Mystery Level', '').code).toBe('Mystery Level');
    expect(tntLevelCode('High Flyers')).toBe('HF');
    expect(tntLevelCode('New Flyers')).toBe('NF');
  });
});

describe('normalizeImport', () => {
  it('builds athletes, clubs (full name), sessions; ignores SquadName', async () => {
    const m = await run({
      ath: [
        a({ bib: '0398', first: 'Bo', club: 'Alpha Gymnastics' }),
        a({ bib: '12', type: 'MAG', level: 'NAIGC Developmental', short: 'Dev', club: 'Beta Club', session: 'Session 2 - Green' }),
      ],
      wag: [['Bo', 'Test', '0398', 'Platinum', 'Included', 'Scratched', 'Included', 'Included']],
      mag: [['Ada', 'Test', '12', 'Included', 'Included', 'Scratched', 'Included', 'Included', 'Included']],
      emails: [['Alpha Gymnastics', 'a@alpha.org; b@alpha.org'], ['Beta Club', 'c@beta.org']],
    });
    const wag = m.athletes.find((x) => x.id === 'WAG_alpha-gymnastics_bo-test')!;
    expect(wag).not.toHaveProperty('bib');
    expect(wag).toMatchObject({
      discipline: 'WAG', first: 'Bo', clubId: 'alpha-gymnastics', clubName: 'Alpha Gymnastics',
      independent: false, levelCode: 'XP', levelName: 'Platinum', sessionId: 's1-orange',
      apparatus: ['VT', 'BB', 'FX'], competes: true,
    });
    expect(wag.tnt).toBeUndefined();
    expect(JSON.stringify(m)).not.toContain('IGNORED');
    const mag = m.athletes.find((x) => x.id === 'MAG_beta-club_ada-test')!;
    expect(mag.apparatus).toEqual(['FX', 'PH', 'VT', 'PB', 'HB']);
    expect(mag.levelName).toBe('Developmental');
    expect(m.sessions.map((s) => s.id)).toEqual(['s1-orange', 's2-green']);
    expect(m.sessions[0]).toEqual({ id: 's1-orange', name: 'Session 1', location: 'Orange', number: 1, discipline: 'WAG', levelCodes: ['XP'] });
    expect(m.clubs).toEqual([
      { id: 'alpha-gymnastics', name: 'Alpha Gymnastics', emails: ['a@alpha.org', 'b@alpha.org'] },
      { id: 'beta-club', name: 'Beta Club', emails: ['c@beta.org'] },
    ]);
    expect(m.warnings).toEqual([]);
  });

  it('maps Open Scoring to Infinity', async () => {
    const m = await run({ ath: [a({ bib: '1', level: 'NAIGC Open Scoring', short: 'Open' })] });
    expect(m.athletes[0]).toMatchObject({ levelCode: 'Inf', levelName: 'Infinity' });
    expect(m.sessions[0].levelCodes).toEqual(['Inf']);
  });

  it('flags independents and gives them no club', async () => {
    const m = await run({
      ath: [a({ bib: '1', club: 'Independent Community Athlete' }), a({ bib: '2', club: 'Independent Student Athlete' }), a({ bib: '3' })],
      emails: [['Alpha Gymnastics', 'x@alpha.org'], ['Independent Community Athlete', 'nope@x.org']],
    });
    expect(m.athletes.filter((x) => x.independent).map((x) => x.clubName)).toEqual(['Independent Community Athlete', 'Independent Student Athlete']);
    expect(m.clubs.map((c) => c.name)).toEqual(['Alpha Gymnastics']);
    expect(noNoise(m)).toEqual([]);
  });

  it('keys by discipline + club + name (no bibs) so one person in several disciplines is separate', async () => {
    const m = await run({
      ath: [a({ bib: '55' }), a({ bib: '55', type: 'MAG', level: 'NAIGC Intermediate', short: 'Int' }), a({ bib: '55', type: 'T&T', level: 'New Flyers', short: 'NF' })],
    });
    expect(m.athletes.map((x) => x.id)).toEqual(['WAG_alpha-gymnastics_ada-test', 'MAG_alpha-gymnastics_ada-test', 'TNT_alpha-gymnastics_ada-test']);
  });

  it('ignores bibs: people sharing a bib are separate; same name in different clubs is matched by club', async () => {
    const m = await run({
      ath: [a({ bib: '1014', first: 'Una', club: 'Alpha Gymnastics' }), a({ bib: '1014', first: 'Una', club: 'Beta Club' })],
      wag: [
        ['Una', 'Test', '9', 'Platinum', 'Scratched', 'Scratched', 'Scratched', 'Included', 'Beta Club'],
        ['Una', 'Test', '9', 'Platinum', 'Included', 'Included', 'Scratched', 'Scratched', 'Alpha Gymnastics'],
      ],
    });
    expect(m.athletes.map((x) => x.id)).toEqual(['WAG_alpha-gymnastics_una-test', 'WAG_beta-club_una-test']);
    expect(m.athletes[0].apparatus).toEqual(['VT', 'UB']);
    expect(m.athletes[1].apparatus).toEqual(['FX']);
    expect(noNoise(m)).toEqual([]);
  });

  it('adds the birth date to the id when two athletes in one club share a name, and matches by it', async () => {
    const m = await run({
      ath: [a({ dob: '2001-02-03' }), a({ dob: '1999-09-09' })],
      wag: [
        ['Ada', 'Test', '', 'Platinum', 'Scratched', 'Scratched', 'Scratched', 'Included', 'Alpha Gymnastics', '1999-09-09'],
        ['Ada', 'Test', '', 'Platinum', 'Included', 'Scratched', 'Scratched', 'Scratched', 'Alpha Gymnastics', '2001-02-03'],
      ],
    });
    expect(m.athletes.map((x) => x.id)).toEqual(['WAG_alpha-gymnastics_ada-test_2001-02-03', 'WAG_alpha-gymnastics_ada-test_1999-09-09']);
    expect(m.athletes[0].apparatus).toEqual(['VT']);
    expect(m.athletes[1].apparatus).toEqual(['FX']);
    expect(noNoise(m)).toEqual([]);
  });

  it('warns when two athletes in one club share a name and no birth date tells them apart', async () => {
    const m = await run({ ath: [a({}), a({})] });
    expect(m.athletes.map((x) => x.id)).toEqual(['WAG_alpha-gymnastics_ada-test', 'WAG_alpha-gymnastics_ada-test~2']);
    expect(noNoise(m).map((w) => w.code)).toEqual(['same-name', 'same-name']);
  });

  it('matches names when the T&T export strips spaces (St Pierre vs StPierre)', async () => {
    const m = await run({
      ath: [a({ first: 'Stefanie', last: 'St Pierre', type: 'T&T', level: 'New Flyers', short: 'NF' }), a({ first: 'Sean', last: 'Ultot Perez', type: 'T&T', level: 'New Flyers', short: 'NF' })],
      tnt: [
        ['Stefanie', 'StPierre', '', 'Alpha Gymnastics', 'New Flyers', 'Included', '', '', '', '', '', ''],
        ['Sean', 'UltotPerez', '', 'Alpha Gymnastics', '', '', 'New Flyers', 'Included', '', '', '', ''],
      ],
    });
    expect(m.athletes.map((x) => x.apparatus)).toEqual([['TU'], ['TR']]);
    expect(m.athletes[0].last).toBe('St Pierre');
    expect(noNoise(m)).toEqual([]);
  });

  it('treats Scratched/blank as not competing; no Included apparatus => competes false', async () => {
    const m = await run({
      ath: [a({ bib: '1' })],
      wag: [['Ada', 'Test', '1', 'Platinum', 'Scratched', '', 'scratched', null as never]],
    });
    expect(m.athletes[0]).toMatchObject({ apparatus: [], competes: false });
  });

  it('warns and gives empty apparatus when an athlete is missing from the discipline export', async () => {
    const m = await run({
      ath: [a({ bib: '1' }), a({ bib: '2', first: 'Bea' })],
      wag: [['Ada', 'Test', '1', 'Platinum', 'Included', 'Included', 'Included', 'Included'], ['Zoe', 'Ghost', '99', 'Platinum', 'Included', 'Included', 'Included', 'Included']],
    });
    const two = m.athletes.find((x) => x.first === 'Bea')!;
    expect(two).toMatchObject({ apparatus: [], competes: false });
    expect(m.warnings.map((w) => w.code).sort()).toEqual(['not-in-export', 'unmatched-row']);
  });

  it('warns once per discipline when its export is not supplied at all', async () => {
    const m = await run({ ath: [a({ bib: '1' }), a({ bib: '2', first: 'Bea' })] });
    expect(m.warnings).toEqual([expect.objectContaining({ code: 'no-export' })]);
  });

  it('reads T&T per-event levels, only for Included events, incl. synchro-only', async () => {
    const m = await run({
      ath: [
        a({ bib: '1', first: 'A', last: 'One', type: 'T&T', level: 'New Flyers', short: 'NF' }),
        a({ bib: '2', first: 'B', last: 'Two', type: 'T&T', level: 'High Flyers', short: 'HF' }),
        a({ bib: '3', first: 'C', last: 'Three', type: 'T&T', level: 'New Flyers', short: 'NF' }),
      ],
      tnt: [
        ['A', 'One', '1', 'Alpha Gymnastics', 'New Flyers', 'Included', 'Intermediate Flyers', 'Included', 'New Flyers', 'Scratched', 'High Flyers', 'Included'],
        ['B', 'Two', '2', 'Alpha Gymnastics', 'High Flyers', 'Scratched', 'High Flyers', 'Scratched', 'High Flyers', 'Included', '', ''],
        ['C', 'Three', '3', 'Alpha Gymnastics', 'New Flyers', 'Scratched', '', '', '', '', '', ''],
      ],
    });
    const [one, two, three] = m.athletes;
    expect(one.tnt).toEqual({ TR: 'IF', DM: 'HF', TU: 'NF' });
    expect(one.apparatus).toEqual(['TR', 'DM', 'TU']);
    expect(two.tnt).toEqual({ SY: 'HF' });
    expect(two).toMatchObject({ apparatus: ['SY'], competes: true });
    expect(three).toMatchObject({ tnt: {}, apparatus: [], competes: false });
  });

  it('warns about clubs without emails (only when an email file is given); email rows for clubs with no athletes are ignored quietly', async () => {
    const m = await run({ ath: [a({ bib: '1' })], emails: [['Ghost Club', 'g@x.org']] });
    expect(noNoise(m).map((w) => w.code).sort()).toEqual(['no-email']);
    expect(noNoise(await run({ ath: [a({ bib: '1' })] }))).toEqual([]);
  });

  it('reads the League Communications export (Club, Contact, Role); clubs with no athletes are ignored quietly', async () => {
    const m = await run({
      ath: [a({ bib: '1' })],
      emailHeaders: ['', 'Name', 'Club', 'Contact', 'Role', 'Season', 'State'],
      emails: [
        ['', '', 'Alpha Gymnastics', 'alpha@x.org; coach@x.org', 'Club Email', 'Approved', 'CO'],
        ['', '', 'Alpha Gymnastics', 'ignore@x.org', 'President', '', 'CO'],
        ['', '', 'Ghost Club', 'g@x.org', 'Club Email', '', 'NY'],
        ['', '', 'Other Ghost', 'o@x.org', 'Club Email', '', 'NY'],
      ],
    });
    expect(m.clubs[0].emails).toEqual(['alpha@x.org', 'coach@x.org']);
    expect(m.warnings.filter((w) => w.code === 'email-unmatched')).toEqual([]);
  });

  it('flags unreadable sessions, missing names and unknown types, and sorts sessions by gym order', async () => {
    const m = await run({
      ath: [
        a({ first: 'One', session: 'Session 2 - Green' }),
        a({ first: 'Two', session: 'Session 2 - Red' }),
        a({ first: 'Three', session: 'Session 1 - Purple' }),
        a({ first: 'Four', session: 'TBD' }),
        a({ first: '', last: '' }),
        a({ first: 'Six', type: 'Rhythmic' }),
      ],
    });
    // "TBD" has no " - <location>": the whole string is the session name, the location is empty, and it warns.
    expect(m.sessions.map((s) => s.id)).toEqual(['s1-purple', 's2-green', 's2-red', 'tbd--']);
    expect(m.sessions[3]).toMatchObject({ name: 'TBD', location: '' });
    expect(m.athletes.find((x) => x.first === 'Four')!.sessionId).toBe('tbd--');
    expect(m.warnings.map((w) => w.code).filter((c) => c !== 'no-export').sort()).toEqual(['bad-session', 'missing-name', 'unknown-type']);
  });
});
