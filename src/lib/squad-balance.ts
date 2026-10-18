// Pure: squad plan operations and auto-balance for artistic sessions (spec §4). Ported from the approved
// prototype's `autoBalance` / `specialistDelay`, with Julia's later rulings: the cap is a first priority, and
// Infinity (levelCode 'Inf') never shares a squad with another level in auto-balance.
// Reuses the copied card derivation in squad-builder.ts (not edited).
import type { ApparatusOf } from './competition-order';
import {
  deriveClubGroupCards, squadRoutineCap, wholeGroups,
  type ClubGroupCard, type GroupReg, type SavedGroupsRow,
} from './squad-builder';
import {
  apparatusCodes, columnCode, rotationFor, squadCountFor, squadLetter,
  type ArtisticDiscipline, type RotationPattern,
} from './rotation';

export const INFINITY_LEVEL = 'Inf';

/** One squad of a plan. `cardKeys` are keys of whole club-group cards (`ClubGroupCard.key` with no squad). */
export interface SquadSlot {
  name: string;
  cardKeys: string[];
}
export type SquadPlan = SquadSlot[];

export type SquadCard = ClubGroupCard;

export interface CardContext {
  discipline: ArtisticDiscipline;
  apparatusOf: ApparatusOf;
  levelRank: (levelId: string) => number;
  clubLabel: (clubId: string) => string;
  independentLabel?: (regId: string) => string;
}

// --- cards ---------------------------------------------------------------------------------------------

/**
 * The session's whole club-group cards (one per club group, athletes of this session only). Saved groups are
 * reconciled against the roster exactly like the club page does; a level with nothing saved gets the default
 * A-Z split. `sessionRegs` must already be in A-Z order (first name, last name) so the default matches.
 */
export function buildCards(input: {
  discipline: ArtisticDiscipline;
  sessionRegs: GroupReg[];
  savedGroups: SavedGroupsRow[];
  /** athlete id -> squad id (the squad's index as a string). When given, a group whose athletes sit in different
   *  places becomes one card per place (fragments), as in the platform builder, instead of whole groups. */
  squadOf?: Map<string, string>;
  clubLabel?: (clubId: string) => string;
  independentLabel?: (regId: string) => string;
  levelRank?: (levelId: string) => number;
}): SquadCard[] {
  const cards = deriveClubGroupCards({
    discipline: input.discipline,
    sessionRegs: input.sessionRegs,
    eventRegs: input.sessionRegs,
    savedGroups: input.savedGroups,
    squadOf: input.squadOf ?? new Map(),
    clubLabel: input.clubLabel,
    independentLabel: input.independentLabel,
    levelRank: input.levelRank,
  });
  return input.squadOf ? cards : wholeGroups(cards);
}

/** The plan implied by cards that carry a `squadId` (the squad's index as a string): each squad lists its cards in listing order. */
export function planFromCards(
  cards: SquadCard[],
  pattern: RotationPattern,
  discipline: ArtisticDiscipline,
  ctx: Pick<CardContext, 'levelRank' | 'clubLabel' | 'independentLabel'>,
): SquadPlan {
  const byKey = new Map(cards.map((c) => [c.key, c]));
  return emptyPlan(pattern, discipline).map((slot, i) => ({
    ...slot,
    cardKeys: sortKeys(cards.filter((c) => c.squadId === String(i)).map((c) => c.key), byKey, ctx),
  }));
}

/** Display label: `Club – Level · Group B`, or `Name (Independent) – Level`. */
export function cardLabel(card: SquadCard, levelName: string, ctx: Pick<CardContext, 'clubLabel' | 'independentLabel'>): string {
  if (card.independentRegId) return `${(ctx.independentLabel ?? ((id) => id))(card.independentRegId)} (Independent) – ${levelName}`;
  const base = `${ctx.clubLabel(card.clubId)} – ${levelName}`;
  return card.groupCount > 1 ? `${base} · Group ${String.fromCharCode(65 + card.groupIndex)}` : base;
}

/** Level rank, then club name (independents after clubs), then group, then independent name. */
export function compareCards(a: SquadCard, b: SquadCard, ctx: Pick<CardContext, 'levelRank' | 'clubLabel' | 'independentLabel'>): number {
  const indep = (c: SquadCard) => (c.independentRegId ? 1 : 0);
  const label = (c: SquadCard) => (c.independentRegId ? (ctx.independentLabel ?? ((id) => id))(c.independentRegId) : ctx.clubLabel(c.clubId));
  return ctx.levelRank(a.levelId) - ctx.levelRank(b.levelId)
    || indep(a) - indep(b)
    || label(a).localeCompare(label(b), 'en', { sensitivity: 'base' })
    || a.groupIndex - b.groupIndex
    || a.key.localeCompare(b.key);
}

