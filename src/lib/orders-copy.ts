// Pure: "Start orders from another meet" (spec §7b). For each club, copy the saved competing order of the SOURCE meet (Prelims) into
// the TARGET meet (Finals), per discipline + level code + apparatus. Athlete ids are the same in every meet
// (`<DISC>_<club slug>_<name slug>`), so a source order is filtered to the athletes present in the target. Nobody new is expected in
// the target (you must compete in Prelims to reach Finals); if someone is, they go to the END, A–Z, and are listed.
import { APPARATUS } from './apparatus';
import type { LinkAthlete, LinkLevel, LinkSession } from './club-links';
import { azIds, type ArtisticDiscipline, type LevelOrder } from './club-order-model';
import { levelStatus } from './club-status';
import { apparatusLookup, groupsOverCap, reconcileGroups, sectionCap, splitEvenly } from './competition-order';
import type { Discipline } from './import/types';

export interface ClubCopyInput {
  clubId: string;
  /** The club's private-link token: its orders live under it in every meet. */
  token: string;
  clubName: string;
  /** The club's roster in the source / target meet (a club that is not in a meet has no sessions there). */
  source: LinkSession[];
  target: LinkSession[];
  /** level key -> saved order, per meet. */
  sourceSaved: Record<string, LevelOrder>;
  targetSaved: Record<string, LevelOrder>;
}

export interface CopyOptions {
  /** Replace orders the club already saved in the target meet (default: leave them). */
  replace: boolean;
}

export interface PlannedLevelCopy {
  clubId: string;
  token: string;
  clubName: string;
  discipline: ArtisticDiscipline;
  levelCode: string;
  levelName: string;
  sourceKey: string;
  targetKey: string;
  order: LevelOrder;
  /** Athletes in the target level (what the copied order covers). */
  athletes: number;
  /** Athletes of the target that were not in the source order: put at the end, A–Z. */
  newcomers: { id: string; name: string }[];
  /** The source groups did not fit the cap in the target, so the groups were re-split. */
  resplit: boolean;
  /** An order the club had already saved in the target is overwritten (the "replace" option). */
  replaces: boolean;
}

export interface LevelRef { discipline: Discipline; levelCode: string; levelName: string }

export interface CopyPlan {
  writes: PlannedLevelCopy[];
  /** Clubs with at least one level copied. */
  clubs: number;
  levels: number;
  athletes: number;
  /** Matched levels where the target already holds an order the club set, left alone. */
  skippedSet: number;
  /** Matched levels where an order the club set is overwritten (only with the replace option). */
  replaced: number;
  /** Target levels with no usable source (nothing saved, left at A–Z, or no matching level): they stay as they are. */
  noSource: number;
  /** Source levels with a saved order that has no matching level for that club in the target. */
  unplaced: number;
  resplit: number;
  /** Levels (discipline + code) present in one meet and absent from the other across all the clubs. */
  unmatchedSource: LevelRef[];
  unmatchedTarget: LevelRef[];
  newcomers: { clubName: string; levelName: string; names: string[] }[];
  /** Clubs that have levels in the target but none matched to a source (Finals-only clubs). */
  clubsWithoutSource: number;
}

const effective = (d: ArtisticDiscipline, athletes: LinkAthlete[], o: LevelOrder) => levelStatus(d, athletes, { ...o, splitDecided: true });

/** An order the club has really set: it differs from A–Z, or the club kept the split. */
export function isOrderSet(d: ArtisticDiscipline, athletes: LinkAthlete[], saved: LevelOrder | undefined): boolean {
  if (!saved) return false;
  return saved.splitDecided || effective(d, athletes, saved) === 'custom';
}

const levelsOf = (sessions: LinkSession[]): { s: LinkSession; l: LinkLevel }[] =>
  sessions.filter((s) => s.discipline !== 'TNT').flatMap((s) => s.levels.map((l) => ({ s, l })));

