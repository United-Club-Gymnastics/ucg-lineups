import { describe, expect, it } from 'vitest';
import { assembleInput } from '../../src/lib/import/assemble';
import { detectWorkbook, type Detected } from '../../src/lib/import/detect';
import { normalizeImport } from '../../src/lib/import/normalize';
import { readWorkbook } from '../../src/lib/import/read-workbook';
import { buildClubLinks } from '../../src/lib/club-links';
import { orderFor, scorecardOrder, rotationOrder, sessionFileName, collate, sessionPages } from '../../src/lib/pdf/collate';
import { resolveSchedule } from '../../src/lib/schedule';
import { toStoredSession } from '../../src/lib/data/store';
import {
  locationLabel, naturalCompare, parseSessionString, safeFileText, scheduleKey, scheduleRows, sessionFileBase, sessionIdFor,
  sessionShortLabel, sessionTitle, sortByLocation, sortByName,
} from '../../src/lib/session-names';
import { buildArtisticSessionInput } from '../../src/lib/pdf/session-input';
import { MEET, magFixture } from '../pdf/fixtures';
import { ATH_HEADERS, athRow, makeWorkbook } from '../import/helpers';

const ORDER = ['Green', 'Red', 'Yellow', 'Orange', 'Purple'];
const s = (name: string, location: string) => ({ name, location });

describe('parseSessionString', () => {
  it('reads the three kinds of ScoreFlippers session', () => {
    expect(parseSessionString('MAG Finals - Orange')).toEqual({ name: 'MAG Finals', location: 'Orange', hasLocation: true });
    expect(parseSessionString('Xcel Platinum Finals - Green')).toEqual({ name: 'Xcel Platinum Finals', location: 'Green', hasLocation: true });
    expect(parseSessionString('MAG Session 1 - Dupont')).toEqual({ name: 'MAG Session 1', location: 'Dupont', hasLocation: true });
    expect(parseSessionString('Session 1 - Orange')).toEqual({ name: 'Session 1', location: 'Orange', number: 1, hasLocation: true });
  });
  it('accepts en and em dashes with spaces around them', () => {
    expect(parseSessionString('MAG Finals – Orange')).toMatchObject({ name: 'MAG Finals', location: 'Orange' });
    expect(parseSessionString('MAG Finals — Orange')).toMatchObject({ name: 'MAG Finals', location: 'Orange' });
    expect(parseSessionString('  MAG   Finals  -  Orange ')).toMatchObject({ name: 'MAG Finals', location: 'Orange' });
  });
  it('splits at the LAST separator, so a name can hold hyphens', () => {
    expect(parseSessionString('Xcel Platinum - Day 2 - Green')).toMatchObject({ name: 'Xcel Platinum - Day 2', location: 'Green' });
    expect(parseSessionString('Co-ed Open - Green')).toMatchObject({ name: 'Co-ed Open', location: 'Green' });
  });
  it('no separator: the whole string is the name, the location is empty', () => {
    expect(parseSessionString('Brunch')).toEqual({ name: 'Brunch', location: '', hasLocation: false });
    expect(parseSessionString('')).toBeNull();
    expect(parseSessionString('   ')).toBeNull();
  });
  it('keeps the older loose Session forms working', () => {
    expect(parseSessionString('Session 3-Red')).toMatchObject({ name: 'Session 3', location: 'Red', number: 3 });
    expect(parseSessionString('session 12: purple')).toMatchObject({ name: 'Session 12', location: 'Purple', number: 12 });
    expect(parseSessionString('Session 2 Green')).toMatchObject({ name: 'Session 2', location: 'Green', number: 2 });
  });
  it('number only when the name is exactly Session N', () => {
    expect(parseSessionString('MAG Session 1 - Dupont')!.number).toBeUndefined();
    expect(parseSessionString('Session 1 Finals - Dupont')!.number).toBeUndefined();
    expect(parseSessionString('SESSION 4 - blue')).toMatchObject({ name: 'Session 4', location: 'Blue', number: 4 });
  });
});

