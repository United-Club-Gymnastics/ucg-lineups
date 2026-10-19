import { describe, expect, it } from 'vitest';
import { buildClubRows, matchesClubFilter } from '../../src/lib/club-overview';
import { buildReminders, joinList, parseEmails } from '../../src/lib/reminders';
import { ATHLETES, CLUBS, SAVED, SESSIONS } from './clubs-fixtures';

const rows = buildClubRows(ATHLETES, SESSIONS, CLUBS, SAVED);
const by = (id: string) => rows.find((r) => r.id === id)!;

describe('club overview rows', () => {
  it('lists clubs A-Z with sessions in gym/number order, counts per level and the status per session', () => {
    expect(rows.map((r) => r.name)).toEqual(['Alpha Gymnastics', 'Bravo Academy', 'Charlie Club', 'Delta Gym', 'Echo Elite']);
    const alpha = by('alpha-gymnastics');
    expect(alpha.sessions.map((s) => [s.label, s.status])).toEqual([['Session 1 · Orange', 'default'], ['Session 2 · Red', 'custom']]);
    expect(alpha.sessions[0].levels).toEqual([expect.objectContaining({ code: 'XS', name: 'Silver XS', count: 3, status: 'default' })]);
    expect(by('bravo-academy').sessions[0]).toEqual(expect.objectContaining({ status: 'split', athleteCount: 14 }));
    expect(by('charlie-club').sessions).toEqual([expect.objectContaining({ status: 'tnt', levels: [], athleteCount: 2 })]);
    expect(by('echo-elite').sessions[0].status).toBe('none');
  });

  it('takes the last change from the latest saved level, null when the club changed nothing', () => {
    expect(by('alpha-gymnastics').lastChange).toBe(Date.UTC(2026, 9, 18, 22, 40));
    expect(by('delta-gym').lastChange).toBeNull();
  });

  it('ignores removed and non-competing athletes and independents', () => {
    const more = [...ATHLETES, { ...ATHLETES[0], id: 'gone', removed: true }, { ...ATHLETES[0], id: 'sc', competes: false }, { ...ATHLETES[0], id: 'ind', independent: true, clubId: 'delta-gym' }];
    expect(buildClubRows(more, SESSIONS, CLUBS, SAVED).find((r) => r.id === 'alpha-gymnastics')!.sessions[0].levels[0].count).toBe(3);
  });

  it('filters by status and by name or email', () => {
    const ids = (status: string, q = '') => rows.filter((r) => matchesClubFilter(r, status, q)).map((r) => r.id);
    expect(ids('split')).toEqual(['bravo-academy']);
    expect(ids('default')).toEqual(['alpha-gymnastics', 'bravo-academy', 'delta-gym']);
    expect(ids('custom')).toEqual(['alpha-gymnastics']);
    expect(ids('tnt')).toEqual(['charlie-club']);
    expect(ids('noemail')).toEqual(['delta-gym']);
    expect(ids('all', 'ECHO')).toEqual(['echo-elite']);
    expect(ids('all', 'second@example')).toEqual(['bravo-academy']);
    expect(ids('default', 'gym')).toEqual(['alpha-gymnastics', 'delta-gym']);
  });
});

describe('reminder lists', () => {
  const r = buildReminders(rows);

  it('Still A–Z: clubs with a default session and no split pending, listing only those sessions', () => {
    expect(r.az.map((e) => e.clubName)).toEqual(['Alpha Gymnastics']);
    expect(r.az[0].sessions.map((s) => s.label)).toEqual(['Session 1 · Orange']); // its Session 2 is already set
    expect(r.az[0].levels).toEqual([]);
  });

  it('Needs a split: only the split email, naming the levels that are too big (Bravo is NOT also on the A–Z list)', () => {
    expect(r.split.map((e) => e.clubName)).toEqual(['Bravo Academy']);
    expect(r.split[0].levels).toEqual([{ sessionLabel: 'Session 1 · Orange', levelName: 'Platinum XP', count: 14 }]);
    expect(r.split[0].sessions.map((s) => s.label)).toEqual(['Session 1 · Orange']);
    expect(r.az.some((e) => e.clubId === 'bravo-academy')).toBe(false);
  });

  it('lists clubs with no email separately and never in the sendable list', () => {
    expect(r.noEmail.az.map((e) => e.clubName)).toEqual(['Delta Gym']);
    expect(r.noEmail.split).toEqual([]);
    expect(r.az.some((e) => e.clubId === 'delta-gym')).toBe(false);
  });

  it('leaves out T&T, nothing-to-order and order-set clubs', () => {
    const all = [...r.az, ...r.split, ...r.noEmail.az, ...r.noEmail.split].map((e) => e.clubId);
    expect(all).not.toContain('charlie-club');
    expect(all).not.toContain('echo-elite');
  });

  it('a split with no email goes to the split "no email" list', () => {
    const noMail = buildClubRows(ATHLETES, SESSIONS, CLUBS.map((c) => (c.id === 'bravo-academy' ? { ...c, emails: [] } : c)), SAVED);
    const rr = buildReminders(noMail);
    expect(rr.split).toEqual([]);
    expect(rr.noEmail.split.map((e) => e.clubId)).toEqual(['bravo-academy']);
  });

  it('a kept split (splitDecided) no longer counts as pending', () => {
    const bravoIds = ATHLETES.filter((a) => a.clubId === 'bravo-academy' && a.sessionId === 's1-orange').map((a) => a.id);
    const kept = buildClubRows(ATHLETES, SESSIONS, CLUBS, { ...SAVED, 'bravo-academy': { 's1-orange__XP': { order: { groups: [bravoIds.slice(0, 7), bravoIds.slice(7)], sections: {}, splitDecided: true }, updatedAt: 1 } } });
    expect(buildReminders(kept).split).toEqual([]);
  });
});

describe('helpers', () => {
  it('joinList', () => {
    expect([joinList([]), joinList(['a']), joinList(['a', 'b']), joinList(['a', 'b', 'c'])]).toEqual(['', 'a', 'a and b', 'a, b and c']);
  });
  it('parseEmails lower-cases, dedupes and reports junk', () => {
    expect(parseEmails('A@x.org; b@y.org, a@X.org  c')).toEqual({ emails: ['a@x.org', 'b@y.org'], invalid: ['c'] });
    expect(parseEmails('')).toEqual({ emails: [], invalid: [] });
  });
});
