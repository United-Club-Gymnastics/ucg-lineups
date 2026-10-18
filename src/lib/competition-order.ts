// Copied from ucg-platform@32fb372 src/lib/competition-order.ts — keep in sync by hand
// Changed: header only.
// Pure helpers for "Set Competition Order" (event-mgmt v2 Phase 5, spec §E6;
// reworked to competition GROUPS 2026-10-04). MAG/WAG only. A club splits a
// level's athletes into capped groups (the same athletes on every apparatus)
// and drags each group's athletes into competing order per apparatus. Zero
// React/store imports — importable from tests and edge functions alike
// (mirrors the split of src/scoring/* and src/lib/pricing.ts).
//
// Shapes: `CompetitionGroups.groups` / `competition_groups.groups` and
// `CompetitionOrder.sections` / `competition_orders.sections` are both
// `string[][]` of registration ids; sections[k] mirrors group k.

/** Per-APPARATUS cap inside a group (spec §E6; C-11 2026-10-04: the cap is
 *  per apparatus, not per group): at most 12 (WAG) / 15 (MAG) of a group's
 *  athletes on any one apparatus. Competition order is MAG/WAG only — T&T
 *  never calls this. */
export function sectionCap(discipline: 'WAG' | 'MAG'): number {
  return discipline === 'WAG' ? 12 : 15;
}

/** Chunk a flat ordered list of registration ids into sections of at most
 *  `cap` each, preserving order. `cap <= 0` degrades to one id per section
 *  (never produces an empty or over-cap chunk). */
export function splitIntoSections(orderedRegIds: string[], cap: number): string[][] {
  const safeCap = cap > 0 ? Math.floor(cap) : 1;
  const sections: string[][] = [];
  for (let i = 0; i < orderedRegIds.length; i += safeCap) {
    sections.push(orderedRegIds.slice(i, i + safeCap));
  }
  return sections;
}

/** Concatenate sections back into one flat ordered list (inverse of
 *  `splitIntoSections`, modulo the section boundaries themselves). */
export function flattenSections(sections: string[][]): string[] {
  return sections.flat();
}

/** True iff every section has at most `cap` entries and no registration id
 *  appears more than once across all sections (empty sections/list are
 *  valid). */
export function sectionsValid(sections: string[][], cap: number): boolean {
  const seen = new Set<string>();
  for (const section of sections) {
    if (section.length > cap) return false;
    for (const regId of section) {
      if (seen.has(regId)) return false;
      seen.add(regId);
    }
  }
  return true;
}

/** Pure reorder: move `regId` to `sections[toSection][toIndex]`, removing it
 *  from wherever it currently sits first. Total/defensive — a `regId` not
 *  present is simply inserted (nothing to remove); an out-of-range
 *  `toSection`/`toIndex` clamps into range rather than throwing. Returns a
 *  new array (does not mutate the input). */
export function moveInSections(
  sections: string[][],
  regId: string,
  toSection: number,
  toIndex: number,
): string[][] {
  // Deep-ish copy (new outer array + new inner arrays) so callers can treat
  // the result as an independent snapshot.
  const next = sections.map((s) => s.filter((id) => id !== regId));

  if (next.length === 0) {
    // No sections to insert into — create one.
    return [[regId]];
  }

  const clampedSection = Math.min(Math.max(toSection, 0), next.length - 1);
  const target = next[clampedSection];
  const clampedIndex = Math.min(Math.max(toIndex, 0), target.length);
  target.splice(clampedIndex, 0, regId);

  return next;
}

/** Pure drop-target resolver for the drag UI's `onDragEnd` (B2 component):
 *  given the CURRENT `sections` (before removal), the dragged `regId`, the
 *  section index being dropped into (`toSection`), and what's under the
 *  pointer (`overId` — either another registration id or a section
 *  container), returns the index to pass to `moveInSections` as `toIndex`.
 *
 *  Container drops (`overIsContainer`) always append (index = post-removal
 *  length). Cross-section item drops use the hovered item's index in the
 *  POST-removal target section (removing `regId` doesn't touch a section it
 *  wasn't in, so pre/post-removal indices already agree there).
 *
 *  Same-section item drops are the tricky case (this is the fix for the
 *  "dragging down snaps back" bug): the hovered item's index must be read
 *  from the ORIGINAL (pre-removal) section, matching dnd-kit's `arrayMove`
 *  semantics (remove, then insert at the target's original slot). Using the
 *  post-removal index instead re-derives the dragged item's OWN original
 *  slot for a downward drag — e.g. `[A,B,C]` dragging A over B: post-removal
 *  is `[B,C]`, `indexOf(B)===0`, which re-inserts A at index 0 ⇒ `[A,B,C]`,
 *  a no-op. Reading B's index in the ORIGINAL `[A,B,C]` (index 1) instead
 *  yields the correct `[B,A,C]`. Upward same-section drags happen to work
 *  either way (removing a LATER item doesn't shift an EARLIER item's index),
 *  which is why only downward drags exhibited the bug. */
