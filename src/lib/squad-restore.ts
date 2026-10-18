// Pure: bring a saved squad plan up to date with the clubs' current groups and rosters, without silently moving
// anyone. A saved card is a list of athletes, so a club re-splitting its groups can't change who is in a slot.
import { squadCountFor, type ArtisticDiscipline } from './rotation';
import { buildCards, planFromCards, type CardContext, type SquadCard, type SquadPlan } from './squad-balance';
import type { GroupReg, SavedGroupsRow } from './squad-builder';
import type { StoredSquadDoc } from './squad-data';

export type ChangeKind = 'dropped' | 'added' | 'regrouped';

export interface RestoreChange {
  kind: ChangeKind;
  clubLabel: string;
  levelName: string;
  names: string[];
  /** Squad the athletes are in now (regrouped) or were in (dropped). */
  squad?: string;
}

export interface Restored {
  cards: SquadCard[];
  plan: SquadPlan;
  changes: RestoreChange[];
  /** Athletes listed in `changes`. */
  movedCount: number;
}

/** Who a saved card belonged to, read from its key (`<club>::<level>::<group>::<place>` or `indep::<athlete>::<place>`). */
export function cardOwner(key: string): { clubId: string; levelId: string; group: number } | { indep: true } | null {
  const p = key.split('::');
  if (p[0] === 'indep' && p.length >= 3) return { indep: true };
  if (p.length < 4) return null;
  const group = Number(p[p.length - 2]);
  return { clubId: p.slice(0, p.length - 3).join('::'), levelId: p[p.length - 3], group: Number.isNaN(group) ? -1 : group };
}

export function restoreSquads(input: {
  stored: StoredSquadDoc;
  discipline: ArtisticDiscipline;
  sessionRegs: GroupReg[];
  savedGroups: SavedGroupsRow[];
  ctx: CardContext;
  /** Name, club and level of any athlete, for the notice. */
  describe: (id: string) => { name: string; clubName: string; levelName: string } | undefined;
  levelName: (levelId: string) => string;
}): Restored {
  const { stored, discipline, sessionRegs, ctx } = input;
  const regById = new Map(sessionRegs.map((r) => [r.id, r]));
  const squadCount = squadCountFor(stored.pattern, discipline);

  // Where each saved athlete was placed; only those still in the same club and level (and still competing) keep their squad.
  const squadOf = new Map<string, string>();
  const was = new Map<string, { squad: number; group: number }>();
  const dropped: { id: string; squad: number; clubId: string; levelId: string }[] = [];
  const seen = new Set<string>();
  stored.squads.slice(0, squadCount).forEach((sq, i) => {
    for (const card of sq.cards) {
      const owner = cardOwner(card.key);
      for (const id of card.athleteIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        const reg = regById.get(id);
        const same = !!reg && !!owner && ('indep' in owner ? reg.clubId === null : reg.clubId === owner.clubId && reg.levelId === owner.levelId);
        if (!same) {
          dropped.push({ id, squad: i, clubId: owner && !('indep' in owner) ? owner.clubId : '', levelId: owner && !('indep' in owner) ? owner.levelId : '' });
          continue;
        }
        squadOf.set(id, String(i));
        was.set(id, { squad: i, group: owner && !('indep' in owner) ? owner.group : 0 });
      }
    }
  });
  const known = new Set([...seen, ...stored.trayAthleteIds]);

  const cards = buildCards({ discipline, sessionRegs, savedGroups: input.savedGroups, squadOf, clubLabel: ctx.clubLabel, independentLabel: ctx.independentLabel, levelRank: ctx.levelRank });
  const plan = planFromCards(cards, stored.pattern, discipline, ctx);

  // What changed, grouped by club · level · kind so the host can read it.
  const groups = new Map<string, RestoreChange>();
  const note = (kind: ChangeKind, clubLabel: string, levelName: string, name: string, squad?: number) => {
    const k = `${kind}|${clubLabel}|${levelName}|${squad ?? ''}`;
    const g = groups.get(k) ?? { kind, clubLabel, levelName, names: [], squad: squad === undefined ? undefined : plan[squad]?.name };
    g.names.push(name);
    groups.set(k, g);
  };
  for (const d of dropped) {
    const info = input.describe(d.id);
    note('dropped', info?.clubName ?? ctx.clubLabel(d.clubId), info?.levelName ?? input.levelName(d.levelId), info?.name ?? d.id, d.squad);
  }
  for (const r of sessionRegs) {
    if (!known.has(r.id)) {
      const info = input.describe(r.id);
      note('added', info?.clubName ?? '', info?.levelName ?? input.levelName(r.levelId), info?.name ?? r.id);
    }
  }
  const groupOf = new Map<string, number>();
  for (const c of cards) for (const id of c.regIds) groupOf.set(id, c.groupIndex);
  for (const [id, w] of was) {
    const now = groupOf.get(id);
    const reg = regById.get(id)!;
    if (reg.clubId !== null && now !== undefined && now !== w.group) {
      const info = input.describe(id);
      note('regrouped', info?.clubName ?? ctx.clubLabel(reg.clubId), info?.levelName ?? input.levelName(reg.levelId), info?.name ?? id, w.squad);
    }
  }
  const changes = [...groups.values()];
  return { cards, plan, changes, movedCount: changes.reduce((t, c) => t + c.names.length, 0) };
}

