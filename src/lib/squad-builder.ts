// Copied from ucg-platform@32fb372 src/lib/squad-builder.ts — keep in sync by hand
// Changed: APPARATUS import now comes from ./apparatus (was ./types).
// Pure helpers for the HOST squad builder (Julia, approved mockup 2026-10-04).
// MAG/WAG sessions only — T&T keeps the per-athlete builder. A host places
// whole CLUB GROUPS (the clubs' own `competition_groups`, see
// competition-order.ts) into squads; squads come in one or two "flights" of
// one squad per apparatus, each squad in a flight starting on a different
// apparatus in Olympic (APPARATUS) order. Zero React/store imports —
// importable from tests (mirrors competition-order.ts / pricing.ts).

import { APPARATUS } from './apparatus';
import { sectionCap, reconcileGroups, splitEvenly, groupLetter, competesAtLevel, apparatusLookup } from './competition-order';

export type ArtisticDiscipline = 'WAG' | 'MAG';

/** The registration fields the builder reads. */
export interface GroupReg {
  id: string;
  /** '' / null = an independent athlete (no club) — never pooled. */
  clubId: string | null;
  levelId: string;
  apparatus: string[];
}

/** A saved `competition_groups` row (only the fields used here). */
export interface SavedGroupsRow {
  clubId: string;
  levelId: string;
  groups: string[][];
}

/** One club group card: (club, level, group index) → its registrations in
 *  THIS session that sit in the same place (a squad, or the tray when
 *  `squadId` is null). Normally a group is one card; a group whose athletes
 *  are split across squads in existing data (legacy round-robin splits) shows
 *  one card per fragment, each athlete's own squad being authoritative. */
export interface ClubGroupCard {
  /** Stable for (club, level, group, place) — the drag id. */
  key: string;
  /** Identifies the whole group regardless of placement (fragments of one
   *  group share it). */
  groupId: string;
  /** '' for an independent athlete's card. */
  clubId: string;
  /** Set for an independent athlete (no club): each is a card of one,
   *  labelled with the athlete's name instead of a club. */
  independentRegId?: string;
  levelId: string;
  groupIndex: number;
  /** Groups the club has at this level that hold athletes (event-wide). The
   *  letter is omitted from the label when this is 1. */
  groupCount: number;
  squadId: string | null;
  regIds: string[];
  /** Athletes in this card registered for each apparatus code. */
  routines: Record<string, number>;
  /** True when the group's athletes in this session are split across more
   *  than one place (squads and/or the tray). */
  fragment: boolean;
}

/** One squad as the builder edits it. `regIds` are THIS session's eligible
 *  registrations only. */
export interface PlanSquad {
  id: string;
  name: string;
  startEvent: number;
  regIds: string[];
}

/** A stored squad (structurally `Squad` from types.ts). */
export interface StoredSquad {
  id: string;
  name: string;
  startEvent: number;
  athleteRegIds: string[];
  holding?: boolean;
}

/** Who a squad builder places: refunded, waitlisted and fully scratched
 *  (no apparatus left) registrations are never placed (both builders —
 *  Julia 2026-10-04: T&T matches MAG/WAG). The SAME predicate as the club's
 *  Competition Order card (`competesAtLevel`, C-11). */
export const squadEligible = (r: { refunded?: boolean; waitlisted?: boolean; withdrawnAt?: string | null; apparatus?: readonly string[] | null }): boolean =>
  competesAtLevel(r);

export const apparatusCodes = (discipline: ArtisticDiscipline): string[] =>
  APPARATUS[discipline].map((a) => a.code);

/** Squads per flight = one per apparatus: WAG 4, MAG 6. */
export const flightSize = (discipline: ArtisticDiscipline): number => APPARATUS[discipline].length;

const clubGroupId = (clubId: string, levelId: string, groupIndex: number) => `${clubId}::${levelId}::${groupIndex}`;
const independentGroupId = (regId: string) => `indep::${regId}`;
const cardKey = (groupId: string, squadId: string | null) => `${groupId}::${squadId ?? '-'}`;

/** "<club> · <level> · Group A" — the group letter is dropped when the club
 *  has a single group at the level. */
export function groupCardLabel(clubName: string, levelName: string, groupIndex: number, groupCount: number): string {
  const base = `${clubName} · ${levelName}`;
  return groupCount > 1 ? `${base} · Group ${groupLetter(groupIndex)}` : base;
}

/** Routine counts per apparatus code for a set of registrations. Every code
 *  is present (0 when nobody is on it). */