describe('back-compat: ids and schedule keys of "Session N - <gym>" are unchanged', () => {
  const cases: [string, string, string][] = [
    ['Session 1 - Orange', 's1-orange', '1'],
    ['session 12 – purple', 's12-purple', '12'],
    ['Session 2 - GREEN', 's2-green', '2'],
    ['Session 6 - Yellow', 's6-yellow', '6'],
  ];
  it.each(cases)('%s -> %s, key %s', (raw, id, key) => {
    const p = parseSessionString(raw)!;
    expect(sessionIdFor(p)).toBe(id);
    expect(scheduleKey(p)).toBe(key);
  });
  it('other names get <name slug>--<location slug>; schedule key is the name as typed', () => {
    const p = parseSessionString('MAG Finals - Orange')!;
    expect(sessionIdFor(p)).toBe('mag-finals--orange');
    expect(scheduleKey(p)).toBe('MAG Finals');
    const d = parseSessionString('MAG Session 1 - Dupont')!;
    expect(sessionIdFor(d)).toBe('mag-session-1--dupont');
    expect(sessionIdFor(parseSessionString('Xcel Platinum - Day 2 - Green')!)).toBe('xcel-platinum-day-2--green');
  });
  it('a session stored before names existed (number + gym) reads as Session N at gym', () => {
    const old = toStoredSession('s1-orange', { number: 1, gym: 'Orange', discipline: 'MAG', levelCodes: ['Dev'] });
    expect(old).toMatchObject({ id: 's1-orange', name: 'Session 1', location: 'Orange', number: 1 });
    expect(scheduleKey(old)).toBe('1');
    expect(sessionTitle(old)).toBe('Session 1 – Orange');
    expect(sessionTitle({ number: 3, gym: 'Red' })).toBe('Session 3 – Red');
    const next = toStoredSession('mag-finals--orange', { name: 'MAG Finals', location: 'Orange', gym: 'Orange', discipline: 'MAG', levelCodes: [] });
    expect(next.number).toBeUndefined();
  });
  it('the old schedule row "1" still resolves for Session 1 at every gym', () => {
    const rows = { '1': { date: '2026-10-22', competition: '7:30 AM' } };
    expect(resolveSchedule(scheduleKey({ number: 1, gym: 'Orange' }), rows, undefined).competition).toBe('7:30 AM');
    expect(resolveSchedule(scheduleKey({ name: 'Session 1', location: 'Green', number: 1 }), rows, undefined).date).toBe('2026-10-22');
    expect(resolveSchedule(1, rows, undefined).competition).toBe('7:30 AM');
  });
});

describe('import', () => {
  async function run(sessions: string[]) {
    const found: Detected[] = [];
    const rows = sessions.map((session, i) => athRow({ bib: '', first: `Ada${i}`, last: 'Test', level: 'Platinum', short: 'XP', type: 'MAG', club: 'Alpha Gymnastics', session }));
    found.push(detectWorkbook(await readWorkbook(await makeWorkbook({ Sheet: [ATH_HEADERS, ...rows] as never })))!);
    return normalizeImport(assembleInput(found)!);
  }
  it('reads the new formats into sessions with no bad-session warning', async () => {
    const m = await run(['MAG Finals - Orange', 'Xcel Platinum Finals - Green', 'MAG Session 1 - Dupont', 'MAG Session 1 - Dupont', 'Session 1 - Orange']);
    expect(m.warnings.filter((w) => w.code === 'bad-session')).toEqual([]);
    expect(m.sessions.map((x) => x.id).sort()).toEqual(['mag-finals--orange', 'mag-session-1--dupont', 's1-orange', 'xcel-platinum-finals--green']);
    expect(m.sessions.find((x) => x.id === 'mag-session-1--dupont')).toMatchObject({ name: 'MAG Session 1', location: 'Dupont', discipline: 'MAG' });
    expect(m.sessions.find((x) => x.id === 's1-orange')).toMatchObject({ name: 'Session 1', location: 'Orange', number: 1 });
    expect(m.athletes.every((x) => x.sessionId !== '')).toBe(true);
  });
  it('one warning per distinct string with no location', async () => {
    const m = await run(['Finals', 'Finals', 'Finals', 'Session 1 - Orange']);
    expect(m.warnings.filter((w) => w.code === 'bad-session')).toHaveLength(1);
    expect(m.sessions.find((x) => x.id === 'finals--')).toMatchObject({ name: 'Finals', location: '' });
  });
});

