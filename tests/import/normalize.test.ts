import { describe, expect, it } from 'vitest';
import { assembleInput } from '../../src/lib/import/assemble';
import { detectWorkbook, type Detected } from '../../src/lib/import/detect';
import { mapLevel, normalizeImport, parseSession, slug, splitEmails, tntLevelCode } from '../../src/lib/import/normalize';
import { readWorkbook } from '../../src/lib/import/read-workbook';
import { ATH_HEADERS, MAG_HEADERS, TNT_HEADERS, WAG_HEADERS, athRow, makeWorkbook } from './helpers';

const a = (o: Partial<Parameters<typeof athRow>[0]> & { bib: string }) =>
  athRow({ first: 'Ada', last: 'Test', level: 'Platinum', short: 'XP', type: 'WAG', club: 'Alpha Gymnastics', session: 'Session 1 - Orange', ...o });

async function run(sheets: {
  ath: unknown[][]; wag?: unknown[][]; mag?: unknown[][]; tnt?: unknown[][]; emails?: unknown[][];
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
  await add(sheets.emails, ['Club', 'Email']);
  return normalizeImport(assembleInput(found)!);
}

const noNoise = (m: { warnings: { code: string }[] }) => m.warnings.filter((w) => w.code !== 'no-export');

describe('helpers', () => {
  it('parses sessions', () => {
    expect(parseSession('Session 1 - Orange')).toEqual({ number: 1, gym: 'Orange' });
    expect(parseSession('session 12 – purple')).toEqual({ number: 12, gym: 'Purple' });
    expect(parseSession('Brunch')).toBeNull();
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
    const wag = m.athletes.find((x) => x.id === 'WAG_0398')!;
    expect(wag).toMatchObject({
      discipline: 'WAG', bib: '0398', first: 'Bo', clubId: 'alpha-gymnastics', clubName: 'Alpha Gymnastics',
      independent: false, levelCode: 'XP', levelName: 'Platinum', sessionId: 's1-orange',
      apparatus: ['VT', 'BB', 'FX'], competes: true,
    });
    expect(wag.tnt).toBeUndefined();
    expect(JSON.stringify(m)).not.toContain('IGNORED');
    const mag = m.athletes.find((x) => x.id === 'MAG_12')!;
    expect(mag.apparatus).toEqual(['FX', 'PH', 'VT', 'PB', 'HB']);
    expect(mag.levelName).toBe('Developmental');
    expect(m.sessions.map((s) => s.id)).toEqual(['s1-orange', 's2-green']);
    expect(m.sessions[0]).toEqual({ id: 's1-orange', number: 1, gym: 'Orange', discipline: 'WAG', levelCodes: ['XP'] });
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
    expect(m.athletes.filter((x) => x.independent).map((x) => x.bib)).toEqual(['1', '2']);
    expect(m.clubs.map((c) => c.name)).toEqual(['Alpha Gymnastics']);
    expect(noNoise(m)).toEqual([]);
  });

  it('keys by discipline + bib so one person in several disciplines is separate', async () => {
    const m = await run({
      ath: [a({ bib: '55' }), a({ bib: '55', type: 'MAG', level: 'NAIGC Intermediate', short: 'Int' }), a({ bib: '55', type: 'T&T', level: 'New Flyers', short: 'NF' })],
    });
    expect(m.athletes.map((x) => x.id)).toEqual(['WAG_55', 'MAG_55', 'TNT_55']);
  });

  it('keeps different people who share a bib, with name-suffixed ids and one warning', async () => {
    const m = await run({
      ath: [a({ bib: '1014', first: 'Una', club: 'Alpha Gymnastics' }), a({ bib: '1014', first: 'Dos', club: 'Beta Club' })],
      wag: [
        ['Una', 'Test', '1014', 'Platinum', 'Included', 'Included', 'Scratched', 'Scratched'],
        ['Dos', 'Test', '1014', 'Platinum', 'Scratched', 'Scratched', 'Scratched', 'Included'],
      ],
    });
    expect(m.athletes.map((x) => x.id)).toEqual(['WAG_1014~una-test', 'WAG_1014~dos-test']);
    expect(m.athletes[0].apparatus).toEqual(['VT', 'UB']);
    expect(m.athletes[1].apparatus).toEqual(['FX']);
    expect(m.warnings.filter((w) => w.code === 'shared-bib')).toHaveLength(1);
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
      ath: [a({ bib: '1' }), a({ bib: '2' })],
      wag: [['Ada', 'Test', '1', 'Platinum', 'Included', 'Included', 'Included', 'Included'], ['Zoe', 'Ghost', '99', 'Platinum', 'Included', 'Included', 'Included', 'Included']],
    });
    const two = m.athletes.find((x) => x.bib === '2')!;
    expect(two).toMatchObject({ apparatus: [], competes: false });
    expect(m.warnings.map((w) => w.code).sort()).toEqual(['not-in-export', 'unmatched-row']);
  });

  it('warns once per discipline when its export is not supplied at all', async () => {
    const m = await run({ ath: [a({ bib: '1' }), a({ bib: '2' })] });
    expect(m.warnings).toEqual([expect.objectContaining({ code: 'no-export' })]);
  });

  it('reads T&T per-event levels, only for Included events, incl. synchro-only', async () => {
    const m = await run({
      ath: [
        a({ bib: '1', type: 'T&T', level: 'New Flyers', short: 'NF' }),
        a({ bib: '2', type: 'T&T', level: 'High Flyers', short: 'HF' }),
        a({ bib: '3', type: 'T&T', level: 'New Flyers', short: 'NF' }),
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

  it('warns about clubs without emails and email rows with no athletes (only when an email file is given)', async () => {
    const m = await run({ ath: [a({ bib: '1' })], emails: [['Ghost Club', 'g@x.org']] });
    expect(noNoise(m).map((w) => w.code).sort()).toEqual(['email-unmatched', 'no-email']);
    expect(noNoise(await run({ ath: [a({ bib: '1' })] }))).toEqual([]);
  });

  it('flags unreadable sessions, missing bibs and unknown types, and sorts sessions by gym order', async () => {
    const m = await run({
      ath: [
        a({ bib: '1', session: 'Session 2 - Green' }),
        a({ bib: '2', session: 'Session 2 - Red' }),
        a({ bib: '3', session: 'Session 1 - Purple' }),
        a({ bib: '4', session: 'TBD' }),
        a({ bib: '', first: 'No' }),
        a({ bib: '6', type: 'Rhythmic' }),
      ],
    });
    expect(m.sessions.map((s) => s.id)).toEqual(['s1-purple', 's2-green', 's2-red']);
    expect(m.athletes.find((x) => x.bib === '4')!.sessionId).toBe('');
    expect(m.warnings.map((w) => w.code).filter((c) => c !== 'no-export').sort()).toEqual(['bad-session', 'missing-bib', 'unknown-type']);
  });
});