export function routineCounts(regIds: string[], regById: Map<string, GroupReg>, codes: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const code of codes) out[code] = 0;
  for (const id of regIds) {
    const reg = regById.get(id);
    if (!reg) continue;
    for (const code of reg.apparatus) if (code in out) out[code] += 1;
  }
  return out;
}

/** Apparatus codes (in the given order) whose total exceeds `cap`. */
export function overCapApparatus(totals: Record<string, number>, cap: number, codes: string[]): string[] {
  return codes.filter((c) => (totals[c] ?? 0) > cap);
}

/** Per-apparatus routine cap for a squad: WAG 12, MAG 15 (the same
 *  per-apparatus cap as a club group's). */
export const squadRoutineCap = (discipline: ArtisticDiscipline): number => sectionCap(discipline);

/**
 * Derive this session's club group cards.
 *
 * - `sessionRegs`: the session's eligible registrations (caller filters:
 *   this session, `squadEligible` — not refunded, not waitlisted, not fully
 *   scratched).
 * - `eventRegs`: the event's eligible MAG/WAG registrations (same filter, all
 *   sessions) — a saved groups row is reconciled against the club's
 *   EVENT-WIDE level roster exactly like the club's own Competition Order
 *   card does, so a newly registered athlete lands in the same group the club
 *   sees; only then is each group narrowed to this session.
 * - No saved row for a (club, level): the club's event-wide athletes at
 *   that level split evenly (exactly what the club's Competition Order card
 *   shows), then narrowed to this session.
 * - Independent athletes (no club) are never pooled: one card each.
 * - `squadOf`: registration id → squad id for current placements (ids not in
 *   the map are in the tray).
 *
 * Cards are ordered clubs first, then independents; by `clubLabel` (or
 * `independentLabel(regId)`), then `levelRank`, then group index, tray
 * fragment before squad fragments.
 */
