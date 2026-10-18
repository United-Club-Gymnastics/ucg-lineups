// Pure: assemble what the Squads screen needs from stored sessions, athletes and every club's saved groups,
// and convert the saved plan to and from its Firestore shape (no nested arrays).
import { compareByName, levelKeyFor, type LinkAthlete } from './club-links';
import type { LevelOrder } from './club-order-model';
import { levelStatus, sessionStatus } from './club-status';
import type { StoredAthlete } from './import/diff';
import { DEFAULT_GYM_ORDER, type Session } from './import/types';
import { ROTATION_PATTERNS, type ArtisticDiscipline, type RotationPattern } from './rotation';
import { buildCards, type SquadCard, type SquadPlan } from './squad-balance';
import type { GroupReg, SavedGroupsRow } from './squad-builder';

export interface ArtisticSession extends Session {
  discipline: ArtisticDiscipline;
}

export const isArtisticSession = (s: Session): s is ArtisticSession => s.discipline === 'MAG' || s.discipline === 'WAG';

/** Gym order first (Green, Red, Yellow, Orange, Purple), then session number. Unknown gyms go last, A-Z. */
export function sortSessionsByGym<T extends Pick<Session, 'number' | 'gym'>>(sessions: T[], gymOrder: string[] = DEFAULT_GYM_ORDER): T[] {
  const rank = (g: string) => {
    const i = gymOrder.findIndex((x) => x.toLowerCase() === g.toLowerCase());
    return i < 0 ? gymOrder.length : i;
  };
  return [...sessions].sort((a, b) => rank(a.gym) - rank(b.gym) || a.gym.localeCompare(b.gym) || a.number - b.number);
}

export const sessionTitle = (s: Pick<Session, 'number' | 'gym'>): string => `Session ${s.number} – ${s.gym}`;

export interface SquadSessionData {
  regs: GroupReg[];
  savedGroups: SavedGroupsRow[];
  cards: SquadCard[];
  athleteCount: number;
  /** Clubs (not independents) whose status for this session is still A–Z / needs a split decision. */
  stillAz: number;
  needSplit: number;
  /** reg id -> athlete, for names. */
  athletes: Map<string, StoredAthlete>;
  clubNames: Map<string, string>;
  levelNames: Map<string, string>;
  levelRank: (levelId: string) => number;
  clubLabel: (clubId: string) => string;
  independentLabel: (regId: string) => string;
}

export const fullName = (a: Pick<StoredAthlete, 'first' | 'last'>): string => `${a.first} ${a.last}`.trim();

/**
 * @param ordersByClub clubId -> saved level orders of that club, keyed by level key (`<sessionId>__<levelCode>`).
 */
export function buildSessionData(
  session: ArtisticSession,
  allAthletes: StoredAthlete[],
  ordersByClub: Record<string, Record<string, LevelOrder>>,
): SquadSessionData {
  const here = allAthletes
    .filter((a) => a.sessionId === session.id && a.competes && !a.removed && a.apparatus.length > 0)
    .sort((a, b) => compareByName(a, b) || a.id.localeCompare(b.id));
  const athletes = new Map(here.map((a) => [a.id, a]));
  const regs: GroupReg[] = here.map((a) => ({ id: a.id, clubId: a.independent ? null : a.clubId, levelId: a.levelCode, apparatus: [...a.apparatus] }));

  const clubNames = new Map<string, string>();
  const levelNames = new Map<string, string>();
  for (const a of here) {
    levelNames.set(a.levelCode, a.levelName);
    if (!a.independent) clubNames.set(a.clubId, a.clubName);
  }

  const savedGroups: SavedGroupsRow[] = [];
  const pairs = new Set<string>();
  for (const r of regs) {
    if (!r.clubId) continue;
    const k = `${r.clubId}\u0000${r.levelId}`;
    if (pairs.has(k)) continue;
    pairs.add(k);
    const order = ordersByClub[r.clubId]?.[levelKeyFor(session.id, r.levelId)];
    if (order && order.groups.length > 0) savedGroups.push({ clubId: r.clubId, levelId: r.levelId, groups: order.groups });
  }

  const rankOf = new Map(session.levelCodes.map((c, i) => [c, i]));
  const levelRank = (l: string) => rankOf.get(l) ?? session.levelCodes.length;
  const clubLabel = (id: string) => clubNames.get(id) ?? id;
  const independentLabel = (id: string) => { const a = athletes.get(id); return a ? fullName(a) : id; };

  const cards = buildCards({ discipline: session.discipline, sessionRegs: regs, savedGroups, clubLabel, independentLabel, levelRank });

  // Club status for this session, as the club sees it.
  let stillAz = 0;
  let needSplit = 0;
  for (const clubId of clubNames.keys()) {
    const mine = here.filter((a) => !a.independent && a.clubId === clubId);
    const codes = [...new Set(mine.map((a) => a.levelCode))];
    const statuses = codes.map((code) => {
      const lvl: LinkAthlete[] = mine.filter((a) => a.levelCode === code).map((a) => ({ id: a.id, first: a.first, last: a.last, apparatus: [...a.apparatus] }));
      return levelStatus(session.discipline, lvl, ordersByClub[clubId]?.[levelKeyFor(session.id, code)]);
    });
    const st = sessionStatus(session.discipline, statuses);
    if (st === 'default') stillAz++;
    if (st === 'split') needSplit++;
  }

  return { regs, savedGroups, cards, athleteCount: here.length, stillAz, needSplit, athletes, clubNames, levelNames, levelRank, clubLabel, independentLabel };
}

// --- stored plan -----------------------------------------------------------------------------------

export interface Schedule {
  stretch: string;
  warmups: string;
  competition: string;
}

export const EMPTY_SCHEDULE: Schedule = { stretch: '', warmups: '', competition: '' };

/** `squads/{sessionId}` as stored (minus `updatedAt`, which the writer adds). */
export interface StoredSquadDoc {
  pattern: RotationPattern;
  squads: { name: string; cardKeys: string[] }[];
  schedule: Schedule;
}

export const toStoredSquadDoc = (pattern: RotationPattern, plan: SquadPlan, schedule: Schedule): StoredSquadDoc => ({
  pattern,
  squads: plan.map((s) => ({ name: s.name, cardKeys: [...s.cardKeys] })),
  schedule: { ...schedule },
});

/** Read a stored document defensively; anything unusable is "nothing saved". */
export function parseSquadDoc(raw: unknown): { pattern: RotationPattern; squads: { cardKeys: string[] }[]; schedule: Schedule } | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const pattern = ROTATION_PATTERNS.find((p) => p === d.pattern);
  if (!pattern) return null;
  const squads = Array.isArray(d.squads)
    ? d.squads.map((s) => {
      const keys = (s as { cardKeys?: unknown } | null)?.cardKeys;
      return { cardKeys: Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [] };
    })
    : [];
  const sch = (d.schedule && typeof d.schedule === 'object' ? d.schedule : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return { pattern, squads, schedule: { stretch: str(sch.stretch), warmups: str(sch.warmups), competition: str(sch.competition) } };
}
