// Invented people only.
import { describe, expect, it } from 'vitest';
import type { StoredAthlete } from '../../src/lib/import/diff';
import type { Session } from '../../src/lib/import/types';
import { csvCell, fileSafe, ICONTACT_FIELDS, icontactAthleteExport, icontactTimesText } from '../../src/lib/icontact-export';
import { DEFAULT_SESSION_TEMPLATES, LINEUPS_SESSION_TEMPLATE } from '../../src/lib/session-details';

const ath = (o: Partial<StoredAthlete> & { first: string; clubId: string }): StoredAthlete => ({
  id: `WAG_${o.clubId}_${o.first.toLowerCase()}`, discipline: 'WAG', last: 'Test', clubName: `${o.clubId[0].toUpperCase()}${o.clubId.slice(1)} Gym`,
  independent: false, levelCode: 'XS', levelName: 'Silver', sessionId: 's1-orange', apparatus: ['VT'], competes: true, ...o,
});

const S1: Session = { id: 's1-orange', name: 'Session 1', location: 'Orange', number: 1, discipline: 'WAG', levelCodes: ['XS'] };
const S2: Session = { id: 's2-red', name: 'Session 2', location: 'Red', number: 2, discipline: 'MAG', levelCodes: ['XS'] };

const ATHLETES: StoredAthlete[] = [
  ath({ first: 'Ada', clubId: 'alpha', email: 'ada@example.org' }),
  ath({ first: 'Bea', clubId: 'alpha', last: 'O"Neil, Jr', email: 'bea@example.org' }),
  ath({ first: 'Cy', clubId: 'alpha' }),
  // Two people sharing one address in the same session become one row.
  ath({ first: 'Mia', clubId: 'bravo', email: 'family@example.org' }),
  ath({ first: 'Ava', clubId: 'bravo', email: 'family@example.org' }),
  // Hal coaches Bravo too: Lineups sends him the coach email, so he is not in the iContact list.
  ath({ first: 'Hal', clubId: 'bravo', email: 'hal@example.org' }),
  // Ada in a second discipline: she is on that session's list as well.
  ath({ first: 'Ada', clubId: 'alpha', email: 'ada@example.org', id: 'MAG_alpha_ada', discipline: 'MAG', sessionId: 's2-red' }),
];
const CLUBS = [
  { id: 'alpha', name: 'Alpha Gym', contacts: [] },
  { id: 'bravo', name: 'Bravo Gym', contacts: [{ name: 'Hal Test', email: 'hal@example.org', role: 'Licensed Coach' }] },
];

const TEMPLATES = { ...DEFAULT_SESSION_TEMPLATES, MAG: { ...LINEUPS_SESSION_TEMPLATE, intro: 'MAG only: bring grips.' } };