export function computeDropIndex(
  sections: string[][],
  regId: string,
  toSection: number,
  overId: string,
  overIsContainer: boolean,
): number {
  const target = sections[toSection] ?? [];
  const postRemoval = target.filter((id) => id !== regId);

  if (overIsContainer) return postRemoval.length;

  const fromSection = sections.findIndex((sec) => sec.includes(regId));
  if (fromSection === toSection) {
    const idx = target.indexOf(overId);
    return idx >= 0 ? idx : postRemoval.length;
  }

  const idx = postRemoval.indexOf(overId);
  return idx >= 0 ? idx : postRemoval.length;
}

/** Where `regId` lands if dropped over `overId` in section `toSection` —
 *  1-based `position` of `total` in that section after the move. Uses the
 *  same `computeDropIndex` + `moveInSections` the drop itself applies, so
 *  the screen-reader announcement (CompetitionOrderCard) always matches the
 *  real result. */
export function dropLandingPosition(
  sections: string[][],
  regId: string,
  toSection: number,
  overId: string,
  overIsContainer: boolean,
): { position: number; total: number } {
  const next = moveInSections(sections, regId, toSection, computeDropIndex(sections, regId, toSection, overId, overIsContainer));
  const target = next[toSection] ?? [];
  return { position: target.indexOf(regId) + 1, total: target.length };
}


// ---------------------------------------------------------------------------
// Competition GROUPS (Julia 2026-10-04)
// ---------------------------------------------------------------------------
// A club's sections are its squad groups: the SAME athletes on every apparatus
// of a level; only the competing ORDER differs per apparatus. Membership lives
// in `competition_groups.groups` (string[][] of registration ids, group index
// = group number); each `competition_orders` row's `sections[k]` mirrors group
// k — group k's athletes registered for that apparatus, in competing order.
// The host later places whole groups into squads.

/** "Group A", "Group B", … — letter for the group index (A–Z, then 27, 28…). */
export function groupLetter(index: number): string {
  return index >= 0 && index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

/** Registration id → the apparatus codes it is entered on (C-11: the group
 *  cap is per apparatus, so every cap helper needs it). Unknown id → []. */
export type ApparatusOf = (regId: string) => readonly string[];

/** Build an `ApparatusOf` from registrations (id + apparatus). */
export function apparatusLookup(regs: readonly { id: string; apparatus?: readonly string[] | null }[]): ApparatusOf {
  const byId = new Map(regs.map((r) => [r.id, r.apparatus ?? []]));
  return (regId) => byId.get(regId) ?? [];
}

/** C-11 (2026-10-04): does this registration take a place in a level's
 *  competition order / squads? Not refunded, not waitlisted, and still on at
 *  least one apparatus — a fully SCRATCHED row (withdrawn after the edit
 *  deadline: `withdrawnAt` set, `apparatus: []`) or a fully blanked one is
 *  out. Shared by the club's Competition Order card and the host squad
 *  builders (`squad-builder.ts` `squadEligible`). */
export function competesAtLevel(r: {
  refunded?: boolean;
  waitlisted?: boolean;
  withdrawnAt?: string | null;
  apparatus?: readonly string[] | null;
}): boolean {
  return !r.refunded && !r.waitlisted && (r.apparatus?.length ?? 0) > 0;
}

const uniqueCodes = (codes: readonly string[]): string[] => [...new Set(codes)];

/** How many of the group's athletes are on each apparatus. */
export function groupApparatusCounts(group: readonly string[], apparatusOf: ApparatusOf): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of group) for (const code of uniqueCodes(apparatusOf(id))) out[code] = (out[code] ?? 0) + 1;
  return out;
}

