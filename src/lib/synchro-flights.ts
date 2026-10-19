// Pure: synchro flights. Pairs come from the Synchro tool (src/lib/synchro-source.ts, read-only); they are matched to the
// import's T&T athletes by club + name (spaces and punctuation ignored, as the import does), given a session (the one both
// athletes are in, or the host's choice), split into flights per session, and merged when the pairs are read again. Ported from the prototype (pairSort, ttDefaultFlights).
import { slug, tntLevelCode } from './import/normalize';
import type { SynchroPair } from './synchro-source';
import { levelRank } from './tnt-squads';

export interface Person {
  id: string;
  first: string;
  last: string;
  clubName: string;
}

export interface FlightPair {
  /** The Synchro tool's document id (stable across reads). */
  id: string;
  /** NF / IF / HF as read from the Synchro tool. */
  level: string;
  /** Names and clubs exactly as the Synchro tool has them. */
  name1: string;
  name2: string;
  club1: string;
  club2: string;
  /** Matched T&T athlete ids (null = not matched, or ambiguous). */
  athlete1: string | null;
  athlete2: string | null;
  /** An athlete could not be matched, or is not entered in synchro: shown as "Check pair". */
  check: boolean;
  /** Why it needs a check, e.g. "Ada Test is not in this import". */
  problems: string[];
}

export interface Flight {
  /** "A", "B", … */
  name: string;
  pairIds: string[];
}

const compact = (s: string): string => slug(s).replace(/-/g, '');
const personKey = (club: string, name: string): string => `${compact(club)}|${compact(name)}`;

interface RosterIndex {
  byClubName: Map<string, string[]>;
  byName: Map<string, string[]>;
}

function index(people: Person[]): RosterIndex {
  const byClubName = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  for (const p of people) {
    const name = compact(`${p.first}${p.last}`);
    const k = `${compact(p.clubName)}|${name}`;
    byClubName.set(k, [...(byClubName.get(k) ?? []), p.id]);
    byName.set(name, [...(byName.get(name) ?? []), p.id]);
  }
  return { byClubName, byName };
}

type Found = { id: string | null; match: 'one' | 'many' | 'none' };
const one = (id: string): Found => ({ id, match: 'one' });
const none: Found = { id: null, match: 'none' };

/**
 * Club + name first. If that fails (the club was renamed since the Synchro tool read the roster), the name alone, when exactly
 * one T&T athlete has it. If several share the name, the partner's club, then the partner's session, picks one; else it stays
 * unmatched ('many'). `partner` = the pair partner's club-and-name match, when there is one.
 */
function find(
  idx: RosterIndex, byId: Map<string, RosterPerson>, club: string, name: string, partnerClub: string, partner: Found,
): Found {
  const exact = idx.byClubName.get(personKey(club, name)) ?? [];
  if (exact.length === 1) return one(exact[0]);
  if (exact.length > 1) return { id: null, match: 'many' };
  const named = idx.byName.get(compact(name)) ?? [];
  if (named.length === 0) return none;
  if (named.length === 1) return one(named[0]);
  const sameClub = partner.id ? named.filter((id) => compact(byId.get(partner.id!)!.clubName) === compact(byId.get(id)!.clubName)) : [];
  if (sameClub.length === 1) return one(sameClub[0]);
  const byClub = partnerClub ? named.filter((id) => compact(byId.get(id)!.clubName) === compact(partnerClub)) : [];
  if (byClub.length === 1) return one(byClub[0]);
  const partnerSession = partner.id ? byId.get(partner.id)!.sessionId : null;
  const bySession = partnerSession ? named.filter((id) => byId.get(id)!.sessionId === partnerSession) : [];
  if (bySession.length === 1) return one(bySession[0]);
  return { id: null, match: 'many' };
}

/** Why a pair has no session yet. */
export type UnassignedReason = 'different-sessions' | 'unmatched';

/** A pair with the T&T session it competes in (null = "Needs a session"). */
export interface PlacedPair extends FlightPair {
  /** Where the pair competes: the host's choice, else the session both athletes are in; null = needs a session. */
  sessionId: string | null;
  /** The session both athletes are assigned to (null when they differ or cannot both be matched). */
  defaultSessionId: string | null;
  /** The host chose the session (it is stored). */
  manual: boolean;
  /** The T&T session of each matched athlete (null = not matched). */
  athleteSessions: [string | null, string | null];
  /** Set only while `sessionId` is null. */
  unassignedReason: UnassignedReason | null;
  /** The host scratched this pair: it is on no list, sheet or warning, only in the "Scratched pairs" list. Its `sessionId` is what Restore would use. */
  scratched: boolean;
}

/** A T&T athlete in the import (competing or scratched), with their session and whether they are entered in synchro. */
export interface RosterPerson extends Person {
  sessionId: string;
  inSynchro: boolean;
  /** false = scratched from every event: known to the import, but never matched for placement. */
  competes: boolean;
}