/** Pair target levels with source levels by discipline + level code; when several share a code, the best athlete overlap wins. */
export function matchLevels(source: LinkSession[], target: LinkSession[]): { src?: { s: LinkSession; l: LinkLevel }; tgt: { s: LinkSession; l: LinkLevel } }[] {
  const srcs = levelsOf(source);
  const used = new Set<string>();
  const out: ReturnType<typeof matchLevels> = [];
  for (const tgt of levelsOf(target)) {
    const ids = new Set(tgt.l.athletes.map((a) => a.id));
    let best: (typeof srcs)[number] | undefined;
    let bestScore = -1;
    for (const c of srcs) {
      if (c.s.discipline !== tgt.s.discipline || c.l.levelCode !== tgt.l.levelCode || used.has(c.l.levelKey)) continue;
      const score = c.l.athletes.filter((a) => ids.has(a.id)).length;
      if (score > bestScore) { best = c; bestScore = score; }
    }
    if (best) used.add(best.l.levelKey);
    out.push({ src: best, tgt });
  }
  return out;
}

export interface BuiltOrder { order: LevelOrder; newcomers: string[]; resplit: boolean }

/**
 * The target level's order built from the source level's saved order. Pure.
 *  - groups: the source groups with absent athletes removed (empty groups dropped); newcomers go to the end of the last group (a new
 *    last group when it has no room), A–Z;
 *  - if the source groups do not fit the cap in the target, the groups are re-split (splitEvenly, source order kept);
 *  - per apparatus: the source order within each group, athletes with no source position (newcomers, a new apparatus) at the end, A–Z;
 *  - `splitDecided` stays as the source had it.
 */
export function buildCopiedOrder(discipline: ArtisticDiscipline, target: LinkAthlete[], saved: LevelOrder): BuiltOrder {
  const cap = sectionCap(discipline);
  const tIds = azIds(target); // A–Z, the default
  const apparatusOf = apparatusLookup(target);
  const inTarget = new Set(tIds);
  const sourceGroups = saved.groups.map((g) => g.filter((id) => inTarget.has(id)));
  // reconcileGroups with only the athletes already placed: it removes absentees and duplicates and adds nobody.
  const placedIds = new Set(sourceGroups.flat());
  const kept = reconcileGroups(sourceGroups, tIds.filter((id) => placedIds.has(id)), cap, apparatusOf).filter((g) => g.length > 0);
  const known = new Set(kept.flat());
  const newcomers = tIds.filter((id) => !known.has(id)); // A–Z

  let groups = kept.map((g) => [...g]);
  let resplit = false;
  if (groupsOverCap(kept, cap, apparatusOf)) {
    groups = splitEvenly([...kept.flat(), ...newcomers], cap, apparatusOf);
    resplit = true;
  } else if (newcomers.length > 0) {
    if (groups.length === 0) groups = splitEvenly(newcomers, cap, apparatusOf);
    else {
      const last = groups.length - 1;
      const extended = [...groups.slice(0, last), [...groups[last], ...newcomers]];
      if (!groupsOverCap(extended, cap, apparatusOf)) groups = extended;
      else groups = [...groups, ...splitEvenly(newcomers, cap, apparatusOf)];
    }
  }

  const rank = new Map(tIds.map((id, i) => [id, i] as const));
  const present = new Set(target.flatMap((a) => a.apparatus));
  const sections: Record<string, string[][]> = {};
  for (const code of APPARATUS[discipline].map((a) => a.code).filter((c) => present.has(c))) {
    const pos = new Map<string, number>();
    (saved.sections[code] ?? []).flat().forEach((id, i) => { if (!pos.has(id)) pos.set(id, i); });
    sections[code] = groups.map((g) =>
      g.filter((id) => apparatusOf(id).includes(code)).sort((a, b) => (pos.get(a) ?? Infinity) - (pos.get(b) ?? Infinity) || rank.get(a)! - rank.get(b)!),
    );
  }
  return { order: { groups, sections, splitDecided: saved.splitDecided }, newcomers, resplit };
}

const nameOf = (a: LinkAthlete) => `${a.first} ${a.last}`.trim();