/** The most athletes the group has on any ONE apparatus (0 when empty) —
 *  what the cap is measured against ("busiest event 9 / 15"). */
export function busiestApparatusCount(group: readonly string[], apparatusOf: ApparatusOf): number {
  return Math.max(0, ...Object.values(groupApparatusCounts(group, apparatusOf)));
}

/** True iff any apparatus in this group has more than `cap` athletes. */
export function groupOverCap(group: readonly string[], cap: number, apparatusOf: ApparatusOf): boolean {
  return busiestApparatusCount(group, apparatusOf) > cap;
}

/** True iff any group is over cap on any apparatus ("Split required"). */
export function groupsOverCap(groups: readonly (readonly string[])[], cap: number, apparatusOf: ApparatusOf): boolean {
  return groups.some((g) => groupOverCap(g, cap, apparatusOf));
}

/** Room for `regId` in `group`: adding them keeps every apparatus THEY are
 *  on at or under `cap` (other apparatus don't matter). */
export function groupHasRoomFor(group: readonly string[], regId: string, cap: number, apparatusOf: ApparatusOf): boolean {
  const counts = groupApparatusCounts(group, apparatusOf);
  return uniqueCodes(apparatusOf(regId)).every((code) => (counts[code] ?? 0) + 1 <= cap);
}

/** Largest per-apparatus imbalance across groups: for each apparatus, the
 *  most minus the fewest athletes any group has on it. */
function apparatusSpread(groups: readonly (readonly string[])[], apparatusOf: ApparatusOf): number {
  const counts = groups.map((g) => groupApparatusCounts(g, apparatusOf));
  const codes = new Set(counts.flatMap((c) => Object.keys(c)));
  let spread = 0;
  for (const code of codes) {
    const per = counts.map((c) => c[code] ?? 0);
    spread = Math.max(spread, Math.max(...per) - Math.min(...per));
  }
  return spread;
}

/** `k` contiguous runs, sizes as even as possible (earlier runs take the
 *  remainder: 13 in 2 → 7 + 6). */
function contiguousRuns(ids: string[], k: number): string[][] {
  const base = Math.floor(ids.length / k);
  const extra = ids.length % k;
  const out: string[][] = [];
  let at = 0;
  for (let g = 0; g < k; g++) {
    const size = base + (g < extra ? 1 : 0);
    out.push(ids.slice(at, at + size));
    at += size;
  }
  return out;
}

/** `k` groups by load: each athlete — most apparatus first — goes to the
 *  group where the apparatus they're on are least loaded (then the smaller
 *  group, then the earlier one), never past `cap`. Null when someone can't be
 *  placed. Each group keeps the input order. */
function loadBalanced(ids: string[], k: number, cap: number, apparatusOf: ApparatusOf): string[][] | null {
  const pos = new Map(ids.map((id, i) => [id, i]));
  const appOf = new Map(ids.map((id) => [id, uniqueCodes(apparatusOf(id))]));
  const order = [...ids].sort((a, b) => appOf.get(b)!.length - appOf.get(a)!.length || pos.get(a)! - pos.get(b)!);
  const groups: string[][] = Array.from({ length: k }, () => []);
  const counts: Record<string, number>[] = Array.from({ length: k }, () => ({}));
  for (const id of order) {
    const codes = appOf.get(id)!;
    let best = -1;
    let bestLoad = 0;
    for (let g = 0; g < k; g++) {
      if (codes.some((c) => (counts[g][c] ?? 0) + 1 > cap)) continue;
      const load = Math.max(0, ...codes.map((c) => counts[g][c] ?? 0));
      if (best < 0 || load < bestLoad || (load === bestLoad && groups[g].length < groups[best].length)) {
        best = g;
        bestLoad = load;
      }
    }
    if (best < 0) return null;
    groups[best].push(id);
    for (const c of codes) counts[best][c] = (counts[best][c] ?? 0) + 1;
  }
  return groups.map((g) => g.sort((a, b) => pos.get(a)! - pos.get(b)!));
}