describe('labels', () => {
  it('a single colour word prints as "<Colour> Gym"; a venue prints as written', () => {
    for (const c of ['Green', 'Red', 'Yellow', 'Orange', 'Purple', 'Blue', 'Teal', 'Pink', 'White', 'Black', 'Gray', 'Grey', 'Brown', 'Gold', 'Silver']) expect(locationLabel(c)).toBe(`${c} Gym`);
    expect(locationLabel('orange')).toBe('Orange Gym');
    expect(locationLabel('Dupont')).toBe('Dupont');
    expect(locationLabel('Green Hall')).toBe('Green Hall');
    expect(locationLabel('')).toBe('');
  });
  it('titles and short labels follow <name> – <location>', () => {
    expect(sessionTitle(s('MAG Finals', 'Orange'))).toBe('MAG Finals – Orange');
    expect(sessionTitle(s('MAG Session 1', 'Dupont'))).toBe('MAG Session 1 – Dupont');
    expect(sessionShortLabel(s('Session 1', 'Orange'))).toBe('Session 1 · Orange');
    expect(sessionTitle(s('Brunch', ''))).toBe('Brunch');
  });
});

describe('natural sort and ordering', () => {
  it('Session 2 before Session 10', () => {
    expect(['Session 10', 'Session 2', 'Session 1'].sort(naturalCompare)).toEqual(['Session 1', 'Session 2', 'Session 10']);
  });
  const list = [s('Session 10', 'Green'), s('MAG Finals', 'Orange'), s('Session 2', 'Green'), s('Session 2', 'Dupont'), s('Session 2', 'Orange'), s('Session 2', 'Aspen')];
  it('by location (the meet order, then A-Z), then name', () => {
    expect(sortByLocation(list, ORDER).map(sessionTitle)).toEqual([
      'Session 2 – Green', 'Session 10 – Green', 'MAG Finals – Orange', 'Session 2 – Orange', 'Session 2 – Aspen', 'Session 2 – Dupont',
    ]);
  });
  it('by name (natural), then location', () => {
    expect(sortByName(list, ORDER).map(sessionTitle)).toEqual([
      'MAG Finals – Orange', 'Session 2 – Green', 'Session 2 – Orange', 'Session 2 – Aspen', 'Session 2 – Dupont', 'Session 10 – Green',
    ]);
  });
  it('the location order setting accepts any location names', () => {
    const order = ['Dupont', 'Aspen'];
    expect(sortByLocation(list, order).map((x) => x.location)).toEqual(['Dupont', 'Aspen', 'Green', 'Green', 'Orange', 'Orange']);
  });
  it('collation: scorecards by location then name; rotation sheets by name then location', () => {
    expect(scorecardOrder(list, ORDER).map(sessionTitle)[0]).toBe('Session 2 – Green');
    expect(rotationOrder(list, ORDER).map(sessionTitle)).toEqual(sortByName(list, ORDER).map(sessionTitle));
    expect(orderFor('scorecards', list, ORDER)).toEqual(scorecardOrder(list, ORDER));
    expect(orderFor('rotation', list, ORDER)).toEqual(rotationOrder(list, ORDER));
  });
});

describe('schedule rows', () => {
  it('one row per distinct name: every location shares it', () => {
    const rows = scheduleRows([s('Session 1', 'Green'), s('Session 1', 'Red'), s('MAG Finals', 'Orange'), s('MAG Finals', 'Green'), s('Session 10', 'Red'), s('Session 2', 'Red')]);
    expect(rows.map((r) => r.label)).toEqual(['MAG Finals', 'Session 1', 'Session 2', 'Session 10']);
  });
  it('stores Session N under "N" and other names as typed; matching ignores case', () => {
    const rows = scheduleRows([{ name: 'Session 1', location: 'Green', number: 1 }, s('mag finals', 'Orange')], { 'MAG Finals': { date: '2026-10-23' } });
    expect(rows.map((r) => r.key).sort()).toEqual(['1', 'MAG Finals']);
    const sched = { 'MAG Finals': { date: '2026-10-23', competition: '9:00 AM' }, '1': { competition: '7:30 AM' } };
    expect(resolveSchedule(scheduleKey(s('mag FINALS', 'Orange')), sched, undefined).competition).toBe('9:00 AM');
    expect(resolveSchedule('MAG Finals', sched, { competition: '10:00 AM' }).competition).toBe('10:00 AM');
  });
});

