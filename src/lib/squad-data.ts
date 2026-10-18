// Pure: assemble what the Squads screen needs from stored sessions, athletes and every club's saved groups,
// and convert the saved plan to and from its Firestore shape (no nested arrays).
import { compareByName, levelKeyFor, type LinkAthlete } from './club-links';
import type { LevelOrder } from './club-order-model';
import { levelStatus, sessionStatus } from './club-status';
import type { StoredAthlete } from './import/diff';
import { DEFAULT_GYM_ORDER, type Session } from './import/types';
import { readPattern, type ArtisticDiscipline, type RotationPattern } from './rotation';
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
  /** Any athlete (even one no longer competing or in another session): name, club and level for notices. */
  describe: (id: string) => { name: string; clubName: string; levelName: string } | undefined;
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

  const everyone = new Map(allAthletes.map((a) => [a.id, a]));
  const describe = (id: string) => { const a = everyone.get(id); return a ? { name: fullName(a), clubName: a.independent ? 'Independent' : a.clubName, levelName: a.levelName } : undefined; };

  return { describe, regs, savedGroups, cards, athleteCount: here.length, stillAz, needSplit, athletes, clubNames, levelNames, levelRank, clubLabel, independentLabel };
}

// --- stored plan -----------------------------------------------------------------------------------

export interface Schedule {
  stretch: string;
  warmups: string;
  competition: string;
}

export const EMPTY_SCHEDULE: Schedule = { stretch: '', warmups: '', competition: '' };

/**
 * `squads/{sessionId}` as stored (minus `updatedAt`, which the writer adds). Each placed card records the athletes
 * in it, so a club re-splitting its groups later cannot silently put other athletes in a placed slot.
 * `trayAthleteIds` = athletes the host knew about and left unplaced (so a newly added athlete can be told apart).
 * No nested arrays. The earlier `cardKeys` shape is not read (there was never live data in it): such a doc counts as nothing saved.
 */
export interface StoredSquadCard {
  key: string;
  athleteIds: string[];
}
export interface StoredSquadDoc {
  pattern: RotationPattern;
  /** Set only when read from a doc saved with the removed 2024 `byes` pattern (never written). */
  removedByes?: boolean;
  squads: { name: string; cards: StoredSquadCard[] }[];
  trayAthleteIds: string[];
  schedule: Schedule;
}

/** @param cards every card on the screen (placed ones carry their athletes; the rest are the tray). */
export function toStoredSquadDoc(pattern: RotationPattern, plan: SquadPlan, cards: SquadCard[], schedule: Schedule): StoredSquadDoc {
  const byKey = new Map(cards.map((c) => [c.key, c]));
  const placed = new Set(plan.flatMap((s) => s.cardKeys));
  return {
    pattern,
    squads: plan.map((s) => ({
      name: s.name,
      cards: s.cardKeys.filter((k) => byKey.has(k)).map((k) => ({ key: k, athleteIds: [...byKey.get(k)!.regIds] })),
    })),
    trayAthleteIds: cards.filter((c) => !placed.has(c.key)).flatMap((c) => c.regIds),
    schedule: { ...schedule },
  };
}

/** Read a stored document defensively; anything unusable (including the old `cardKeys` shape) is "nothing saved". */
export function parseSquadDoc(raw: unknown): StoredSquadDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const read = readPattern(d.pattern);
  if (!read || !Array.isArray(d.squads) || !Array.isArray(d.trayAthleteIds)) return null;
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const squads = d.squads.map((s, i) => {
    const o = (s ?? {}) as { name?: unknown; cards?: unknown };
    const cards = Array.isArray(o.cards)
      ? o.cards.map((c) => ({ key: typeof (c as { key?: unknown })?.key === 'string' ? (c as { key: string }).key : '', athleteIds: strs((c as { athleteIds?: unknown })?.athleteIds) }))
      : [];
    return { name: typeof o.name === 'string' ? o.name : `Squad ${i + 1}`, cards };
  });
  const sch = (d.schedule && typeof d.schedule === 'object' ? d.schedule : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return { pattern: read.pattern, ...(read.removedByes ? { removedByes: true } : {}), squads, trayAthleteIds: strs(d.trayAthleteIds), schedule: { stretch: str(sch.stretch), warmups: str(sch.warmups), competition: str(sch.competition) } };
}
