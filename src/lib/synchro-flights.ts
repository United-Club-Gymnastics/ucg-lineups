// Pure: synchro flights. Pairs come from the Synchro tool (src/lib/synchro-source.ts, read-only); they are matched to this
// import's T&T athletes by club + name (spaces and punctuation ignored, as the import does), split into flights, and
// merged when the pairs are read again. Ported from the prototype (pairSort, ttDefaultFlights).
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
  /** Both athletes could not be matched to this session's athletes: shown as "Check pair". */
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

function index(people: Person[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const p of people) {
    const k = personKey(p.clubName, `${p.first}${p.last}`);
    m.set(k, [...(m.get(k) ?? []), p.id]);
  }
  return m;
}

/** `match` is 'one' for exactly one athlete, 'many' when several athletes share club + name, 'none'. */
function find(idx: Map<string, string[]>, club: string, name: string): { id: string | null; match: 'one' | 'many' | 'none' } {
  const ids = idx.get(personKey(club, name)) ?? [];
  return ids.length === 1 ? { id: ids[0], match: 'one' } : { id: null, match: ids.length > 1 ? 'many' : 'none' };
}

/**
 * The pairs that belong to this session, matched to its athletes. A pair belongs here when at least one of its athletes
 * is in `here`, or when neither of them matches any T&T athlete at all (then it is flagged, so nothing is hidden).
 * A pair with an athlete who cannot be matched here is flagged ("Check pair") and keeps the Synchro tool's names.
 * @param here this session's T&T athletes
 * @param elsewhere T&T athletes of the other T&T sessions (their pairs belong to those sessions)
 */
export function matchPairs(pairs: SynchroPair[], here: Person[], elsewhere: Person[] = []): FlightPair[] {
  const hereIdx = index(here);
  const elseIdx = index(elsewhere);
  const out: FlightPair[] = [];
  for (const p of pairs) {
    const a = find(hereIdx, p.club1, p.name1);
    const b = find(hereIdx, p.club2, p.name2);
    const ea = find(elseIdx, p.club1, p.name1);
    const eb = find(elseIdx, p.club2, p.name2);
    const mine = a.match !== 'none' || b.match !== 'none';
    const nowhere = !mine && ea.match === 'none' && eb.match === 'none';
    if (!mine && !nowhere) continue;
    const problems: string[] = [];
    const why = (who: typeof a, other: typeof ea, name: string) => {
      if (who.match === 'one') return;
      if (who.match === 'many') problems.push(`${name} matches more than one athlete`);
      else problems.push(other.match === 'none' ? `${name} is not in this import` : `${name} is in another T&T session`);
    };
    why(a, ea, p.name1 || 'First athlete');
    why(b, eb, p.name2 || 'Second athlete');
    out.push({
      id: p.id, level: tntLevelCode(p.level), name1: p.name1, name2: p.name2, club1: p.club1, club2: p.club2,
      athlete1: a.id, athlete2: b.id, check: problems.length > 0, problems,
    });
  }
  return out;
}

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
