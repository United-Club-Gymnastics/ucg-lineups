// Invented people only.
import { describe, expect, it } from 'vitest';
import type { StoredAthlete } from '../../src/lib/import/diff';
import type { Session } from '../../src/lib/import/types';
import { DEFAULT_REMINDER_TEMPLATE, buildSessionReminderEmail } from '../../src/lib/email/session-reminder-email';
import {
  buildSessionRecipients, coachRolesOrDefault, contactRoles, LINEUPS_SESSION_TEMPLATE, parseSessionTemplate, publicSheetUrl, sessionEmailContext, sessionEmailLabel,
} from '../../src/lib/session-details';

const ath = (o: Partial<StoredAthlete> & { first: string; clubId: string }): StoredAthlete => ({
  id: `WAG_${o.clubId}_${o.first.toLowerCase()}`, discipline: 'WAG', last: 'Test', clubName: o.clubId === 'indy' ? 'Independent Community Athlete' : `${o.clubId[0].toUpperCase()}${o.clubId.slice(1)} Gym`,
  independent: o.clubId === 'indy', levelCode: 'XS', levelName: 'Silver', sessionId: 's1-orange', apparatus: ['VT'], competes: true, ...o,
});

const ATHLETES: StoredAthlete[] = [
  ath({ first: 'Ada', clubId: 'alpha', email: 'ada@example.org' }),
  ath({ first: 'Bea', clubId: 'alpha' }),
  ath({ first: 'Cy', clubId: 'bravo', email: 'CY@example.org' }),
  ath({ first: 'Dee', clubId: 'indy', email: 'dee@example.org' }),
  ath({ first: 'Eli', clubId: 'alpha', email: 'eli@example.org', removed: true }),
  ath({ first: 'Fay', clubId: 'alpha', email: 'fay@example.org', competes: false, apparatus: [] }),
  ath({ first: 'Gus', clubId: 'alpha', email: 'gus@example.org', sessionId: 's2-red' }),
  // Coaches and competes: Hal is Bravo's coach as well as one of its athletes.
  ath({ first: 'Hal', clubId: 'bravo', email: 'hal@example.org' }),
];
const CLUBS = [
  { id: 'alpha', name: 'Alpha Gym', contacts: [
    { name: 'Casey Coach', email: 'casey@example.org', role: 'Head Coach' },
    { name: 'Tess Treasurer', email: 'tess@example.org', role: 'Treasurer' },
  ] },
  { id: 'bravo', name: 'Bravo Gym', contacts: [
    { name: 'Hal Test', email: 'hal@example.org', role: 'Assistant Coach' },
    { name: '', email: 'casey@example.org', role: 'Head Coach' },
  ] },
  { id: 'charlie', name: 'Charlie Gym', contacts: [] },
];

describe('session detail recipients', () => {
  const r = buildSessionRecipients({ sessionId: 's1-orange', athletes: ATHLETES, clubs: CLUBS, coachRoles: ['Head Coach', 'Assistant Coach'] });

  it('emails each competing athlete with an address; removed, not competing and other sessions are out', () => {
    expect(r.athleteCount).toBe(5);
    // Club, then first name; addresses lower-cased.
    expect(r.athletes.map((a) => [a.name, a.email])).toEqual([
      ['Ada Test', 'ada@example.org'],
      ['Cy Test', 'cy@example.org'],
      ['Dee Test', 'dee@example.org'],
    ]);
  });

  it('one coach email per address, across clubs, listing their athletes; a coach who competes is left off their own list', () => {
    expect(r.coaches.map((c) => [c.email, c.name, c.clubName, c.athletes!.map((a) => a.name)])).toEqual([
      ['casey@example.org', 'Casey Coach', 'Alpha Gym, Bravo Gym', ['Ada Test', 'Bea Test', 'Cy Test', 'Hal Test']],
      ['hal@example.org', 'Hal Test', 'Bravo Gym', ['Cy Test']],
    ]);
    expect(r.coaches[0].firstName).toBe('Casey');
    // Hal gets the coach email only.
    expect(r.athletes.some((a) => a.email === 'hal@example.org')).toBe(false);
  });

  it('lists who has no address; independents have no coaches', () => {
    expect(r.missing).toEqual([{ role: 'athlete', name: 'Bea Test', clubName: 'Alpha Gym' }]);
    const none = buildSessionRecipients({ sessionId: 's1-orange', athletes: ATHLETES, clubs: CLUBS, coachRoles: [] });
    expect(none.coaches).toEqual([]);
    expect(none.missing.filter((m) => m.role === 'coach').map((m) => m.clubName)).toEqual(['Alpha Gym', 'Bravo Gym']);
    expect(none.athletes.map((a) => a.email)).toContain('hal@example.org');
  });

  it('roles: counted across clubs; "coach" roles are ticked until a choice is saved', () => {
    const roles = contactRoles(CLUBS);
    expect(roles).toEqual([{ role: 'Assistant Coach', count: 1 }, { role: 'Head Coach', count: 2 }, { role: 'Treasurer', count: 1 }]);
    expect(coachRolesOrDefault(null, roles)).toEqual(['Assistant Coach', 'Head Coach']);
    expect(coachRolesOrDefault(['Treasurer'], roles)).toEqual(['Treasurer']);
  });
});

