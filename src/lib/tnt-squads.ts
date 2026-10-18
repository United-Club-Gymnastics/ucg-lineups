// Pure: T&T squads (3 squads A/B/C), auto-balance, per-event competing order and restore. Ported from the approved
// prototype (ttPrimary, ttRotation, ttSortDefault, ttAutoBalance, ttOrder). Clubs never order T&T: UCG does.

export const TNT_EVENTS = ['TR', 'DM', 'TU'] as const;
export type TntEvent = (typeof TNT_EVENTS)[number];
export type TntCode = TntEvent | 'SY';

export const TNT_EVENT_NAME: Record<TntCode, string> = {
  TR: 'Trampoline', DM: 'Double Mini', TU: 'Tumbling', SY: 'Synchro Trampoline',
};
/** Lowest to highest. */
export const TNT_LEVELS = ['NF', 'IF', 'HF'] as const;
export const TNT_LEVEL_NAME: Record<string, string> = { NF: 'New Flyers', IF: 'Intermediate Flyers', HF: 'High Flyers' };

export const TNT_SQUAD_COUNT = 3;
/** Never more than this in a squad. */
export const TNT_CAP = 15;
/** Usual squad size; above the top of it is a warning. */
export const TNT_USUAL: readonly [number, number] = [10, 12];

export interface TntAthlete {
  id: string;
  first: string;
  last: string;
  clubId: string;
  /** Full club name (what is always printed, and what orders are sorted by). */
  clubName: string;
  independent: boolean;
  /** Level (NF/IF/HF) on each event the athlete is entered in. */
  levels: Partial<Record<TntCode, string>>;
}

export const squadLetter = (i: number): string => String.fromCharCode(65 + i);
export const fullName = (a: Pick<TntAthlete, 'first' | 'last'>): string => `${a.first} ${a.last}`.trim();

/** NF 0, IF 1, HF 2; anything unknown ranks below NF. */
export const levelRank = (l: string | undefined): number => (l ? (TNT_LEVELS as readonly string[]).indexOf(l) : -1);

/** Entered in at least one of TR / DM / TU (so placed in a squad). */
export const inSquads = (a: TntAthlete): boolean => TNT_EVENTS.some((e) => !!a.levels[e]);
/** Entered in synchro and nothing else: not in a squad. */
export const isSynchroOnly = (a: TntAthlete): boolean => !inSquads(a) && !!a.levels.SY;

/** The level an athlete competes at on most of TR/DM/TU; a tie goes to the higher level. */
export function primaryLevel(a: Pick<TntAthlete, 'levels'>): string | undefined {
  const n = new Map<string, number>();
  for (const e of TNT_EVENTS) {
    const l = a.levels[e];
    if (l) n.set(l, (n.get(l) ?? 0) + 1);
  }
  return [...n.keys()].sort((x, y) => n.get(y)! - n.get(x)! || levelRank(y) - levelRank(x) || x.localeCompare(y))[0];
}

/** Squad i starts on event i: A TR>DM>TU, B DM>TU>TR, C TU>TR>DM. */
export const rotationFor = (i: number): TntEvent[] => TNT_EVENTS.map((_, k) => TNT_EVENTS[(i + k) % 3]);

// --- default order -----------------------------------------------------------------------------------------

const cmpText = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

/** HF > IF > NF on this event, then full club name A–Z, then first name, then last name. */
export function defaultComparator(event: TntEvent, byId: Map<string, TntAthlete>) {
  return (x: string, y: string): number => {
    const a = byId.get(x)!;
    const b = byId.get(y)!;
    return levelRank(b.levels[event]) - levelRank(a.levels[event])
      || cmpText(a.clubName, b.clubName) || cmpText(a.first, b.first) || cmpText(a.last, b.last) || x.localeCompare(y);
  };
}

export const defaultOrder = (ids: string[], event: TntEvent, byId: Map<string, TntAthlete>): string[] =>
  [...ids].sort(defaultComparator(event, byId));

/** The squad's athletes entered on `event`, in the saved order if there is one. People missing from the saved order
 *  (new to the squad or the event) are inserted at their default spot, i.e. before the first saved athlete who
 *  sorts after them; people no longer in the squad or on the event drop out. */
