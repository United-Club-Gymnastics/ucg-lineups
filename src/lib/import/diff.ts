import type { Athlete } from './types';

export type StoredAthlete = Athlete & { removed?: boolean };

export interface ImportDiff {
  added: Athlete[];
  changed: { athlete: Athlete; fields: string[] }[];
  /** Ids stored (and not already removed) that the new import no longer contains. */
  removed: string[];
  unchanged: string[];
}

const FIELDS: (keyof Athlete)[] = [
  'discipline', 'bib', 'first', 'last', 'clubId', 'clubName', 'independent', 'levelCode', 'levelName',
  'sessionId', 'apparatus', 'tnt', 'competes',
];

function canon(v: unknown): string {
  if (Array.isArray(v)) return JSON.stringify(v);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  }
  return JSON.stringify(v ?? null);
}

/** Pure comparison of stored athletes with an incoming import. Removed athletes are flagged, never deleted. */
export function diffAthletes(existing: StoredAthlete[], incoming: Athlete[]): ImportDiff {
  const old = new Map(existing.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const diff: ImportDiff = { added: [], changed: [], removed: [], unchanged: [] };
  for (const a of incoming) {
    seen.add(a.id);
    const prev = old.get(a.id);
    if (!prev) {
      diff.added.push(a);
      continue;
    }
    const fields: string[] = FIELDS.filter((f) => canon(prev[f]) !== canon(a[f]));
    if (prev.removed) fields.push('removed');
    if (fields.length) diff.changed.push({ athlete: a, fields });
    else diff.unchanged.push(a.id);
  }
  for (const a of existing) {
    if (!seen.has(a.id) && !a.removed) diff.removed.push(a.id);
  }
  return diff;
}