// --- plan operations -----------------------------------------------------------------------------------

export function emptyPlan(pattern: RotationPattern, discipline: ArtisticDiscipline): SquadPlan {
  return Array.from({ length: squadCountFor(pattern, discipline) }, (_, i) => ({ name: squadLetter(i), cardKeys: [] }));
}

export const placedKeys = (plan: SquadPlan): Set<string> => new Set(plan.flatMap((s) => s.cardKeys));

export const unplacedCards = (plan: SquadPlan, cards: SquadCard[]): SquadCard[] => {
  const placed = placedKeys(plan);
  return cards.filter((c) => !placed.has(c.key));
};

export const clearPlan = (plan: SquadPlan): SquadPlan => plan.map((s) => ({ ...s, cardKeys: [] }));

/** Put a card in squad `toIndex` (appended) or back in the tray (`null`). Unknown squad: unchanged copy. */
export function moveCard(plan: SquadPlan, key: string, toIndex: number | null): SquadPlan {
  if (toIndex !== null && (toIndex < 0 || toIndex >= plan.length)) return plan.map((s) => ({ ...s, cardKeys: [...s.cardKeys] }));
  return plan.map((s, i) => {
    const kept = s.cardKeys.filter((k) => k !== key);
    return { ...s, cardKeys: i === toIndex ? [...kept, key] : kept };
  });
}

/** Trade ALL cards between two squads; each squad keeps its name and place in the rotation. Same as the platform's `swapSquadGroups`. */
export function swapSquads(plan: SquadPlan, a: number, b: number): SquadPlan {
  const copy = plan.map((s) => ({ ...s, cardKeys: [...s.cardKeys] }));
  if (a === b || !plan[a] || !plan[b]) return copy;
  copy[a].cardKeys = [...plan[b].cardKeys];
  copy[b].cardKeys = [...plan[a].cardKeys];
  return copy;
}

/** Squad cards in listing order: level, then club name, independents after clubs. */
export function sortKeys(keys: string[], byKey: Map<string, SquadCard>, ctx: Pick<CardContext, 'levelRank' | 'clubLabel' | 'independentLabel'>): string[] {
  return keys
    .filter((k) => byKey.has(k))
    .sort((a, b) => compareCards(byKey.get(a)!, byKey.get(b)!, ctx));
}

// --- per-squad numbers and flags -----------------------------------------------------------------------

export interface SquadStats {
  athletes: number;
  routines: Record<string, number>;
  /** Apparatus codes over the per-apparatus cap, in apparatus order. */
  overCap: string[];
  /** Level codes in the squad, in level order. */
  levels: string[];
  mixed: boolean;
  /** Infinity together with another level (always a flag; auto-balance never does this). */
  infinityMixed: boolean;
}

export function squadStats(cards: SquadCard[], discipline: ArtisticDiscipline, levelRank: (l: string) => number): SquadStats {
  const codes = apparatusCodes(discipline);
  const routines = Object.fromEntries(codes.map((c) => [c, 0])) as Record<string, number>;
  let athletes = 0;
  for (const c of cards) {
    athletes += c.regIds.length;
    for (const code of codes) routines[code] += c.routines[code] ?? 0;
  }
  const cap = squadRoutineCap(discipline);
  const levels = [...new Set(cards.map((c) => c.levelId))].sort((a, b) => levelRank(a) - levelRank(b) || a.localeCompare(b));
  return {
    athletes,
    routines,
    overCap: codes.filter((c) => routines[c] > cap),
    levels,
    mixed: levels.length > 1,
    infinityMixed: levels.length > 1 && levels.includes(INFINITY_LEVEL),
  };
}

/** Per-squad stats for a whole plan (squads in plan order). */
export function planStats(plan: SquadPlan, byKey: Map<string, SquadCard>, discipline: ArtisticDiscipline, levelRank: (l: string) => number): SquadStats[] {
  return plan.map((s) => squadStats(s.cardKeys.map((k) => byKey.get(k)).filter((c): c is SquadCard => !!c), discipline, levelRank));
}

/** Athletes on 1 or 2 apparatus. */
export const isSpecialist = (apparatus: readonly string[]): boolean => apparatus.length > 0 && apparatus.length <= 2;

