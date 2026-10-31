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
    meetName: 'Test Meet', meetId: 'm1', linkBase: 'https://lineups.example.org/', athletes: ATHLETES, clubs: CLUBS,
    coachRoles: ['Licensed Coach'], template: LINEUPS_SESSION_TEMPLATE,
    sessions: [{ session: S1, schedule: TIMES }, { session: S2, schedule: TIMES }],
  });

  it('one contacts list per session: athletes with an address, coaches left out, shared addresses merged', () => {
    expect(out.sessions.map((s) => [s.list, s.contacts])).toEqual([['Session 1 - Orange (WAG)', 3], ['Session 2 - Red (MAG)', 1]]);
    expect(out.total).toBe(4);
    expect(out.sessions[0].csv.split('\r\n')).toEqual([
      'Email,First Name,Last Name,Club',
      'ada@example.org,Ada,Test,Alpha Gym',
      'bea@example.org,Bea,"O""Neil, Jr",Alpha Gym',
      'family@example.org,Ava & Mia,,Bravo Gym',
      '',
    ]);
  });

  it("each session's email is a whole page with the merge tag, that session's times and links", () => {
    const html = out.sessions[0].html;
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('Hello [fname]!');
    expect(html).toContain('7:30 AM');
    expect(html).toContain('#/sheets/m1/s1-orange?doc=rotation');
    expect(html).not.toContain('ada@example.org');
    expect(out.sessions[1].html).toContain('#/sheets/m1/s2-red?doc=scorecards');
  });

  it('numbered file names in session order, with Sessions.csv first', () => {
    expect(out.files.map((f) => f.name)).toEqual([
      'Sessions.csv',
      '01 Session 1 - Orange (WAG) - contacts.csv', '01 Session 1 - Orange (WAG) - email.html',
      '02 Session 2 - Red (MAG) - contacts.csv', '02 Session 2 - Red (MAG) - email.html',
    ]);
    const index = out.files[0].content.split('\r\n');
    expect(index[0]).toBe('#,iContact list,Contacts file,Email file,Subject,Contacts');
    expect(index[1]).toContain('Session 1 - Orange (WAG),01 Session 1 - Orange (WAG) - contacts.csv');
    expect(index[1].endsWith(',3')).toBe(true);
  });

  it('takes another merge tag', () => {
    const o = icontactAthleteExport({
      meetName: '', meetId: 'm1', linkBase: 'https://x.example/', athletes: ATHLETES, clubs: CLUBS, coachRoles: [], template: LINEUPS_SESSION_TEMPLATE,
      sessions: [{ session: S1, schedule: TIMES }], firstNameTag: ' [first_name] ',
    });
    expect(o.sessions[0].html).toContain('Hello [first_name]!');
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