describe('file names', () => {
  it('<name> - <location> - Scorecards.pdf / Rotation Sheet.pdf', () => {
    expect(sessionFileName('scorecards', s('Session 1', 'Green'))).toBe('Session 1 - Green - Scorecards.pdf');
    expect(sessionFileName('rotation', s('MAG Finals', 'Orange'))).toBe('MAG Finals - Orange - Rotation Sheet.pdf');
    expect(sessionFileName('scorecards', s('Xcel Platinum - Day 2', 'Green'))).toBe('Xcel Platinum - Day 2 - Green - Scorecards.pdf');
    expect(sessionFileName('scorecards', s('Brunch', ''))).toBe('Brunch - Scorecards.pdf');
  });
  it('strips characters a file name cannot hold', () => {
    expect(safeFileText('Level 4/5: "Finals"?')).toBe('Level 45 Finals');
    expect(sessionFileBase(s('A*B|C<D>', 'Hall\\1'))).toBe('ABCD - Hall1');
    expect(sessionFileName('rotation', s('Level 4/5', 'Green'))).toBe('Level 45 - Green - Rotation Sheet.pdf');
  });
  it('collate keeps zip entries unique when stripping makes two names equal', () => {
    const mag = magFixture();
    const input = buildArtisticSessionInput({ session: mag.session, athletes: mag.athletes, ordersByClub: mag.ordersByClub, stored: mag.stored, meet: MEET });
    const ses = ['A/B', 'AB'].map((name, i) => ({ type: 'artistic' as const, id: `x${i}`, name, location: 'Green', input }));
    expect(collate('scorecards', ses, ORDER, 'x').map((d) => d.file)).toEqual(['AB - Green - Scorecards.pdf', 'AB - Green - Scorecards (2).pdf']);
  });
});

describe('club links', () => {
  it('carry name, location and a label; Session N links keep gym and number', () => {
    const sessions = [
      { id: 's1-orange', name: 'Session 1', location: 'Orange', number: 1, discipline: 'MAG' as const, levelCodes: ['Dev'] },
      { id: 'mag-finals--dupont', name: 'MAG Finals', location: 'Dupont', discipline: 'MAG' as const, levelCodes: ['Dev'] },
    ];
    const ath = sessions.map((x, i) => ({ id: `a${i}`, first: 'Ada', last: 'Test', clubId: 'c', independent: false, levelCode: 'Dev', levelName: 'Dev', sessionId: x.id, apparatus: ['FX'], competes: true, discipline: 'MAG' as const }));
    const [link] = buildClubLinks(ath, sessions, [{ id: 'c', name: 'Alpha', token: 't' }], ORDER, 'm1');
    expect(link.doc.sessions.map((x) => x.label)).toEqual(['MAG Finals · Dupont', 'Session 1 · Orange']);
    expect(link.doc.sessions[1]).toMatchObject({ name: 'Session 1', location: 'Orange', gym: 'Orange', number: 1 });
    expect(link.doc.sessions[0].number).toBeUndefined();
  });
});

describe('PDF headers', () => {
  const mag = magFixture();
  const make = (name: string, location: string) => {
    const input = buildArtisticSessionInput({ session: { ...mag.session, name, location }, athletes: mag.athletes, ordersByClub: mag.ordersByClub, stored: mag.stored, meet: MEET });
    return { type: 'artistic' as const, id: 'x', name, location, input };
  };
  it('a colour gym keeps "Orange Gym"; a venue prints as written', () => {
    const colour = sessionPages('scorecards', make('MAG Finals', 'Orange'), 'x');
    expect(colour[0]).toMatchObject({ gym: 'Orange Gym', session: 'MAG Finals – Orange' });
    const venue = sessionPages('scorecards', make('MAG Session 1', 'Dupont'), 'x');
    expect(venue[0]).toMatchObject({ gym: 'Dupont', session: 'MAG Session 1 – Dupont' });
    const rot = sessionPages('rotation', make('MAG Session 1', 'Dupont'), 'x')[0];
    expect(rot).toMatchObject({ title: `${MEET.name} – MAG Session 1 – Dupont` });
    expect(JSON.stringify(rot)).toContain('MAG – Dupont');
    const rotColour = sessionPages('rotation', make('Session 1', 'Orange'), 'x')[0];
    expect(JSON.stringify(rotColour)).toContain('MAG – Orange Gym');
  });
});