/** `synchroSessions/main`: the host's session choice per pair id. */
export type SynchroAssignments = Record<string, string>;

/** `synchroSessions/main`: pairs the host scratched, `{ <pairId>: true }`. */
export type SynchroScratched = Record<string, true>;

/** Read the scratched map defensively (anything but `true` is ignored). */
export function parseScratched(raw: unknown): SynchroScratched {
  const a = raw && typeof raw === 'object' ? (raw as { scratched?: unknown }).scratched : null;
  const out: SynchroScratched = {};
  if (a && typeof a === 'object') for (const [k, v] of Object.entries(a as Record<string, unknown>)) if (v === true) out[k] = true;
  return out;
}

/** Read `synchroSessions/main` defensively (anything unusable = no choices). */
export function parseAssignments(raw: unknown): SynchroAssignments {
  const a = raw && typeof raw === 'object' ? (raw as { assignments?: unknown }).assignments : null;
  const out: SynchroAssignments = {};
  if (a && typeof a === 'object') for (const [k, v] of Object.entries(a as Record<string, unknown>)) if (typeof v === 'string' && v) out[k] = v;
  return out;
}

/**
 * Match every pair to the T&T roster (club + name) and decide its session. No guessing: the default session is the one both
 * athletes share; if they differ, or either cannot be matched, the pair needs a session until the host picks one.
 * A pair is flagged ("Check pair") when an athlete cannot be matched, or is on the roster but not entered in synchro.
 * @param roster every T&T athlete in the import (all sessions); only those with `competes` can be matched, the rest only
 *   change the wording ("scratched from every event" vs "isn't in this import")
 * @param assignments the host's stored choices; one naming a session not in `sessionIds` is ignored
 * @param scratched pairs the host scratched: still returned (flagged `scratched`, placed by the usual rules so Restore knows
 *   where they go), but left out of `pairsInSession` and `pairsNeedingSession`
 * Names: a matched athlete shows the import's first + last name. An unmatched one shows the import's spelling too when exactly
 * one roster athlete (any session, competing or not) has the same compact name; otherwise the Synchro tool's text. The Synchro
 * export drops some spaces ("MurrayMetzger"); the athletes export, which the import reads, has them right.
 */
export function placePairs(
  pairs: SynchroPair[], roster: RosterPerson[], assignments: SynchroAssignments, sessionIds: string[], scratched: SynchroScratched = {},
): PlacedPair[] {
  const competing = roster.filter((r) => r.competes);
  const idx = index(competing);
  const out = index(roster.filter((r) => !r.competes));
  const everyone = index(roster);
  const rosterById = new Map(roster.map((r) => [r.id, r]));
  const isScratched = (club: string, name: string) => out.byClubName.has(personKey(club, name)) || out.byName.has(compact(name));
  const spelled = (r: RosterPerson) => `${r.first} ${r.last}`.trim();
  /** An unmatched athlete's name in the import's spelling when that is unambiguous, else the Synchro tool's text. */
  const unmatchedName = (club: string, name: string): string => {
    const here = out.byClubName.get(personKey(club, name)) ?? [];
    if (here.length === 1) return spelled(rosterById.get(here[0])!);
    const all = everyone.byName.get(compact(name)) ?? [];
    return all.length === 1 ? spelled(rosterById.get(all[0])!) : name;
  };
  const byId = new Map(competing.map((r) => [r.id, r]));
  const valid = new Set(sessionIds);
  return pairs.map((p) => {
    // Each athlete is matched on their own first (the partner only breaks a tie between same-named athletes).
    const a0 = find(idx, byId, p.club1, p.name1, '', none);
    const b0 = find(idx, byId, p.club2, p.name2, '', none);
    const a = a0.match === 'many' ? find(idx, byId, p.club1, p.name1, p.club2, b0) : a0;
    const b = b0.match === 'many' ? find(idx, byId, p.club2, p.name2, p.club1, a) : b0;
    const ra = a.id ? byId.get(a.id)! : null;
    const rb = b.id ? byId.get(b.id)! : null;
    const problems: string[] = [];
    const shown = (r: RosterPerson | null, name: string, club: string, fallback: string) => (r ? spelled(r) : name ? unmatchedName(club, name) : fallback);
    const name1 = shown(ra, p.name1, p.club1, 'First athlete');
    const name2 = shown(rb, p.name2, p.club2, 'Second athlete');
    const why = (who: typeof a, name: string, club: string, shownName: string) => {
      if (who.match === 'many') problems.push(`${shownName} matches more than one athlete`);
      else if (who.match === 'none') problems.push(isScratched(club, name) ? `${shownName} is scratched from every event` : `${shownName} isn't in this import`);
      else if (!byId.get(who.id!)!.inSynchro) problems.push(`${shownName} is on the roster but not entered in synchro`);
    };
    why(a, p.name1, p.club1, name1);
    why(b, p.name2, p.club2, name2);
    const sa = a.id ? byId.get(a.id)!.sessionId : null;
    const sb = b.id ? byId.get(b.id)!.sessionId : null;
    const defaultSessionId = sa && sa === sb ? sa : null;
    const chosen = assignments[p.id];
    const manual = !!chosen && valid.has(chosen);
    const sessionId = manual ? chosen : defaultSessionId;
    return {
      id: p.id, level: tntLevelCode(p.level),
      // Matched athletes show the import's current name and club; the Synchro tool's are kept only for unmatched ones.
      name1, name2,
      club1: ra ? ra.clubName : p.club1, club2: rb ? rb.clubName : p.club2,
      athlete1: a.id, athlete2: b.id, check: problems.length > 0, problems,
      sessionId, defaultSessionId, manual, athleteSessions: [sa, sb],
      unassignedReason: sessionId ? null : sa && sb ? 'different-sessions' : 'unmatched',
      scratched: scratched[p.id] === true,
    };
  });
}