/** "Auto-split evenly": the FEWEST groups such that no apparatus in any
 *  group exceeds `cap` (C-11: the cap is per apparatus), as balanced as
 *  possible. Starts at the lower bound (busiest apparatus ÷ cap) and adds a
 *  group only when the athletes can't be placed. For each group count it
 *  prefers contiguous runs of the input with even sizes (13 on one apparatus
 *  at cap 12 → 7 + 6, order kept) when those respect the cap and are at
 *  least as even per apparatus as a load-balanced split; otherwise the
 *  load-balanced split (e.g. VT-only athletes listed before all-around ones
 *  are spread across both groups instead of filling Group A). Empty input →
 *  one empty group, so there is always a Group A. */
export function splitEvenly(orderedRegIds: string[], cap: number, apparatusOf: ApparatusOf): string[][] {
  const safeCap = cap > 0 ? Math.floor(cap) : 1;
  const n = orderedRegIds.length;
  if (n === 0) return [[]];
  const busiest = busiestApparatusCount(orderedRegIds, apparatusOf);
  for (let k = Math.max(1, Math.ceil(busiest / safeCap)); k <= n; k++) {
    const runs = contiguousRuns(orderedRegIds, k);
    const runsOk = !groupsOverCap(runs, safeCap, apparatusOf);
    const balanced = loadBalanced(orderedRegIds, k, safeCap, apparatusOf);
    if (runsOk && (!balanced || apparatusSpread(runs, apparatusOf) <= apparatusSpread(balanced, apparatusOf))) return runs;
    if (balanced) return balanced;
  }
  // Unreachable: with one athlete per group nothing exceeds a cap ≥ 1.
  return orderedRegIds.map((id) => [id]);
}

/** Reconcile persisted group membership (or `undefined` — nothing saved yet)
 *  against the CURRENT eligible registration ids at the level: ids no longer
 *  eligible (refunded, scratched, level/club change) drop out, duplicates
 *  keep their first placement, and everyone else keeps their group. Newly
 *  eligible ids go to the FIRST group with room for them (`groupHasRoomFor`:
 *  every apparatus they're on stays ≤ cap), else a new group at the end —
 *  and go at the FRONT of that group's membership (C-11: athletes new to a
 *  group compete first on EVERY apparatus, including one with no saved order
 *  row, whose order falls back to membership order). Never moves an
 *  already-placed athlete and never drops an empty group (the club added it
 *  on purpose); an over-cap group stays over cap — a valid in-progress state
 *  the UI flags. No saved groups → `splitEvenly`. */
export function reconcileGroups(
  existing: string[][] | undefined,
  eligibleRegIds: string[],
  cap: number,
  apparatusOf: ApparatusOf,
): string[][] {
  if (!existing || existing.length === 0) return splitEvenly(eligibleRegIds, cap, apparatusOf);
  const safeCap = cap > 0 ? Math.floor(cap) : 1;
  const eligible = new Set(eligibleRegIds);
  const placed = new Set<string>();
  const kept = existing.map((g) => g.filter((id) => {
    if (!eligible.has(id) || placed.has(id)) return false;
    placed.add(id);
    return true;
  }));
  const fresh: string[][] = kept.map(() => []);
  for (const id of eligibleRegIds) {
    if (placed.has(id)) continue;
    placed.add(id);
    const room = kept.findIndex((g, i) => groupHasRoomFor([...fresh[i], ...g], id, safeCap, apparatusOf));
    if (room >= 0) fresh[room].push(id);
    else { kept.push([]); fresh.push([id]); }
  }
  return kept.map((g, i) => [...fresh[i], ...g]);
}

/** One apparatus's `sections` derived from the groups: `sections[k]` = group
 *  k's athletes who are on this apparatus (`apparatusRegIds`), in competing
 *  order. Athletes already in `existingSections[k]` keep their relative order
 *  there; athletes new to that list (just registered for the apparatus, or
 *  just moved into group k) go FIRST, in group order (Julia 2026-10-03:
 *  "athletes new to a list go first"). Always returns exactly one section per
 *  group (possibly empty), so section index == group index. */
export function sectionsFromGroups(
  groups: string[][],
  apparatusRegIds: string[],
  existingSections: string[][] | undefined,
): string[][] {
  const onApparatus = new Set(apparatusRegIds);
  return groups.map((group, k) => {
    const members = group.filter((id) => onApparatus.has(id));
    const memberSet = new Set(members);
    const kept: string[] = [];
    const keptSet = new Set<string>();
    for (const id of existingSections?.[k] ?? []) {
      if (memberSet.has(id) && !keptSet.has(id)) { kept.push(id); keptSet.add(id); }
    }
    return [...members.filter((id) => !keptSet.has(id)), ...kept];
  });
}

