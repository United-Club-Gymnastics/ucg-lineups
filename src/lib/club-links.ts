// Pure: build the public `clubLinks/{token}` documents the club page reads. No emails, birth dates or bibs.
import { DEFAULT_GYM_ORDER, type Athlete, type Discipline, type Session } from './import/types';
import { sessionLocation, sessionName, sessionShortLabel, sortByName, type SessionRef } from './session-names';

export interface LinkAthlete {
  id: string;
  first: string;
  last: string;
  apparatus: string[];
}

export interface LinkLevel {
  levelCode: string;
  levelName: string;
  /** `<sessionId>__<levelCode>`: the document id under `clubOrders/{token}/levels/`. */
  levelKey: string;
  athletes: LinkAthlete[];
}

export interface LinkSession {
  sessionId: string;
  label: string;
  discipline: Discipline;
  name: string;
  location: string;
  /** Alias of `location` (links published before session names have `gym` and `number` only). */
  gym: string;
  number?: number;
  /** Empty for T&T: clubs never order T&T (shown as "Set by UCG"). */
  levels: LinkLevel[];
}

export interface ClubLinkDoc {
  /** The meet this link belongs to: the club page reads that meet's public settings (deadline, name). */
  meetId: string;
  clubId: string;
  clubName: string;
  sessions: LinkSession[];
  levelKeys: string[];
}

export interface ClubRef {
  id: string;
  name: string;
  token: string;
}

type AthleteIn = Pick<Athlete, 'id' | 'first' | 'last' | 'clubId' | 'independent' | 'levelCode' | 'levelName' | 'sessionId' | 'apparatus' | 'competes' | 'discipline'> & { removed?: boolean };

export function levelKeyFor(sessionId: string, levelCode: string): string {
  return `${sessionId}__${levelCode.replace(/\//g, '-')}`;
}

/** The club-facing label: `Session 1 · Orange`, `MAG Finals · Orange`, `MAG Session 1 · Dupont`. */
export const sessionLabel = (s: SessionRef): string => sessionShortLabel(s);

/** Default A–Z order: first name, then last name. */
export function compareByName(a: { first: string; last: string }, b: { first: string; last: string }): number {
  return a.first.localeCompare(b.first, 'en', { sensitivity: 'base' }) || a.last.localeCompare(b.last, 'en', { sensitivity: 'base' });
}

/** What a club sees: session name (natural order), then location (the meet's order). */
export function sortSessions<T extends SessionRef>(sessions: T[], gymOrder: string[] = DEFAULT_GYM_ORDER): T[] {
  return sortByName(sessions, gymOrder);
}

/**
 * Build each club's link document. Only athletes who compete and are not removed count; independents
 * and athletes without a known session are left out. T&T sessions are listed without levels.
 * Pass any club list (for example one club after "Regenerate link"); clubs without a token are skipped.
 */
export function buildClubLinks(
  athletes: AthleteIn[],
  sessions: Session[],
  clubs: ClubRef[],
  gymOrder: string[] = DEFAULT_GYM_ORDER,
  meetId = '',
): { token: string; doc: ClubLinkDoc }[] {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const live = athletes.filter((a) => a.competes && !a.removed && !a.independent && sessionById.has(a.sessionId));
  const byClub = new Map<string, AthleteIn[]>();
  for (const a of live) byClub.set(a.clubId, [...(byClub.get(a.clubId) ?? []), a]);

  const out: { token: string; doc: ClubLinkDoc }[] = [];
  for (const club of clubs) {
    if (!club.token) continue;
    const mine = byClub.get(club.id) ?? [];
    const sessionIds = [...new Set(mine.map((a) => a.sessionId))];
    const linkSessions: LinkSession[] = sortSessions(sessionIds.map((id) => sessionById.get(id)!), gymOrder).map((s) => {
      const base = {
        sessionId: s.id, label: sessionLabel(s), discipline: s.discipline,
        name: sessionName(s), location: sessionLocation(s), gym: sessionLocation(s),
        ...(s.number !== undefined ? { number: s.number } : {}),
      };
      if (s.discipline === 'TNT') return { ...base, levels: [] };
      const inSession = mine.filter((a) => a.sessionId === s.id);
      const codes = [...new Set(inSession.map((a) => a.levelCode))];
      const rank = (c: string) => { const i = s.levelCodes.indexOf(c); return i < 0 ? s.levelCodes.length : i; };
      codes.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      const levels: LinkLevel[] = codes.map((code) => {
        const here = inSession.filter((a) => a.levelCode === code);
        return {
          levelCode: code,
          levelName: here[0].levelName,
          levelKey: levelKeyFor(s.id, code),
          athletes: here
            .map((a) => ({ id: a.id, first: a.first, last: a.last, apparatus: [...a.apparatus] }))
            .sort(compareByName),
        };
      });
      return { ...base, levels };
    });
    out.push({
      token: club.token,
      doc: {
        meetId,
        clubId: club.id,
        clubName: club.name,
        sessions: linkSessions,
        levelKeys: linkSessions.flatMap((s) => s.levels.map((l) => l.levelKey)),
      },
    });
  }
  return out;
}