export interface SpecialistInfo {
  regId: string;
  apparatus: string[];
  /** 1-based rotation in which the squad first reaches one of their apparatus (a bye counts as a rotation). */
  firstRotation: number;
}

export function squadSpecialists(
  regIds: string[],
  apparatusOf: ApparatusOf,
  squadIndex: number,
  pattern: RotationPattern,
  discipline: ArtisticDiscipline,
): SpecialistInfo[] {
  const rot = rotationFor(squadIndex, pattern, discipline);
  const out: SpecialistInfo[] = [];
  for (const id of regIds) {
    const app = [...apparatusOf(id)];
    if (!isSpecialist(app)) continue;
    const ix = rot.findIndex((c) => app.includes(columnCode(c)));
    out.push({ regId: id, apparatus: app, firstRotation: ix + 1 });
  }
  return out;
}

// --- capacity guide ------------------------------------------------------------------------------------

/** Julia: up to 80 MAG in 6 squads (160 in 12); WAG up to 85 in 8 squads (40 in 4 is the platform figure, an assumption). */
export const CAPACITY: Record<ArtisticDiscipline, { one: number; two: number }> = {
  MAG: { one: 80, two: 160 },
  WAG: { one: 40, two: 85 },
};

export interface CapacityGuide {
  tone: 'info' | 'warn';
  squads: number;
  fit: number;
  text: string;
}

export function capacityGuide(athletes: number, pattern: RotationPattern, discipline: ArtisticDiscipline): CapacityGuide {
  const squads = squadCountFor(pattern, discipline);
  const two = pattern !== 'one';
  const fit = two ? CAPACITY[discipline].two : CAPACITY[discipline].one;
  const n = squadCountFor('one', discipline);
  if (athletes > fit) {
    const tail = two ? 'Move a level to another session.' : 'Switch to two flights or move a level to another session.';
    return { tone: 'warn', squads, fit, text: `${athletes} athletes is more than ${squads} ${discipline} squads hold (up to ${fit}). ${tail}` };
  }
  const { one, two: twoFit } = CAPACITY[discipline];
  return {
    tone: 'info', squads, fit,
    text: `Up to ${one} ${discipline} athletes fit in ${n} squads, and up to ${twoFit} in ${n * 2}. This session has ${athletes}.`,
  };
}

// --- auto-balance --------------------------------------------------------------------------------------

export interface BalanceInput extends CardContext {
  cards: SquadCard[];
  pattern: RotationPattern;
}

const lexLess = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

/**
 * Auto-balance, in Julia's priority order:
 *  1. never over the per-apparatus cap when avoidable;
 *  2. a club stays together: the whole club if it fits, else each level as a unit, else group by group;
 *     later pieces prefer a squad already holding the club;
 *  3. squads single-level where possible; Infinity never shares a squad with another level (hard, in auto-balance);
 *  4. athletes on only 1-2 apparatus: prefer the squad whose rotation reaches their first apparatus earliest;
 *  5. then even out the busiest apparatus.
 * Units are placed biggest first (Infinity units before the rest, so squads for them are reserved up front);
 * each goes to the squad with the lowest score vector [over cap, claims a new Infinity squad beyond need,
 * club apart, level mix, busiest apparatus + specialist delay, athletes, squad index].
 */