describe('iContact athlete export', () => {
  const out = icontactAthleteExport({
    meetName: 'Test Meet 2027', meetId: 'm1', linkBase: 'https://lineups.example.org/', athletes: ATHLETES, clubs: CLUBS,
    coachRoles: ['Licensed Coach'], templates: TEMPLATES, sessions: [S1, S2],
    schedules: {
      's1-orange': { date: '2027-04-09', stretch: '7:30', warmups: '8:00', competition: '8:45' },
      's2-red': { date: '2027-04-10', stretch: '', warmups: '', competition: '1:00 PM' },
    },
  });
  const L = 'https://lineups.example.org/#/sheets/m1';
  const [wag, mag] = out.lists;

  it("one list per discipline with that discipline's fields; coaches left out, shared addresses merged", () => {
    expect(out.lists.map((l) => [l.discipline, l.list, l.contacts])).toEqual([['WAG', 'Test Meet 2027 - WAG', 3], ['MAG', 'Test Meet 2027 - MAG', 1]]);
    expect(out.people).toBe(3);
    expect(wag.fields).toEqual(['wagsession', 'wagtimes', 'wagrotation', 'wagscorecard']);
    expect(ICONTACT_FIELDS).toHaveLength(12);
    const s1 = `Session 1 - Orange (WAG),"Friday, April 9, 2027 · Open stretch 7:30 AM",${L}/s1-orange?doc=rotation,${L}/s1-orange?doc=scorecards`;
    expect(wag.csv.split('\r\n')).toEqual([
      'Email,First Name,Last Name,wagsession,wagtimes,wagrotation,wagscorecard',
      `ada@example.org,Ada,Test,${s1}`,
      `bea@example.org,Bea,"O""Neil, Jr",${s1}`,
      `family@example.org,Ava & Mia,,${s1}`,
      '',
    ]);
    expect(mag.csv.split('\r\n')).toEqual([
      'Email,First Name,Last Name,magsession,magtimes,magrotation,magscorecard',
      `ada@example.org,Ada,Test,Session 2 - Red (MAG),"Saturday, April 10, 2027",${L}/s2-red?doc=rotation,${L}/s2-red?doc=scorecards`,
      '',
    ]);
  });

  it("each email is the athlete email from its discipline's text, with that discipline's tags", () => {
    expect(wag.html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(wag.html).toContain('Hello [fname]!');
    expect(wag.html).toContain('[wagsession]: Competition Details');
    expect(wag.html).toContain('>[wagtimes]</div>');
    expect(wag.html).toContain('<a href="[wagrotation]"');
    expect(wag.html).toContain('<a href="[wagscorecard]"');
    expect(wag.html).not.toMatch(/\[mag|invalid/);
    expect(wag.html).toContain('We are so excited to have you at Test Meet 2027.');
    expect(mag.html).toContain('MAG only: bring grips.');
    expect(mag.html).toContain('<a href="[magrotation]"');
    expect(wag.html).not.toContain('ada@example.org');
    expect(wag.subject).toBe('Test Meet 2027: WAG Session Information');
    expect(mag.subject).toBe('Test Meet 2027: MAG Session Information');
  });

  it('zip files: contacts and email per list, then the steps', () => {
    expect(out.files.map((f) => f.name)).toEqual([
      'Test Meet 2027 - WAG contacts.csv', 'Test Meet 2027 - WAG email.html', 'Test Meet 2027 - MAG contacts.csv', 'Test Meet 2027 - MAG email.html', 'How to use.txt',
    ]);
    const how = out.files[4].content;
    expect(how).toContain('wagsession, wagtimes, wagrotation');
    expect(how).toContain('Test Meet 2027: MAG Session Information');
    expect(how).toContain('new list named "Test Meet 2027 - MAG"');
  });

  it('T&T files say "and" in the name', () => {
    const S3: Session = { ...S1, id: 's3-tnt', discipline: 'TNT' };
    const o = icontactAthleteExport({
      meetName: 'M', meetId: 'm1', linkBase: 'https://x.example/', clubs: CLUBS, coachRoles: [], templates: DEFAULT_SESSION_TEMPLATES, sessions: [S3], schedules: {},
      athletes: [ath({ first: 'Tia', clubId: 'alpha', email: 'tia@example.org', id: 'TNT_alpha_tia', discipline: 'TNT', sessionId: 's3-tnt' })],
    });
    expect(o.files.map((f) => f.name)).toEqual(['M - TandT contacts.csv', 'M - TandT email.html', 'How to use.txt']);
    expect(o.lists[0].subject).toBe('M: T&T Session Information');
  });

  it('two people at one address in two sessions of one discipline: the first session, and the address is listed', () => {
    const S3: Session = { ...S1, id: 's3-blue', name: 'Session 3', location: 'Blue' };
    const o = icontactAthleteExport({
      meetName: 'M', meetId: 'm1', linkBase: 'https://x.example/', clubs: CLUBS, coachRoles: [], templates: DEFAULT_SESSION_TEMPLATES, sessions: [S1, S3], schedules: {},
      athletes: [ath({ first: 'Mia', clubId: 'bravo', email: 'family@example.org' }), ath({ first: 'Ava', clubId: 'bravo', email: 'family@example.org', sessionId: 's3-blue' })],
    });
    expect(o.lists[0].clashes).toEqual(['family@example.org']);
    expect(o.lists[0].csv.split('\r\n')[1].startsWith('family@example.org,Mia & Ava,,Session 1 - Orange (WAG),')).toBe(true);
    expect(o.files.at(-1)!.content).toContain('     family@example.org');
  });

  it('takes another first-name tag', () => {
    const o = icontactAthleteExport({
      meetName: '', meetId: 'm1', linkBase: 'https://x.example/', athletes: ATHLETES, clubs: CLUBS, coachRoles: [], templates: DEFAULT_SESSION_TEMPLATES,
      sessions: [S1], schedules: {}, firstNameTag: ' [first_name] ',
    });
    expect(o.lists[0].html).toContain('Hello [first_name]!');
  });
});

describe('times field', () => {
  it('date and open stretch, only the parts that are set', () => {
    expect(icontactTimesText({ date: '2027-04-09', stretch: '7:30 AM', warmups: '8:00', competition: '' })).toBe('Friday, April 9, 2027 · Open stretch 7:30 AM');
    expect(icontactTimesText({ date: '', stretch: '13:15', warmups: '', competition: '' })).toBe('Open stretch 1:15 PM');
    expect(icontactTimesText({ date: '', stretch: '', warmups: '', competition: '' })).toBe('');
    expect(icontactTimesText(undefined)).toBe('');
  });
});

describe('csv and file name helpers', () => {
  it('quotes and guards cells', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
  });
  it('makes file-safe names', () => {
    expect(fileSafe('MAG Finals / Dupont: "A"')).toBe('MAG Finals - Dupont- -A-');
  });
});
