// Pure: one row per club for the admin "Clubs & email" table (spec §7): per-session levels and counts, the status the club
// sees (club-status.ts), the last time the club changed anything, contacts and the private-link token.
import { levelKeyFor, sessionLabel, sortSessions, type LinkAthlete } from './club-links';
import type { ArtisticDiscipline, LevelOrder } from './club-order-model';
import { levelStatus, sessionStatus, type LevelStatus, type SessionStatus } from './club-status';
import { DEFAULT_GYM_ORDER, type Athlete, type Discipline, type Session } from './import/types';

export interface SavedLevel {
  order?: LevelOrder;
  /** Milliseconds since the epoch of the club's last save of this level, when known. */
  updatedAt: number | null;
}

export interface OverviewLevel {
  code: string;
  name: string;
  levelKey: string;
  count: number;
  status: LevelStatus;
}

export interface OverviewSession {
  sessionId: string;
  label: string;
  discipline: Discipline;
  athleteCount: number;
  /** Empty for T&T (clubs never order T&T). */
  levels: OverviewLevel[];
  status: SessionStatus;
}

export interface ClubRow {
  id: string;
  name: string;
  emails: string[];
  token: string;
  sessions: OverviewSession[];
  /** Latest save of any of the club's orders, ms since the epoch; null when the club has changed nothing. */
  lastChange: number | null;
}

type AthleteIn = Pick<Athlete, 'id' | 'first' | 'last' | 'clubId' | 'independent' | 'levelCode' | 'levelName' | 'sessionId' | 'apparatus' | 'competes'> & { removed?: boolean };

export interface ClubIn {
  id: string;
  name: string;
  emails: string[];
  token: string;
}

/**
 * @param saved clubId -> level key -> that level's saved order (and when it was saved)
 * Only athletes who compete and are not removed count; independents have no row (they have no club record).
 */
export function buildClubRows(
  athletes: AthleteIn[],
  sessions: Session[],
  clubs: ClubIn[],
  saved: Record<string, Record<string, SavedLevel>>,
  gymOrder: string[] = DEFAULT_GYM_ORDER,
): ClubRow[] {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const live = athletes.filter((a) => a.competes && !a.removed && !a.independent && sessionById.has(a.sessionId));
  const byClub = new Map<string, AthleteIn[]>();
  for (const a of live) byClub.set(a.clubId, [...(byClub.get(a.clubId) ?? []), a]);

  const rows = clubs.map((club): ClubRow => {
    const mine = byClub.get(club.id) ?? [];
    const mySaved = saved[club.id] ?? {};
    const sessionIds = [...new Set(mine.map((a) => a.sessionId))];
    const rowSessions = sortSessions(sessionIds.map((id) => sessionById.get(id)!), gymOrder).map((s): OverviewSession => {
      const inSession = mine.filter((a) => a.sessionId === s.id);
      const base = { sessionId: s.id, label: sessionLabel(s), discipline: s.discipline, athleteCount: inSession.length };
      if (s.discipline === 'TNT') return { ...base, levels: [], status: 'tnt' };
      const rank = (c: string) => { const i = s.levelCodes.indexOf(c); return i < 0 ? s.levelCodes.length : i; };
      const codes = [...new Set(inSession.map((a) => a.levelCode))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      const levels = codes.map((code): OverviewLevel => {
        const here = inSession.filter((a) => a.levelCode === code);
        const roster: LinkAthlete[] = here.map((a) => ({ id: a.id, first: a.first, last: a.last, apparatus: [...a.apparatus] }));
        const levelKey = levelKeyFor(s.id, code);
        return { code, name: here[0].levelName, levelKey, count: here.length, status: levelStatus(s.discipline as ArtisticDiscipline, roster, mySaved[levelKey]?.order) };
      });
      return { ...base, levels, status: sessionStatus(s.discipline, levels.map((l) => l.status)) };
    });
    const times = Object.values(mySaved).map((v) => v.updatedAt).filter((t): t is number => typeof t === 'number');
    return { id: club.id, name: club.name, emails: club.emails, token: club.token, sessions: rowSessions, lastChange: times.length ? Math.max(...times) : null };
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** The table's filters: `status` is 'all', a session status, or 'noemail'; `search` matches the club name or an email. */
export function matchesClubFilter(row: ClubRow, status: string, search: string): boolean {
  if (status === 'noemail' ? row.emails.length > 0 : status !== 'all' && !row.sessions.some((s) => s.status === status)) return false;
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return row.name.toLowerCase().includes(q) || row.emails.some((e) => e.includes(q));
}
