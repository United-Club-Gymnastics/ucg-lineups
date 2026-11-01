// Invented people only.
import { describe, expect, it } from 'vitest';
import type { StoredAthlete } from '../../src/lib/import/diff';
import type { Session } from '../../src/lib/import/types';
import { csvCell, fieldPrefix, fileSafe, icontactAthleteExport, sessionLine } from '../../src/lib/icontact-export';
import { LINEUPS_SESSION_TEMPLATE } from '../../src/lib/session-details';

const ath = (o: Partial<StoredAthlete> & { first: string; clubId: string }): StoredAthlete => ({
  id: `WAG_${o.clubId}_${o.first.toLowerCase()}`, discipline: 'WAG', last: 'Test', clubName: `${o.clubId[0].toUpperCase()}${o.clubId.slice(1)} Gym`,
  independent: false, levelCode: 'XS', levelName: 'Silver', sessionId: 's1-orange', apparatus: ['VT'], competes: true, ...o,
});

const S1: Session = { id: 's1-orange', name: 'Session 1', location: 'Orange', number: 1, discipline: 'WAG', levelCodes: ['XS'] };
const S2: Session = { id: 's2-red', name: 'Session 2', location: 'Red', number: 2, discipline: 'MAG', levelCodes: ['XS'] };
const TIMES = { date: '2027-04-09', stretch: '07:30', warmups: '08:00', competition: '08:45' };

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

describe('iContact athlete export', () => {
  const out = icontactAthleteExport({
    meetName: 'Test Meet 2027', meetId: 'm1', linkBase: 'https://lineups.example.org/', athletes: ATHLETES, clubs: CLUBS,
    coachRoles: ['Licensed Coach'], template: LINEUPS_SESSION_TEMPLATE,
    sessions: [{ session: S1, schedule: TIMES }, { session: S2, schedule: TIMES }],
  });

  it('one contact per address with its sessions in fields named for the meet; coaches left out, shared addresses merged', () => {
    expect(out.fields).toEqual(['testmeet2027_session1', 'testmeet2027_session2', 'testmeet2027_sheets']);
    expect(out.contacts).toBe(3);
    expect(out.multiSession).toBe(1);
    const line1 = 'Session 1 - Orange (WAG): Friday, April 9, 2027 | Open stretch 7:30 AM | Warm-ups 8:00 AM | Competition 8:45 AM';
    const line2 = 'Session 2 - Red (MAG): Friday, April 9, 2027 | Open stretch 7:30 AM | Warm-ups 8:00 AM | Competition 8:45 AM';
    expect(out.csv.split('\r\n')).toEqual([
      'Email,First Name,Last Name,testmeet2027_session1,testmeet2027_session2,testmeet2027_sheets',
      `ada@example.org,Ada,Test,"${line1}","${line2}","https://lineups.example.org/#/sheets/m1?s=s1-orange,s2-red"`,
      `bea@example.org,Bea,"O""Neil, Jr","${line1}",,https://lineups.example.org/#/sheets/m1/s1-orange?doc=rotation`,
      `family@example.org,Ava & Mia,,"${line1}",,https://lineups.example.org/#/sheets/m1/s1-orange?doc=rotation`,
      '',
    ]);
  });

  it('one email with the merge tags, the saved text and no addresses', () => {
    expect(out.html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(out.html).toContain('Hello [fname]!');
    expect(out.html).toContain('[testmeet2027_session1]');
    expect(out.html).toContain('[testmeet2027_session2]');
    expect(out.html).toContain('href="[testmeet2027_sheets]"');
    expect(out.html).toContain('We are so excited to have you at Test Meet 2027.');
    expect(out.html).not.toContain('ada@example.org');
    expect(out.subject).toBe('Test Meet 2027: Session Information');
  });

  it('zip files: contacts, email and the steps', () => {
    expect(out.files.map((f) => f.name)).toEqual(['Test Meet 2027 - contacts.csv', 'Test Meet 2027 - email.html', 'How to use.txt']);
    const how = out.files[2].content;
    expect(how).toContain('testmeet2027_sheets');
    expect(how).toContain('Test Meet 2027: Session Information');
  });

  it('takes another merge tag and prefix', () => {
    const o = icontactAthleteExport({
      meetName: '', meetId: 'm1', linkBase: 'https://x.example/', athletes: ATHLETES, clubs: CLUBS, coachRoles: [], template: LINEUPS_SESSION_TEMPLATE,
      sessions: [{ session: S1, schedule: TIMES }], firstNameTag: ' [first_name] ', prefix: 'Nats 27!',
    });
    expect(o.html).toContain('Hello [first_name]!');
    expect(o.fields).toEqual(['nats27_session1', 'nats27_sheets']);
  });
});

describe('csv and file name helpers', () => {
  it('quotes and guards cells', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
  });
  it('field prefix from the meet name', () => {
    expect(fieldPrefix('UCG Nationals 2027')).toBe('ucgnationals2027');
    expect(fieldPrefix(' — ')).toBe('meet');
  });
  it('session line without times is just the session', () => {
    expect(sessionLine(S2, { date: '', stretch: '', warmups: '', competition: '' })).toBe('Session 2 - Red (MAG)');
  });
  it('makes file-safe names', () => {
    expect(fileSafe('MAG Finals / Dupont: "A"')).toBe('MAG Finals - Dupont- -A-');
  });
});
