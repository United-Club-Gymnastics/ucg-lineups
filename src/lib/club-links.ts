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
  /** `<sessionId>__<levelCode>`: the document id under `clubOrders/{token}/meets/{meetId}/levels/`. */
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

/** One meet's part of a club's link: what the club page shows and the rules check for that meet. */
export interface MeetLinkEntry {
  meetName: string;
  /** Milliseconds since the epoch when the meet was created (0 when unknown): the newest meet is the page's default. */
  createdAt: number;
  /** Set on an archived meet; archiving normally removes the entry, so clubs never see it. */
  archived?: boolean;
  sessions: LinkSession[];
  /** The level keys a club may write in this meet (`clubOrders/{token}/meets/{meetId}/levels/{levelKey}`). */
  levelKeys: string[];
}

/**
 * `clubLinks/{token}`: ONE private link per club across all meets (spec §3). `meets` is keyed by meet id; publishing a meet
 * merges just that meet's entry, so the other meets' entries are never touched.
 */
export interface ClubLinkDoc {
  clubId: string;
  clubName: string;
  meets: Record<string, MeetLinkEntry>;
}

export interface MeetRef {
  id: string;
  name: string;
  createdAt: number;
}

/** The club page's meet list: not archived, newest first (then name, then id, so the order is stable). */
export function linkMeets(link: ClubLinkDoc): { meetId: string; entry: MeetLinkEntry }[] {
  return Object.entries(link.meets ?? {})
    .filter(([, e]) => e && !e.archived)
    .map(([meetId, entry]) => ({ meetId, entry }))
    .sort((a, b) => (b.entry.createdAt ?? 0) - (a.entry.createdAt ?? 0) || (a.entry.meetName ?? '').localeCompare(b.entry.meetName ?? '') || a.meetId.localeCompare(b.meetId));
}

/** A link in the old shape (one meet: `meetId` + `sessions`, no `meets` map). Such links stop working after "Upgrade club links". */
export interface OldClubLinkDoc {
  meetId: string;
  clubId: string;
  clubName: string;
  sessions: LinkSession[];
  levelKeys: string[];
}

export function isNewLink(raw: unknown): raw is ClubLinkDoc {
  const d = raw as { meets?: unknown } | null;
  return !!d && typeof d === 'object' && !!d.meets && typeof d.meets === 'object' && !Array.isArray(d.meets);
}

export function isOldLink(raw: unknown): raw is OldClubLinkDoc {
  const d = raw as { meetId?: unknown; meets?: unknown } | null;
  return !!d && typeof d === 'object' && typeof d.meetId === 'string' && d.meetId !== '' && !isNewLink(raw);
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
 * Pass any club list; clubs without a token are skipped. The result holds ONLY this meet's entry: write it with a merge so
 * the club's other meets are left alone.
 */
export function buildClubLinks(
  athletes: AthleteIn[],
  sessions: Session[],
  clubs: ClubRef[],
  gymOrder: string[] = DEFAULT_GYM_ORDER,
  meet: MeetRef = { id: '', name: '', createdAt: 0 },
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
        clubId: club.id,
        clubName: club.name,
        meets: {
          [meet.id]: {
            meetName: meet.name,
            createdAt: meet.createdAt,
            sessions: linkSessions,
            levelKeys: linkSessions.flatMap((s) => s.levels.map((l) => l.levelKey)),
          },
        },
      },
    });
  }
  return out;
}