/** Pairs competing in this session (scratched pairs are never included). */
export const pairsInSession = (placed: PlacedPair[], sessionId: string): PlacedPair[] => placed.filter((p) => !p.scratched && p.sessionId === sessionId);
/** Pairs waiting for the host to pick a session (scratched pairs are never included). */
export const pairsNeedingSession = (placed: PlacedPair[]): PlacedPair[] => placed.filter((p) => !p.scratched && p.sessionId === null);
/** Pairs the host scratched. */
export const scratchedPairs = (placed: PlacedPair[]): PlacedPair[] => placed.filter((p) => p.scratched);

/** Record the host's choice for a pair (kept by Refresh pairs, which never touches the assignments). */
export const assignPair = (assignments: SynchroAssignments, pairId: string, sessionId: string): SynchroAssignments => ({ ...assignments, [pairId]: sessionId });

export const pairNames = (p: Pick<FlightPair, 'name1' | 'name2'>): string => `${p.name1} & ${p.name2}`;
export const pairClubs = (p: Pick<FlightPair, 'club1' | 'club2'>): string =>
  !p.club2 || compact(p.club1) === compact(p.club2) ? p.club1 : !p.club1 ? p.club2 : `${p.club1} & ${p.club2}`;

const cmpText = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

/** HF > IF > NF, then club, then names. */
export function sortPairs(pairs: FlightPair[]): FlightPair[] {
  return [...pairs].sort((p, q) =>
    levelRank(q.level) - levelRank(p.level) || cmpText(pairClubs(p), pairClubs(q)) || cmpText(pairNames(p), pairNames(q)) || p.id.localeCompare(q.id));
}

export const flightName = (i: number): string => String.fromCharCode(65 + i);

/** Sorted HF > IF > NF, split evenly into two flights (the first gets the extra pair). */
export function defaultFlights(pairs: FlightPair[]): Flight[] {
  const ids = sortPairs(pairs).map((p) => p.id);
  const half = Math.ceil(ids.length / 2);
  return [{ name: 'A', pairIds: ids.slice(0, half) }, { name: 'B', pairIds: ids.slice(half) }];
}

export interface FlightsMerge {
  flights: Flight[];
  added: string[];
  removed: string[];
}

/**
 * Re-read the pairs: deleted pairs drop out, kept pairs keep their flight and order, new pairs join their level at the
 * end of that level's pairs (in the last flight that already holds the level, else the last flight). New pairs are
 * added in the default order (HF > IF > NF, club, names), so several new pairs of one level stay in that order.
 */
export function mergeFlights(flights: Flight[], pairs: FlightPair[]): FlightsMerge {
  if (flights.length === 0) return { flights: defaultFlights(pairs), added: pairs.map((p) => p.id), removed: [] };
  const byId = new Map(pairs.map((p) => [p.id, p]));
  const had = new Set(flights.flatMap((f) => f.pairIds));
  const removed = [...had].filter((id) => !byId.has(id));
  const next = flights.map((f) => ({ name: f.name, pairIds: f.pairIds.filter((id) => byId.has(id)) }));
  const added = sortPairs(pairs.filter((p) => !had.has(p.id))).map((p) => p.id);
  for (const id of added) {
    const level = byId.get(id)!.level;
    let fi = -1;
    next.forEach((f, i) => { if (f.pairIds.some((x) => byId.get(x)!.level === level)) fi = i; });
    if (fi < 0) fi = next.length - 1;
    const ids = next[fi].pairIds;
    let at = ids.length;
    for (let i = ids.length - 1; i >= 0; i--) if (byId.get(ids[i])!.level === level) { at = i + 1; break; }
    ids.splice(at, 0, id);
  }
  return { flights: next, added, removed };
}

/** Move a pair to flight `to`, at the end. */
export function movePair(flights: Flight[], id: string, to: number): Flight[] {
  return flights.map((f, i) => ({ name: f.name, pairIds: i === to ? [...f.pairIds.filter((x) => x !== id), id] : f.pairIds.filter((x) => x !== id) }));
}
