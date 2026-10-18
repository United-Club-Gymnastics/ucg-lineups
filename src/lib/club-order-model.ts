// Pure: turn a level's roster + whatever the club saved into the groups and per-apparatus orders
// the club page shows. Default order is A-Z by first name, then last name.
import { APPARATUS } from './apparatus';
import { compareByName, type LinkAthlete } from './club-links';
import {
  apparatusLookup, busiestApparatusCount, reconcileGroups, sectionCap, sectionsFromGroups, splitEvenly,
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
