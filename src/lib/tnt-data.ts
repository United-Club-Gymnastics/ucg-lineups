// Pure: assemble what the T&T screen needs from stored sessions and athletes, and convert the saved T&T plan to and
// from its Firestore shape (no nested arrays).
import type { StoredAthlete } from './import/diff';
import type { Session } from './import/types';
import type { Flight, RosterPerson } from './synchro-flights';
import { TNT_EVENTS, TNT_SQUAD_COUNT, fullName, inSquads, isSynchroOnly, squadLetter, type TntAthlete, type TntCode } from './tnt-squads';

export const isTntSession = (s: Session): boolean => s.discipline === 'TNT';

const CODES: TntCode[] = ['TR', 'DM', 'TU', 'SY'];

/** The athlete's level on each event they are entered in. Older records without `tnt` fall back to the athlete's level. */
export function toTntAthlete(a: StoredAthlete): TntAthlete {
  const levels: TntAthlete['levels'] = {};
  for (const c of CODES) {
    const l = a.tnt?.[c] ?? (a.tnt ? undefined : a.apparatus.includes(c) ? a.levelCode : undefined);
    if (l) levels[c] = l;
  }
  return { id: a.id, first: a.first, last: a.last, clubId: a.clubId, clubName: a.independent ? (a.clubName || 'Independent') : a.clubName, independent: a.independent, levels };
}

export interface TntSessionData {
  /** Everyone competing in this session. */
  all: TntAthlete[];
  /** Entered on TR / DM / TU: placed in squads. */
  squadAthletes: TntAthlete[];
  /** Entered only in synchro: not in a squad. */
  synchroOnly: TntAthlete[];
  byId: Map<string, TntAthlete>;
  /** "Name · Club" for any athlete, including ones who have left. */
  describe: (id: string) => string;
}

const cmpText = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

const competing = (a: StoredAthlete) => a.discipline === 'TNT' && a.competes && !a.removed && a.apparatus.length > 0;

/**
 * Every T&T athlete in the import, in every session, for matching synchro pairs. `competes` is false for athletes scratched
 * from every event (they are never matched for placement; it only changes the wording). Athletes removed from the import are left out.
 */
export function buildTntRoster(allAthletes: StoredAthlete[]): RosterPerson[] {
  return allAthletes
    .filter((a) => a.discipline === 'TNT' && !a.removed)
    .map((a) => ({
      id: a.id, first: a.first, last: a.last, clubName: a.independent ? (a.clubName || 'Independent') : a.clubName,
      sessionId: a.sessionId ?? '', inSynchro: a.apparatus.includes('SY'), competes: competing(a),
    }));
}

export function buildTntSessionData(session: Session, allAthletes: StoredAthlete[]): TntSessionData {
  const all = allAthletes
    .filter((a) => a.sessionId === session.id && competing(a))
    .map(toTntAthlete)
    .sort((a, b) => cmpText(a.first, b.first) || cmpText(a.last, b.last) || a.id.localeCompare(b.id));
  const everyone = new Map(allAthletes.map((a) => [a.id, a]));
  const describe = (id: string) => {
    const a = everyone.get(id);
    return a ? `${fullName(a)} · ${a.independent ? 'Independent' : a.clubName}` : id;
  };
  return {
    all,
    squadAthletes: all.filter(inSquads),
    synchroOnly: all.filter(isSynchroOnly),
    byId: new Map(all.map((a) => [a.id, a])),
    describe,
  };
}

// --- stored plan -----------------------------------------------------------------------------------------

/**
 * `squads/{sessionId}` for a T&T session (minus `updatedAt`, which the writer adds). `trayAthleteIds` = athletes the host
 * knew about and left unplaced (so a newly added athlete can be told apart). `orders` holds only orders that differ from
 * the default, keyed `<squad letter>_<event>` (e.g. `A_TR`). `flights` is empty until the host edits or refreshes them.
 */
export interface StoredTntDoc {
  kind: 'tnt';
  squads: { name: string; athleteIds: string[] }[];
  trayAthleteIds: string[];
  orders: Record<string, string[]>;
  flights: Flight[];
  pairsReadAt: Date | null;
}

export function toStoredTntDoc(input: { squads: string[][]; tray: string[]; orders: Record<string, string[]>; flights: Flight[]; pairsReadAt: Date | null }): StoredTntDoc {
  return {
    kind: 'tnt',
    squads: input.squads.map((ids, i) => ({ name: squadLetter(i), athleteIds: [...ids] })),
    trayAthleteIds: [...input.tray],
    orders: Object.fromEntries(Object.entries(input.orders).map(([k, v]) => [k, [...v]])),
    flights: input.flights.map((f) => ({ name: f.name, pairIds: [...f.pairIds] })),
    pairsReadAt: input.pairsReadAt,
  };
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Read a stored document defensively; anything that is not a T&T plan is "nothing saved". */
export function parseTntDoc(raw: unknown): StoredTntDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (d.kind !== 'tnt' || !Array.isArray(d.squads)) return null;
  const squads = Array.from({ length: TNT_SQUAD_COUNT }, (_, i) => {
    const s = (d.squads as unknown[])[i] as { athleteIds?: unknown } | undefined;
    return { name: squadLetter(i), athleteIds: strs(s?.athleteIds) };
  });
  const orders: Record<string, string[]> = {};
  if (d.orders && typeof d.orders === 'object') {
    for (const [k, v] of Object.entries(d.orders as Record<string, unknown>)) {
      const m = /^([A-C])_(TR|DM|TU)$/.exec(k);
      if (m && (TNT_EVENTS as readonly string[]).includes(m[2])) orders[k] = strs(v);
    }
  }
  const flights = Array.isArray(d.flights)
    ? d.flights.map((f, i) => {
      const o = (f ?? {}) as { name?: unknown; pairIds?: unknown };
      return { name: typeof o.name === 'string' && o.name ? o.name : String.fromCharCode(65 + i), pairIds: strs(o.pairIds) };
    })
    : [];
  const t = d.pairsReadAt as { toDate?: () => Date } | Date | null | undefined;
  const pairsReadAt = t instanceof Date ? t : t && typeof t.toDate === 'function' ? t.toDate() : null;
  return { kind: 'tnt', squads, trayAthleteIds: strs(d.trayAthleteIds), orders, flights, pairsReadAt };
}