export function autoBalance(input: BalanceInput): SquadPlan {
  const { cards, pattern, discipline, apparatusOf } = input;
  const plan = emptyPlan(pattern, discipline);
  const n = plan.length;
  if (n === 0 || cards.length === 0) return plan;
  const codes = apparatusCodes(discipline);
  const cap = squadRoutineCap(discipline);
  const sum = (cs: SquadCard[]): Record<string, number> => Object.fromEntries(codes.map((c) => [c, cs.reduce((t, x) => t + (x.routines[c] ?? 0), 0)]));
  const fits = (cs: SquadCard[]) => Math.max(0, ...Object.values(sum(cs))) <= cap;
  const isInf = (c: SquadCard) => c.levelId === INFINITY_LEVEL;

  // Units: whole club if it fits (and does not put Infinity with another level), else per level, else per card.
  const byClub = new Map<string, SquadCard[]>();
  for (const c of cards) {
    const k = c.clubId ? `club:${c.clubId}` : `card:${c.key}`;
    byClub.set(k, [...(byClub.get(k) ?? []), c]);
  }
  const units: SquadCard[][] = [];
  for (const cs of byClub.values()) {
    const mixesInf = cs.some(isInf) && cs.some((c) => !isInf(c));
    if (!mixesInf && fits(cs)) { units.push(cs); continue; }
    const byLevel = new Map<string, SquadCard[]>();
    for (const c of cs) byLevel.set(c.levelId, [...(byLevel.get(c.levelId) ?? []), c]);
    for (const lcs of byLevel.values()) {
      if (fits(lcs)) units.push(lcs);
      else for (const c of lcs) units.push([c]);
    }
  }
  const size = (u: SquadCard[]) => u.reduce((t, c) => t + c.regIds.length, 0);
  const unitIsInf = (u: SquadCard[]) => u.every(isInf);
  const ordered = units
    .map((u, i) => ({ u, i }))
    .sort((a, b) => (unitIsInf(b.u) ? 1 : 0) - (unitIsInf(a.u) ? 1 : 0) || size(b.u) - size(a.u) || a.i - b.i)
    .map((x) => x.u);

  // How many squads Infinity needs: enough for its athletes at the average squad size, and for the cap.
  const infCards = cards.filter(isInf);
  const hasOther = cards.some((c) => !isInf(c));
  const totalAthletes = cards.reduce((t, c) => t + c.regIds.length, 0);
  const perSquad = Math.max(1, Math.ceil(totalAthletes / n));
  const infAthletes = infCards.reduce((t, c) => t + c.regIds.length, 0);
  const infPeak = Math.max(0, ...Object.values(sum(infCards)));
  const infTarget = infCards.length === 0 ? 0
    : Math.min(hasOther ? Math.max(1, n - 1) : n, Math.max(1, Math.ceil(infAthletes / perSquad), Math.ceil(infPeak / cap)));

  const rots = plan.map((_, i) => rotationFor(i, pattern, discipline));
  const delay = (ids: string[], s: number) => ids.reduce((t, id) => {
    const app = apparatusOf(id);
    if (!isSpecialist(app)) return t;
    return t + Math.max(0, rots[s].findIndex((c) => app.includes(columnCode(c))));
  }, 0);

  const tot = plan.map(() => Object.fromEntries(codes.map((c) => [c, 0])) as Record<string, number>);
  const levels = plan.map(() => new Set<string>());
  const clubs = plan.map(() => new Set<string>());
  const athletes = plan.map(() => 0);
  const members: SquadCard[][] = plan.map(() => []);
  const infSquad = plan.map(() => false);
  let infClaimed = 0;

  for (const u of ordered) {
    const ids = u.flatMap((c) => c.regIds);
    const r = sum(u);
    const ulv = new Set(u.map((c) => c.levelId));
    const club = u[0].clubId;
    const uInf = unitIsInf(u);
    const clubPlaced = !!club && clubs.some((s) => s.has(club));
    const feasible = (s: number) => (uInf ? !levels[s].size || [...levels[s]].every((l) => l === INFINITY_LEVEL) : !infSquad[s]);
    let candidates = plan.map((_, s) => s).filter(feasible);
    if (candidates.length === 0) candidates = plan.map((_, s) => s); // no way to keep Infinity apart: place anyway, flagged in the UI
    let best = candidates[0];
    let bestScore: number[] | null = null;
    for (const s of candidates) {
      const over = codes.some((c) => tot[s][c] + r[c] > cap) ? 1 : 0;
      const claimsNew = uInf && !infSquad[s] && infClaimed >= infTarget ? 1 : 0;
      const apart = clubPlaced && !clubs[s].has(club) ? 1 : 0;
      const mix = athletes[s] === 0 ? 0 : new Set([...levels[s], ...ulv]).size - Math.max(levels[s].size, ulv.size);
      const peak = Math.max(0, ...codes.map((c) => tot[s][c] + r[c]));
      const score = [over, claimsNew, apart, mix, peak + delay(ids, s), athletes[s], s];
      if (!bestScore || lexLess(score, bestScore)) { best = s; bestScore = score; }
    }
    members[best].push(...u);
    for (const c of codes) tot[best][c] += r[c];
    athletes[best] += ids.length;
    ulv.forEach((l) => levels[best].add(l));
    if (club) clubs[best].add(club);
    if (uInf && !infSquad[best]) { infSquad[best] = true; infClaimed++; }
  }

  const byKey = new Map(cards.map((c) => [c.key, c]));
  return plan.map((slot, s) => ({ ...slot, cardKeys: sortKeys(members[s].map((c) => c.key), byKey, input) }));
}