describe('session detail email', () => {
  const session: Session = { id: 's2-orange', name: 'Session 2', number: 2, location: 'Orange', discipline: 'MAG', levelCodes: ['Dev'] };

  it('labels, links and context', () => {
    expect(sessionEmailLabel(session)).toBe('Session 2 - Orange (MAG)');
    expect(sessionEmailLabel({ ...session, name: 'Finals', number: undefined, discipline: 'TNT' })).toBe('Finals - Orange (T&T)');
    expect(publicSheetUrl('https://lineups.unitedclubgymnastics.org/#/admin', 'nat26', 's2-orange', 'rotation'))
      .toBe('https://lineups.unitedclubgymnastics.org/#/sheets/nat26/s2-orange?doc=rotation');
    const ctx = sessionEmailContext({
      meetName: 'Test Nationals', meetId: 'nat26', session, linkBase: 'https://lineups.unitedclubgymnastics.org/',
      schedule: { date: '2027-04-09', stretch: '7:30 AM', warmups: '08:00', competition: '8:45 AM' },
      recipient: { key: 'c:x', role: 'coach', name: '', firstName: '', email: 'x@example.org', clubName: 'Alpha Gym', athletes: [{ name: 'Ada Test', club: 'Alpha Gym' }] },
    });
    expect(ctx).toMatchObject({
      eventName: 'Test Nationals', sessionLabel: 'Session 2 - Orange (MAG)', dateText: 'Friday, April 9, 2027', firstName: 'Coach', recipient: 'coach',
      times: { stretch: '7:30 AM', warmup: '08:00', start: '8:45 AM', end: '' },
      scorecardsUrl: 'https://lineups.unitedclubgymnastics.org/#/sheets/nat26/s2-orange?doc=scorecards',
    });
    const mail = buildSessionReminderEmail(LINEUPS_SESSION_TEMPLATE, ctx);
    expect(mail.subject).toBe('Test Nationals: Session 2 - Orange (MAG) Information');
    // Typed times print as typed; HH:MM becomes 12-hour; no end time line.
    expect(mail.text).toContain('Open stretch: 7:30 AM\nWarm-ups: 8:00 AM\nCompetition: 8:45 AM');
    expect(mail.text).not.toContain('Est. end');
    expect(mail.text).toContain('Your athletes in this session:\n- Ada Test');
    expect(mail.text).toContain('latest published rotation sheet');
  });

  it('a stored template is used when valid, else the Lineups default', () => {
    expect(parseSessionTemplate(undefined)).toEqual(LINEUPS_SESSION_TEMPLATE);
    expect(parseSessionTemplate({ subject: 'x' })).toEqual(LINEUPS_SESSION_TEMPLATE);
    const mine = { ...DEFAULT_REMINDER_TEMPLATE, subject: 'Hi {first_name}' };
    expect(parseSessionTemplate(mine)).toEqual(mine);
  });
});