export function orderFor(squadIds: string[], event: TntEvent, saved: string[] | undefined, byId: Map<string, TntAthlete>): string[] {
  const on = squadIds.filter((id) => byId.get(id)?.levels[event]);
  const cmp = defaultComparator(event, byId);
  if (!saved) return [...on].sort(cmp);
  const onSet = new Set(on);
  const kept = [...new Set(saved)].filter((id) => onSet.has(id));
  const keptSet = new Set(kept);
  const out = [...kept];
  for (const id of on.filter((x) => !keptSet.has(x)).sort(cmp)) {
    const at = out.findIndex((x) => cmp(id, x) < 0);
    out.splice(at < 0 ? out.length : at, 0, id);
  }
  return out;
}

export const orderKey = (squad: number, event: TntEvent): string => `${squadLetter(squad)}_${event}`;

/** Keep only orders that differ from the default, each reconciled with the current squads. */
export function normalizeOrders(squads: string[][], orders: Record<string, string[]>, byId: Map<string, TntAthlete>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  squads.forEach((ids, s) => {
    for (const e of TNT_EVENTS) {
      const key = orderKey(s, e);
      if (!orders[key]) continue;
      const order = orderFor(ids, e, orders[key], byId);
      const def = defaultOrder(order, e, byId);
      if (order.some((id, i) => id !== def[i])) out[key] = order;
    }
  });
  return out;
}

// --- flags ----------------------------------------------------------------------------------------------------

export type SizeStatus = 'ok' | 'high' | 'over';
/** ok: up to 12; high: 13–15 (above the usual); over: more than 15. */
export const sizeStatus = (n: number): SizeStatus => (n > TNT_CAP ? 'over' : n > TNT_USUAL[1] ? 'high' : 'ok');

export interface MixedEvent {
  event: TntEvent;
  /** Highest first. */
  levels: string[];
}

/** Per event, the levels in the squad when there is more than one. */
export function mixedLevels(ids: string[], byId: Map<string, TntAthlete>): MixedEvent[] {
  const out: MixedEvent[] = [];
  for (const event of TNT_EVENTS) {
    const set = new Set(ids.map((id) => byId.get(id)?.levels[event]).filter((l): l is string => !!l));
    if (set.size > 1) out.push({ event, levels: [...set].sort((a, b) => levelRank(b) - levelRank(a)) });
  }
  return out;
}

/** "TR HF/IF · DM IF/NF" */
export const mixedText = (m: MixedEvent[]): string => m.map((x) => `${x.event} ${x.levels.join('/')}`).join(' · ');

// --- auto-balance -----------------------------------------------------------------------------------------

/** Split into `ceil(n / max)` pieces of near-equal size, keeping order. */
function splitEven<T>(xs: T[], max: number): T[][] {
  const k = Math.ceil(xs.length / max);
  const base = Math.floor(xs.length / k);
  const extra = xs.length % k;
  const out: T[][] = [];
  let at = 0;
  for (let i = 0; i < k; i++) {
    const size = base + (i < extra ? 1 : 0);
    out.push(xs.slice(at, at + size));
    at += size;
  }
  return out;
}

const lexLess = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

/**
 * Three squads. Units are placed biggest first. A club is one unit (a club over 15 is split by each athlete's primary
 * level, a level into pieces of at most 12 that stay near equal; independents are units of one). Each unit goes to the
 * squad that is best on, in order: not going over 15; keeping a club that is already placed in one squad (pieces
 * stay close); mixing the fewest levels (primary level); the fewest athletes.
 * Athletes entered only in synchro are not placed.
 */