/** Move one athlete into group `toGroup`, at the FRONT of its membership
 *  list (C-11: an athlete new to a group competes first on every apparatus
 *  — `sectionsFromGroups` puts them first where the apparatus has a saved
 *  order, and membership order is the order where it has none). Total: an
 *  out-of-range target or unknown id returns the groups unchanged (copied). */
export function moveAthleteToGroup(groups: string[][], regId: string, toGroup: number): string[][] {
  if (toGroup < 0 || toGroup >= groups.length || !groups.some((g) => g.includes(regId))) {
    return groups.map((g) => [...g]);
  }
  if (groups[toGroup].includes(regId)) return groups.map((g) => [...g]);
  return groups.map((g, i) => (i === toGroup ? [regId, ...g.filter((id) => id !== regId)] : g.filter((id) => id !== regId)));
}

/** Remove group `index` — only when it is EMPTY and not the last remaining
 *  group (membership changes go through `moveAthleteToGroup`, never a silent
 *  merge). Returns `null` when not removable. */
export function removeEmptyGroup(groups: string[][], index: number): string[][] | null {
  if (groups.length <= 1 || index < 0 || index >= groups.length || groups[index].length > 0) return null;
  return groups.filter((_, i) => i !== index).map((g) => [...g]);
}

/** Pure mirror of the `20261004150000_competition_groups` backfill, GROUPS
 *  half: derive a level's groups from its pre-groups `competition_orders`
 *  rows — the first row in the discipline's apparatus order (`apparatusOrder`,
 *  i.e. `APPARATUS[discipline]` codes; rows with an unknown code sort after,
 *  by code) supplies the groups (its sections), minus ids no longer eligible
 *  (duplicates keep their first spot); empty sections stay as empty groups;
 *  eligible ids not in it are appended, in `eligibleRegIds` order, to the
 *  LAST group (one group if the row had none). Also the client's fallback
 *  when a level has order rows but no saved groups row yet. */
export function deriveGroupsFromOrders(
  orders: { apparatus: string; sections: string[][] }[],
  apparatusOrder: string[],
  eligibleRegIds: string[],
): string[][] {
  const rank = (code: string) => {
    const i = apparatusOrder.indexOf(code);
    return i >= 0 ? i : Number.MAX_SAFE_INTEGER;
  };
  const source = [...orders].sort((a, b) => rank(a.apparatus) - rank(b.apparatus)
    || (a.apparatus < b.apparatus ? -1 : a.apparatus > b.apparatus ? 1 : 0))[0];
  const eligible = new Set(eligibleRegIds);
  const placed = new Set<string>();
  const groups = (source?.sections ?? []).map((sec) => sec.filter((id) => {
    if (!eligible.has(id) || placed.has(id)) return false;
    placed.add(id);
    return true;
  }));
  if (groups.length === 0) groups.push([]);
  const last = groups[groups.length - 1];
  for (const id of eligibleRegIds) if (!placed.has(id)) { last.push(id); placed.add(id); }
  return groups;
}

/** Pure mirror of the backfill's SECTIONS half: rewrite one apparatus row so
 *  `sections[k]` = group k's athletes on this apparatus, ordered by their
 *  position in the row's OLD flattened order (sections concatenated — the
 *  pre-groups model let each apparatus split independently, so only the flat
 *  order is meaningful); athletes the old row never listed go at the END of
 *  their group, in group order. (The live client instead puts newcomers
 *  FIRST — see `sectionsFromGroups`; the one-time backfill keeps a club's
 *  existing order untouched at the top.) */
export function backfillSectionsFromGroups(
  groups: string[][],
  apparatusRegIds: string[],
  oldSections: string[][],
): string[][] {
  const onApparatus = new Set(apparatusRegIds);
  const pos = new Map<string, number>();
  oldSections.flat().forEach((id, i) => { if (!pos.has(id)) pos.set(id, i); });
  return groups.map((group) => {
    const members = group.filter((id) => onApparatus.has(id));
    const listed = members.filter((id) => pos.has(id)).sort((a, b) => pos.get(a)! - pos.get(b)!);
    return [...listed, ...members.filter((id) => !pos.has(id))];
  });
}
