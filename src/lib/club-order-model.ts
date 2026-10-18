// Pure: turn a level's roster + whatever the club saved into the groups and per-apparatus orders
// the club page shows. Default order is A-Z by first name, then last name.
import { APPARATUS } from './apparatus';
import { compareByName, type LinkAthlete } from './club-links';
import {
  apparatusLookup, busiestApparatusCount, computeDropIndex, moveAthleteToGroup, moveInSections, reconcileGroups, sectionCap, sectionsFromGroups, splitEvenly,
  type ApparatusOf,
} from './competition-order';

/** Firestore shape (no nested arrays): `clubOrders/{token}/levels/{levelKey}` minus `updatedAt`. */
export interface StoredLevelOrder {
  groups: { ids: string[] }[];
  sections: Record<string, { ids: string[] }[]>;
  splitDecided: boolean;
}

export interface LevelOrder {
  groups: string[][];
  sections: Record<string, string[][]>;
  splitDecided: boolean;
}

export type ArtisticDiscipline = 'WAG' | 'MAG';

export function toStored(o: LevelOrder): StoredLevelOrder {
  return {
    groups: o.groups.map((ids) => ({ ids })),
    sections: Object.fromEntries(Object.entries(o.sections).map(([code, secs]) => [code, secs.map((ids) => ({ ids }))])),
    splitDecided: o.splitDecided,
  };
}

const idsOf = (xs: unknown): string[][] =>
  Array.isArray(xs) ? xs.map((x) => (Array.isArray((x as { ids?: unknown })?.ids) ? ((x as { ids: unknown[] }).ids.filter((i) => typeof i === 'string') as string[]) : [])) : [];

/** Read a stored document defensively; anything unusable counts as "nothing saved". */
export function fromStored(raw: unknown): LevelOrder | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const d = raw as Record<string, unknown>;
  const groups = idsOf(d.groups);
  const sections: Record<string, string[][]> = {};
  if (d.sections && typeof d.sections === 'object') for (const [k, v] of Object.entries(d.sections)) sections[k] = idsOf(v);
  return { groups, sections, splitDecided: d.splitDecided === true };
}

/** A-Z order of athlete ids (first name, last name, then id as a stable tiebreak). */
export function azIds(athletes: LinkAthlete[]): string[] {
  return [...athletes].sort((a, b) => compareByName(a, b) || a.id.localeCompare(b.id)).map((a) => a.id);
}

export interface ResolvedLevel {
  cap: number;
  groups: string[][];
  /** Apparatus codes in the discipline's order, only those someone is entered on. */
  codes: string[];
  sectionsBy: Record<string, string[][]>;
  apparatusOf: ApparatusOf;
  /** Busiest apparatus across the whole level (what the cap is measured against before any split). */
  levelBusiest: number;
  splitDecided: boolean;
  /** The A-Z default groups for this roster. */
  defaultGroups: string[][];
}

export function resolveLevel(discipline: ArtisticDiscipline, athletes: LinkAthlete[], saved?: LevelOrder): ResolvedLevel {
  const cap = sectionCap(discipline);
  const eligible = azIds(athletes);
  const apparatusOf = apparatusLookup(athletes);
  const defaultGroups = splitEvenly(eligible, cap, apparatusOf);
  const groups = reconcileGroups(saved?.groups, eligible, cap, apparatusOf);
  const present = new Set(athletes.flatMap((a) => a.apparatus));
  const codes = APPARATUS[discipline].map((a) => a.code).filter((c) => present.has(c));
  const sectionsBy: Record<string, string[][]> = {};
  for (const code of codes) {
    const on = eligible.filter((id) => apparatusOf(id).includes(code));
    sectionsBy[code] = sectionsFromGroups(groups, on, saved?.sections[code]);
  }
  return {
    cap, groups, codes, sectionsBy, apparatusOf,
    levelBusiest: busiestApparatusCount(eligible, apparatusOf),
    splitDecided: saved?.splitDecided === true,
    defaultGroups,
  };
}

export interface DropResult {
  groups: string[][];
  sections: Record<string, string[][]>;
  membershipChanged: boolean;
}

/**
 * Apply a drag-drop on apparatus `code`. `target.section` is the group the pointer ended in; `target.overId`
 * is the athlete dropped onto, or null for the group itself (header / empty area: append).
 * Same group: reorder that list only. Other group: the athlete lands exactly there on `code`, and goes FIRST
 * in the new group on every other apparatus (`moveAthleteToGroup` + `sectionsFromGroups`). Returns null when
 * nothing changes. Caps are not enforced here (an over-cap group is flagged, as with the move buttons).
 */
export function dropAthlete(
  groups: string[][],
  sections: Record<string, string[][]>,
  regIdsOn: (code: string) => string[],
  code: string,
  id: string,
  target: { section: number; overId: string | null },
): DropResult | null {
  const secs = sections[code] ?? [];
  const from = secs.findIndex((s) => s.includes(id));
  const to = target.section;
  if (from < 0 || to < 0 || to >= secs.length) return null;
  const at = computeDropIndex(secs, id, to, target.overId ?? '', target.overId === null);
  const moved = moveInSections(secs, id, to, at);
  if (from === to) {
    if (moved[to].join('\u0000') === secs[to].join('\u0000')) return null;
    return { groups, sections: { ...sections, [code]: moved }, membershipChanged: false };
  }
  const nextGroups = moveAthleteToGroup(groups, id, to);
  const next: Record<string, string[][]> = {};
  for (const c of Object.keys(sections)) next[c] = c === code ? moved : sectionsFromGroups(nextGroups, regIdsOn(c), sections[c]);
  return { groups: nextGroups, sections: next, membershipChanged: true };
}