export function autoBalance(athletes: TntAthlete[]): string[][] {
  const pool = athletes.filter(inSquads);
  const byId = new Map(pool.map((a) => [a.id, a]));
  const byClub = new Map<string, string[]>();
  for (const a of pool) {
    const key = a.independent ? `indep|${a.id}` : a.clubId;
    byClub.set(key, [...(byClub.get(key) ?? []), a.id]);
  }
  const units: string[][] = [];
  for (const ids of byClub.values()) {
    if (ids.length <= TNT_CAP) { units.push(ids); continue; }
    const byLevel = new Map<string, string[]>();
    for (const id of ids) {
      const l = primaryLevel(byId.get(id)!) ?? '';
      byLevel.set(l, [...(byLevel.get(l) ?? []), id]);
    }
    for (const l of byLevel.values()) units.push(...splitEven(l, TNT_USUAL[1]));
  }
  units.sort((a, b) => b.length - a.length);

  const squads: string[][] = Array.from({ length: TNT_SQUAD_COUNT }, () => []);
  const levels = squads.map(() => new Set<string>());
  const clubs = squads.map(() => new Set<string>());
  for (const u of units) {
    const first = byId.get(u[0])!;
    const club = first.independent ? null : first.clubId;
    const ulv = new Set(u.map((id) => primaryLevel(byId.get(id)!) ?? ''));
    const placed = !!club && clubs.some((s) => s.has(club));
    let best = 0;
    let bestScore: number[] | null = null;
    for (let s = 0; s < TNT_SQUAD_COUNT; s++) {
      const over = squads[s].length + u.length > TNT_CAP ? 1 : 0;
      const apart = placed && !clubs[s].has(club!) ? 1 : 0;
      const mix = squads[s].length === 0 ? 0 : new Set([...levels[s], ...ulv]).size - Math.max(levels[s].size, ulv.size);
      const score = [over, apart, mix, squads[s].length];
      if (!bestScore || lexLess(score, bestScore)) { best = s; bestScore = score; }
    }
    squads[best].push(...u);
    ulv.forEach((l) => levels[best].add(l));
    if (club) clubs[best].add(club);
  }
  return squads;
}

/** Move one athlete to squad `to` (null = unplaced), at the end of that squad. */
export function moveAthlete(squads: string[][], id: string, to: number | null): string[][] {
  return squads.map((s, i) => (i === to ? [...s.filter((x) => x !== id), id] : s.filter((x) => x !== id)));
}

// --- restore ----------------------------------------------------------------------------------------------

export interface TntChange {
  kind: 'dropped' | 'added';
  /** For `dropped`: the squad they were in. */
  squad?: string;
  /** "Name · Club" */
  names: string[];
}

export interface TntRestored {
  squads: string[][];
  /** Eligible athletes who are in no squad. */
  tray: string[];
  changes: TntChange[];
  movedCount: number;
}

/**
 * Bring saved squads up to date with who is competing now. Athletes who left (removed, scratched, now synchro-only)
 * drop out of their squad; athletes who joined since are put in the tray, never into a squad. Nothing is silent:
 * both are returned in `changes`.
 * @param eligible athletes in squads now (entered on TR/DM/TU)
 * @param describe name · club of any athlete, including ones who have left
 */
export function restoreTntSquads(input: {
  stored: { squads: { name: string; athleteIds: string[] }[]; trayAthleteIds: string[] } | null;
  eligible: TntAthlete[];
  describe: (id: string) => string;
}): TntRestored {
  const { stored, eligible, describe } = input;
  const ok = new Set(eligible.map((a) => a.id));
  if (!stored) return { squads: Array.from({ length: TNT_SQUAD_COUNT }, () => []), tray: eligible.map((a) => a.id), changes: [], movedCount: 0 };
  const seen = new Set<string>();
  const dropped = new Map<number, string[]>();
  const squads: string[][] = Array.from({ length: TNT_SQUAD_COUNT }, (_, i) => {
    const keep: string[] = [];
    for (const id of stored.squads[i]?.athleteIds ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (ok.has(id)) keep.push(id);
      else dropped.set(i, [...(dropped.get(i) ?? []), id]);
    }
    return keep;
  });
  const known = new Set([...seen, ...stored.trayAthleteIds]);
  const placed = new Set(squads.flat());
  const tray = eligible.map((a) => a.id).filter((id) => !placed.has(id));
  const changes: TntChange[] = [];
  for (const [i, ids] of [...dropped].sort((a, b) => a[0] - b[0])) changes.push({ kind: 'dropped', squad: `Squad ${squadLetter(i)}`, names: ids.map(describe) });
  const added = eligible.filter((a) => !known.has(a.id)).map((a) => describe(a.id));
  if (added.length) changes.push({ kind: 'added', names: added });
  return { squads, tray, changes, movedCount: changes.reduce((t, c) => t + c.names.length, 0) };
}
