// Invented people only.
import { describe, expect, it } from 'vitest';
import type { StoredAthlete } from '../../src/lib/import/diff';
import type { Session } from '../../src/lib/import/types';
import { csvCell, fileSafe, icontactAthleteExport } from '../../src/lib/icontact-export';
import { LINEUPS_SESSION_TEMPLATE } from '../../src/lib/session-details';

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

describe('iContact athlete export', () => {
  const out = icontactAthleteExport({
    meetName: 'Test Meet 2027', meetId: 'm1', linkBase: 'https://lineups.example.org/', athletes: ATHLETES, clubs: CLUBS,
    coachRoles: ['Licensed Coach'], template: LINEUPS_SESSION_TEMPLATE, sessions: [S1, S2],
  });
  const L = 'https://lineups.example.org/#/sheets/m1';

  it("one contact per address with last year's per-discipline fields; coaches left out, shared addresses merged", () => {
    expect(out.fields).toEqual(['wagsession', 'wagrotation', 'wagscorecard', 'magsession', 'magrotation', 'magscorecard', 'tntsession', 'tntrotation', 'tntscorecard']);
    expect(out.contacts).toBe(3);
    expect(out.multiSession).toBe(1);
    expect(out.clashes).toEqual([]);
    const wag = `Session 1 - Orange (WAG),${L}/s1-orange?doc=rotation,${L}/s1-orange?doc=scorecards`;
    expect(out.csv.split('\r\n')).toEqual([
      `Email,First Name,Last Name,${out.fields.join(',')}`,
      `ada@example.org,Ada,Test,${wag},Session 2 - Red (MAG),${L}/s2-red?doc=rotation,${L}/s2-red?doc=scorecards,,,`,
      `bea@example.org,Bea,"O""Neil, Jr",${wag},,,,,,`,
      `family@example.org,Ava & Mia,,${wag},,,,,,`,
      '',
    ]);
  });

  it('one email with the merge tags, the saved text and no addresses', () => {
    expect(out.html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(out.html).toContain('Hello [fname]!');
    for (const d of ['wag', 'mag', 'tnt']) expect(out.html).toContain(`<a href="[${d}rotation]"`);
    expect(out.html).toContain('>[magsession]</a>');
    expect(out.html).toContain('We are so excited to have you at Test Meet 2027.');
    expect(out.html).not.toContain('ada@example.org');
    expect(out.subject).toBe('Test Meet 2027: Session Information');
  });

  it('zip files: contacts, email and the steps', () => {
    expect(out.files.map((f) => f.name)).toEqual(['Test Meet 2027 - contacts.csv', 'Test Meet 2027 - email.html', 'How to use.txt']);
    expect(out.files[2].content).toContain('wagsession, wagrotation');
    expect(out.files[2].content).toContain('Test Meet 2027: Session Information');
  });

  it('two people at one address in two sessions of one discipline: the first session, and the address is listed', () => {
    const S3: Session = { ...S1, id: 's3-blue', name: 'Session 3', location: 'Blue' };
    const o = icontactAthleteExport({
      meetName: 'M', meetId: 'm1', linkBase: 'https://x.example/', clubs: CLUBS, coachRoles: [], template: LINEUPS_SESSION_TEMPLATE, sessions: [S1, S3],
      athletes: [ath({ first: 'Mia', clubId: 'bravo', email: 'family@example.org' }), ath({ first: 'Ava', clubId: 'bravo', email: 'family@example.org', sessionId: 's3-blue' })],
    });
    expect(o.clashes).toEqual(['family@example.org']);
    expect(o.csv.split('\r\n')[1].startsWith('family@example.org,Mia & Ava,,Session 1 - Orange (WAG),')).toBe(true);
    expect(o.files[2].content).toContain('     family@example.org');
  });

  it('takes another first-name tag', () => {
    const o = icontactAthleteExport({
      meetName: '', meetId: 'm1', linkBase: 'https://x.example/', athletes: ATHLETES, clubs: CLUBS, coachRoles: [], template: LINEUPS_SESSION_TEMPLATE,
      sessions: [S1], firstNameTag: ' [first_name] ',
    });
    expect(o.html).toContain('Hello [first_name]!');
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