export function deriveClubGroupCards(input: {
  discipline: ArtisticDiscipline;
  sessionRegs: GroupReg[];
  eventRegs: GroupReg[];
  savedGroups: SavedGroupsRow[];
  squadOf: Map<string, string>;
  clubLabel?: (clubId: string) => string;
  independentLabel?: (regId: string) => string;
  levelRank?: (levelId: string) => number;
}): ClubGroupCard[] {
  const { discipline, sessionRegs, eventRegs, savedGroups, squadOf } = input;
  const cap = sectionCap(discipline);
  const codes = apparatusCodes(discipline);
  const regById = new Map(sessionRegs.map((r) => [r.id, r]));
  // C-11: the group cap is per apparatus — reconcile/split read each athlete's apparatus.
  const apparatusOf = apparatusLookup([...eventRegs, ...sessionRegs]);

  const cards: ClubGroupCard[] = [];
  const pairs: { clubId: string; levelId: string }[] = [];
  const seen = new Set<string>();
  for (const r of sessionRegs) {
    if (!r.clubId) {
      const groupId = independentGroupId(r.id);
      const squadId = squadOf.get(r.id) ?? null;
      cards.push({
        key: cardKey(groupId, squadId), groupId,
        clubId: '', independentRegId: r.id, levelId: r.levelId, groupIndex: 0, groupCount: 1,
        squadId, regIds: [r.id], routines: routineCounts([r.id], regById, codes), fragment: false,
      });
      continue;
    }
    const k = `${r.clubId}::${r.levelId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    pairs.push({ clubId: r.clubId, levelId: r.levelId });
  }

  for (const { clubId, levelId } of pairs) {
    const sessionIds = sessionRegs.filter((r) => r.clubId === clubId && r.levelId === levelId).map((r) => r.id);
    // The club's event-wide roster at the level (plus, defensively, any
    // session id the caller's event list lacks).
    const eligible = eventRegs.filter((r) => r.clubId === clubId && r.levelId === levelId).map((r) => r.id);
    const eligibleSet = new Set(eligible);
    for (const id of sessionIds) if (!eligibleSet.has(id)) eligible.push(id);
    const saved = savedGroups.find((g) => g.clubId === clubId && g.levelId === levelId);
    const groups = saved && saved.groups.length > 0
      ? reconcileGroups(saved.groups, eligible, cap, apparatusOf)
      : splitEvenly(eligible, cap, apparatusOf);
    const groupCount = groups.filter((g) => g.length > 0).length;
    const inSession = new Set(sessionIds);
    groups.forEach((group, gi) => {
      const members = group.filter((id) => inSession.has(id));
      if (members.length === 0) return;
      const byPlace = new Map<string | null, string[]>();
      for (const id of members) {
        const place = squadOf.get(id) ?? null;
        const list = byPlace.get(place) ?? [];
        list.push(id);
        byPlace.set(place, list);
      }
      const fragment = byPlace.size > 1;
      const groupId = clubGroupId(clubId, levelId, gi);
      for (const [squadId, regIds] of byPlace) {
        cards.push({
          key: cardKey(groupId, squadId), groupId,
          clubId, levelId, groupIndex: gi, groupCount, squadId, regIds,
          routines: routineCounts(regIds, regById, codes),
          fragment,
        });
      }
    });
  }

  const clubLabel = input.clubLabel ?? ((id: string) => id);
  const independentLabel = input.independentLabel ?? ((id: string) => id);
  const levelRank = input.levelRank ?? (() => 0);
  const labelOf = (c: ClubGroupCard) => (c.independentRegId ? independentLabel(c.independentRegId) : clubLabel(c.clubId));
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.independentRegId ? 1 : 0) - (b.c.independentRegId ? 1 : 0)
      || labelOf(a.c).localeCompare(labelOf(b.c))
      || levelRank(a.c.levelId) - levelRank(b.c.levelId)
      || a.c.groupIndex - b.c.groupIndex
      || (a.c.squadId === null ? 0 : 1) - (b.c.squadId === null ? 0 : 1)
      || a.i - b.i)
    .map(({ c }) => c);
}

/** Merge fragments back into whole groups (one card per club group, placed
 *  nowhere) — what auto-balance distributes and what "M club groups" counts. */
export function wholeGroups(cards: ClubGroupCard[]): ClubGroupCard[] {
  const out = new Map<string, ClubGroupCard>();
  for (const c of cards) {
    const k = cardKey(c.groupId, null);
    const prev = out.get(k);
    if (!prev) {
      out.set(k, { ...c, key: k, squadId: null, regIds: [...c.regIds], routines: { ...c.routines }, fragment: false });
    } else {
      prev.regIds.push(...c.regIds);
      for (const code of Object.keys(c.routines)) prev.routines[code] = (prev.routines[code] ?? 0) + c.routines[code];
    }
  }
  return [...out.values()];
}

/** The editable plan from stored squads: holding squads are dropped (their
 *  athletes are simply unplaced — the tray), and each squad keeps only this
 *  session's eligible registrations, each in its first squad only. */
export function planFromSquads(squads: StoredSquad[], eligibleRegIds: Iterable<string>): PlanSquad[] {
  const eligible = new Set(eligibleRegIds);
  const placed = new Set<string>();
  return squads.filter((q) => !q.holding).map((q) => ({
    id: q.id,
    name: q.name,
    startEvent: q.startEvent,
    regIds: q.athleteRegIds.filter((id) => {
      if (!eligible.has(id) || placed.has(id)) return false;
      placed.add(id);
      return true;
    }),
  }));
}

/** Back to stored squads (`athleteRegIds` = the placed registrations). */
export function planToSquads(plan: PlanSquad[]): StoredSquad[] {
  return plan.map((q) => ({ id: q.id, name: q.name, startEvent: q.startEvent, athleteRegIds: [...q.regIds] }));
}

export function squadOfMap(plan: PlanSquad[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const q of plan) for (const id of q.regIds) if (!m.has(id)) m.set(id, q.id);
  return m;
}

/** Move a card's registrations into squad `toSquadId` (appended), or back to
 *  the tray (`null`). An unknown squad id leaves the plan unchanged. */
export function moveRegs(plan: PlanSquad[], regIds: string[], toSquadId: string | null): PlanSquad[] {
  if (toSquadId !== null && !plan.some((q) => q.id === toSquadId)) return plan.map((q) => ({ ...q, regIds: [...q.regIds] }));
  const moving = new Set(regIds);
  return plan.map((q) => {
    const kept = q.regIds.filter((id) => !moving.has(id));
    return { ...q, regIds: q.id === toSquadId ? [...kept, ...regIds] : kept };
  });
}

/** Trade ALL group cards between two squads; each squad keeps its position,
 *  name and start event. Unknown or identical ids → unchanged copy. */
export function swapSquadGroups(plan: PlanSquad[], aId: string, bId: string): PlanSquad[] {
  const a = plan.find((q) => q.id === aId);
  const b = plan.find((q) => q.id === bId);
  if (!a || !b || aId === bId) return plan.map((q) => ({ ...q, regIds: [...q.regIds] }));
  return plan.map((q) => {
    if (q.id === aId) return { ...q, regIds: [...b.regIds] };
    if (q.id === bId) return { ...q, regIds: [...a.regIds] };
    return { ...q, regIds: [...q.regIds] };
  });
}

/** Start apparatus index for the `index`-th squad (0-based): squad i of each
 *  flight starts on apparatus i. */
export const startEventFor = (index: number, discipline: ArtisticDiscipline): number => index % flightSize(discipline);

/** Squad count for one flight (`'one'`) or two flights (`'two'`). */
export const squadCountFor = (flights: 'one' | 'two', discipline: ArtisticDiscipline): number =>
  flightSize(discipline) * (flights === 'two' ? 2 : 1);

/** Which flight mode a squad count is, or null for a non-standard (legacy)
 *  count. */
export function flightModeOf(count: number, discipline: ArtisticDiscipline): 'one' | 'two' | null {
  const n = flightSize(discipline);
  if (count === n) return 'one';
  if (count === 2 * n) return 'two';
  return null;
}

/** Squad index rows to draw: two labelled flights when the count is exactly
 *  two flights, else one row of every squad. */
export function flightRows(count: number, discipline: ArtisticDiscipline): number[][] {
  const idx = Array.from({ length: count }, (_, i) => i);
  const n = flightSize(discipline);
  return count === 2 * n ? [idx.slice(0, n), idx.slice(n)] : [idx];
}

/** Resize to `count` squads: squads that still exist keep their id and
 *  placements; every squad is renamed "Squad 1…" and given its flight start
 *  apparatus; new squads get fresh ids (`<sessionId>-q<k>`, never colliding
 *  with a kept id). `unplacedRegIds` = athletes of removed squads (they go
 *  back to the tray). */
export function resizePlan(
  plan: PlanSquad[],
  count: number,
  sessionId: string,
  discipline: ArtisticDiscipline,
): { plan: PlanSquad[]; unplacedRegIds: string[] } {
  const target = Math.max(0, Math.floor(count));
  const kept = plan.slice(0, target);
  const used = new Set(kept.map((q) => q.id));
  let k = 1;
  const freshId = () => {
    while (used.has(`${sessionId}-q${k}`)) k += 1;
    const id = `${sessionId}-q${k}`;
    used.add(id);
    return id;
  };
  const next: PlanSquad[] = Array.from({ length: target }, (_, i) => ({
    id: kept[i]?.id ?? freshId(),
    name: `Squad ${i + 1}`,
    startEvent: startEventFor(i, discipline),
    regIds: kept[i] ? [...kept[i].regIds] : [],
  }));
  return { plan: next, unplacedRegIds: plan.slice(target).flatMap((q) => q.regIds) };
}

/** A fresh plan for a session that has no squads yet: one flight. */
export const initialPlan = (sessionId: string, discipline: ArtisticDiscipline): PlanSquad[] =>
  resizePlan([], flightSize(discipline), sessionId, discipline).plan;

/** Club group cards that a resize to `count` would send back to the tray. */
export function cardsUnplacedByResize(plan: PlanSquad[], count: number, cards: ClubGroupCard[]): ClubGroupCard[] {
  const removed = new Set(plan.slice(Math.max(0, count)).map((q) => q.id));
  return cards.filter((c) => c.squadId !== null && removed.has(c.squadId));
}

/**
 * Auto-balance: start every squad empty, then place whole groups biggest
 * first, each into the squad where its busiest apparatus total ends up
 * lowest; ties go to the squad with the fewest athletes, then the earliest
 * squad. Squads keep id, name and start event.
 */
export function autoBalance(groups: ClubGroupCard[], plan: PlanSquad[], codes: string[]): PlanSquad[] {
  const next = plan.map((q) => ({ ...q, regIds: [] as string[] }));
  if (next.length === 0) return next;
  const totals = next.map(() => Object.fromEntries(codes.map((c) => [c, 0])) as Record<string, number>);
  const athletes = next.map(() => 0);
  const order = groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => b.g.regIds.length - a.g.regIds.length || a.i - b.i);
  for (const { g } of order) {
    let best = 0;
    let bestPeak = Infinity;
    for (let s = 0; s < next.length; s++) {
      const peak = Math.max(0, ...codes.map((c) => totals[s][c] + (g.routines[c] ?? 0)));
      if (peak < bestPeak || (peak === bestPeak && athletes[s] < athletes[best])) {
        best = s;
        bestPeak = peak;
      }
    }
    next[best].regIds.push(...g.regIds);
    for (const c of codes) totals[best][c] += g.routines[c] ?? 0;
    athletes[best] += g.regIds.length;
  }
  return next;
}

/** Registrations whose saved squad differs from the plan — what to apply to
 *  the local registration caches after a successful save. `regs` = every
 *  registration of the session (refunded/waitlisted included: the server
 *  clears their squad when the plan doesn't place them). */
export function placementChanges<R extends { id: string; squadId?: string | null }>(
  regs: R[],
  plan: PlanSquad[],
): (R & { squadId: string | null })[] {
  const next = squadOfMap(plan);
  return regs
    .filter((r) => (r.squadId ?? null) !== (next.get(r.id) ?? null))
    .map((r) => ({ ...r, squadId: next.get(r.id) ?? null }));
}

/** Rough capacity guide (no hard limit): about 10 athletes per squad — WAG
 *  one flight of 4 ≈ 40, two flights of 8 ≈ 85; MAG scaled to its 6
 *  apparatus: one flight of 6 ≈ 60, two flights of 12 ≈ 128. */
export const SQUAD_CAPACITY_GUIDE: Record<ArtisticDiscipline, { oneFlight: number; twoFlights: number }> = {
  WAG: { oneFlight: 40, twoFlights: 85 },
  MAG: { oneFlight: 60, twoFlights: 128 },
};

/** Above this many athletes per squad the guide suggests more squads. */
export const ATHLETES_PER_SQUAD_WARN = 11;

/** Guidance banner text. `warn` when athletes per squad exceed ~11. */
export function squadGuidance(
  athleteCount: number,
  squadCount: number,
  discipline: ArtisticDiscipline,
): { tone: 'info' | 'warn'; text: string } {
  const n = flightSize(discipline);
  const guide = SQUAD_CAPACITY_GUIDE[discipline];
  const info = {
    tone: 'info' as const,
    text: `About ${guide.oneFlight} athletes fit one flight of ${n} squads; about ${guide.twoFlights} fit two flights of ${2 * n}.`,
  };
  if (squadCount <= 0 || athleteCount <= 0) return info;
  const per = athleteCount / squadCount;
  if (per <= ATHLETES_PER_SQUAD_WARN) return info;
  const usual = squadCount === n ? guide.oneFlight
    : squadCount === 2 * n ? guide.twoFlights
      : Math.round((squadCount * guide.oneFlight) / n);
  const head = `${athleteCount} athletes is more than ${squadCount} squads usually hold (about ${usual}) — about ${Math.round(per)} per squad.`;
  const tail = squadCount < 2 * n
    ? ` Switch to ${2 * n} squads in 2 flights.`
    : ' Consider moving a level to another session.';
  return { tone: 'warn', text: head + tail };
}

// --- T&T per-athlete builder (`SquadBuilder`, Events.tsx) -----------------
// Same PlanSquad / save_session_squads shape as the MAG/WAG builder; these
// two build the plans its "N squads" and "Copy setup to other sessions"
// buttons commit.

const squadLetterName = (i: number) => `Squad ${String.fromCharCode(65 + i)}`;

/** `n` squads "Squad A…", rotation starts spread evenly across the
 *  session's `apparatusCount` events, athletes dealt round-robin. */
export function tntDefaultPlan(sessionId: string, n: number, apparatusCount: number, regIds: string[]): PlanSquad[] {
  const count = Math.max(1, n);
  const plan = Array.from({ length: count }, (_, i) => ({
    id: `${sessionId}-q${i + 1}`,
    name: squadLetterName(i),
    startEvent: apparatusCount > 0 ? Math.floor((i * apparatusCount) / count) % apparatusCount : 0,
    regIds: [] as string[],
  }));
  regIds.forEach((id, i) => plan[i % count].regIds.push(id));
  return plan;
}

/** Another session's copy of `template` (the source session's non-holding
 *  squads): same squad count (at least 1) and start events, renamed "Squad
 *  A…" with this session's ids, this session's athletes dealt round-robin. */
export function tntCopiedPlan(sessionId: string, template: StoredSquad[], regIds: string[]): PlanSquad[] {
  const source = template.filter((q) => !q.holding);
  const count = Math.max(1, source.length);
  const plan = Array.from({ length: count }, (_, i) => ({
    id: `${sessionId}-q${i + 1}`,
    name: squadLetterName(i),
    startEvent: source[i]?.startEvent ?? 0,
    regIds: [] as string[],
  }));
  regIds.forEach((id, i) => plan[i % count].regIds.push(id));
  return plan;
}
