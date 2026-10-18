// Pure: build the public `clubLinks/{token}` documents the club page reads. No emails, birth dates or bibs.
import { DEFAULT_GYM_ORDER, type Athlete, type Discipline, type Session } from './import/types';

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
  gym: string;
  number: number;
  /** Empty for T&T: clubs never order T&T (shown as "Set by UCG"). */
  levels: LinkLevel[];
}

export interface ClubLinkDoc {
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

export const sessionLabel = (s: Pick<Session, 'number' | 'gym'>): string => `Session ${s.number} · ${s.gym}`;

/** Default A–Z order: first name, then last name. */
export function compareByName(a: { first: string; last: string }, b: { first: string; last: string }): number {
  return a.first.localeCompare(b.first, 'en', { sensitivity: 'base' }) || a.last.localeCompare(b.last, 'en', { sensitivity: 'base' });
}

export function sortSessions<T extends Pick<Session, 'number' | 'gym'>>(sessions: T[], gymOrder: string[] = DEFAULT_GYM_ORDER): T[] {
  const rank = (g: string) => {
    const i = gymOrder.findIndex((x) => x.toLowerCase() === g.toLowerCase());
    return i < 0 ? gymOrder.length : i;
  };
  return [...sessions].sort((a, b) => a.number - b.number || rank(a.gym) - rank(b.gym) || a.gym.localeCompare(b.gym));
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
      const base = { sessionId: s.id, label: sessionLabel(s), discipline: s.discipline, gym: s.gym, number: s.number };
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
        clubId: club.id,
        clubName: club.name,
        sessions: linkSessions,
        levelKeys: linkSessions.flatMap((s) => s.levels.map((l) => l.levelKey)),
      },
    });
  }
  return out;
}