export function planOrderCopy(clubs: ClubCopyInput[], opts: CopyOptions): CopyPlan {
  const plan: CopyPlan = {
    writes: [], clubs: 0, levels: 0, athletes: 0, skippedSet: 0, replaced: 0, noSource: 0, unplaced: 0, resplit: 0,
    unmatchedSource: [], unmatchedTarget: [], newcomers: [], clubsWithoutSource: 0,
  };
  const srcCodes = new Map<string, LevelRef>();
  const tgtCodes = new Map<string, LevelRef>();
  const refOf = (s: LinkSession, l: LinkLevel): LevelRef => ({ discipline: s.discipline, levelCode: l.levelCode, levelName: l.levelName });
  const key = (r: LevelRef) => `${r.discipline}|${r.levelCode}`;
  const clubsCopied = new Set<string>();

  for (const club of clubs) {
    for (const { s, l } of levelsOf(club.source)) srcCodes.set(key(refOf(s, l)), refOf(s, l));
    for (const { s, l } of levelsOf(club.target)) tgtCodes.set(key(refOf(s, l)), refOf(s, l));
    const pairs = matchLevels(club.source, club.target);
    if (pairs.length > 0 && !pairs.some((p) => p.src)) plan.clubsWithoutSource++;
    for (const { src, tgt } of pairs) {
      const d = tgt.s.discipline as ArtisticDiscipline;
      const saved = src ? club.sourceSaved[src.l.levelKey] : undefined;
      if (!src || !saved || !isOrderSet(d, src.l.athletes, saved)) { plan.noSource++; continue; }
      const targetSaved = club.targetSaved[tgt.l.levelKey];
      const alreadySet = isOrderSet(d, tgt.l.athletes, targetSaved);
      if (alreadySet && !opts.replace) { plan.skippedSet++; continue; }
      const built = buildCopiedOrder(d, tgt.l.athletes, saved);
      // A copy that comes out identical to A–Z (every athlete who was moved is absent) sets nothing: leave the level at the default.
      const result = levelStatus(d, tgt.l.athletes, built.order);
      if (result === 'default' || result === 'none') { plan.noSource++; continue; }
      const byId = new Map(tgt.l.athletes.map((a) => [a.id, a]));
      plan.writes.push({
        clubId: club.clubId, token: club.token, clubName: club.clubName, discipline: d, levelCode: tgt.l.levelCode, levelName: tgt.l.levelName,
        sourceKey: src.l.levelKey, targetKey: tgt.l.levelKey, order: built.order, athletes: tgt.l.athletes.length,
        newcomers: built.newcomers.map((id) => ({ id, name: nameOf(byId.get(id)!) })), resplit: built.resplit, replaces: alreadySet,
      });
      clubsCopied.add(club.clubId);
      plan.levels++;
      plan.athletes += tgt.l.athletes.length;
      if (alreadySet) plan.replaced++;
      if (built.resplit) plan.resplit++;
      if (built.newcomers.length > 0) plan.newcomers.push({ clubName: club.clubName, levelName: tgt.l.levelName, names: built.newcomers.map((id) => nameOf(byId.get(id)!)) });
    }
    // Source orders that were set but have no level to go to.
    const pairedSrc = new Set(pairs.flatMap((p) => (p.src ? [p.src.l.levelKey] : [])));
    for (const { s, l } of levelsOf(club.source)) {
      if (pairedSrc.has(l.levelKey)) continue;
      const saved = club.sourceSaved[l.levelKey];
      if (saved && isOrderSet(s.discipline as ArtisticDiscipline, l.athletes, saved)) plan.unplaced++;
    }
  }
  plan.clubs = clubsCopied.size;
  plan.unmatchedSource = [...srcCodes].filter(([k]) => !tgtCodes.has(k)).map(([, r]) => r);
  plan.unmatchedTarget = [...tgtCodes].filter(([k]) => !srcCodes.has(k)).map(([, r]) => r);
  return plan;
}

/** The wording for a level the confirm screen cannot match: `WAG Silver XS`. */
export const levelRefLabel = (r: LevelRef): string => `${r.discipline} ${r.levelName} (${r.levelCode})`;
