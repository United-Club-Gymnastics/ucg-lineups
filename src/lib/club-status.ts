// Pure: the derived per-level / per-session status a club sees (spec §3 "Club status").
import type { Discipline } from './apparatus';
import { azIds, resolveLevel, type ArtisticDiscipline, type LevelOrder } from './club-order-model';
import type { LinkAthlete } from './club-links';

export type LevelStatus = 'split' | 'none' | 'default' | 'custom';
export type SessionStatus = LevelStatus | 'tnt';

export const STATUS_LABEL: Record<SessionStatus, string> = {
  split: 'Needs to decide a split',
  default: 'Still A–Z (default)',
  custom: 'Order set',
  none: 'Nothing to order',
  tnt: 'Set by UCG',
};

const same = (a: string[][], b: string[][]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * split: busiest apparatus is over the cap and the club has not kept or changed the split.
 * none: every apparatus list has at most one athlete.
 * default: groups equal the A-Z even split and every apparatus list is A-Z within its group.
 * custom: anything else.
 */
export function levelStatus(discipline: ArtisticDiscipline, athletes: LinkAthlete[], saved?: LevelOrder): LevelStatus {
  const r = resolveLevel(discipline, athletes, saved);
  if (r.levelBusiest > r.cap && !r.splitDecided) return 'split';
  if (r.levelBusiest <= 1) return 'none';
  if (!same(r.groups, r.defaultGroups)) return 'custom';
  const az = azIds(athletes);
  for (const code of r.codes) {
    const expected = r.groups.map((g) => az.filter((id) => g.includes(id) && r.apparatusOf(id).includes(code)));
    if (!same(r.sectionsBy[code], expected)) return 'custom';
  }
  return 'default';
}

/** split if any level is split, else default if any default, else custom if any custom, else none. T&T: tnt. */
export function sessionStatus(discipline: Discipline, levels: LevelStatus[]): SessionStatus {
  if (discipline === 'TNT') return 'tnt';
  if (levels.includes('split')) return 'split';
  if (levels.includes('default')) return 'default';
  if (levels.includes('custom')) return 'custom';
  return 'none';
}
