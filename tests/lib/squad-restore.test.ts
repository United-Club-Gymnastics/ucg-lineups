import { describe, expect, it } from 'vitest';
import type { LevelOrder } from '../../src/lib/club-order-model';
import type { StoredAthlete } from '../../src/lib/import/diff';
import { planStats } from '../../src/lib/squad-balance';
import { buildSessionData, toStoredSquadDoc, type ArtisticSession } from '../../src/lib/squad-data';
import { cardOwner, restoreSquads } from '../../src/lib/squad-restore';

const session: ArtisticSession = { id: 's1-green', number: 1, gym: 'Green', discipline: 'WAG', levelCodes: ['XS', 'XP'] };
const WAG = ['VT', 'UB', 'BB', 'FX'];
let n = 0;
const ath = (clubId: string, levelCode: string, over: Partial<StoredAthlete> = {}): StoredAthlete => {
  n++;
  return {
    id: `WAG_${clubId}_p${String(n).padStart(2, '0')}`, discipline: 'WAG', first: `P${String(n).padStart(2, '0')}`, last: 'Invented', clubId, clubName: `${clubId} Gym`,
    independent: false, levelCode, levelName: levelCode, sessionId: 's1-green', apparatus: WAG, competes: true, ...over,
  };
};
const some = (k: number, clubId: string, lv: string) => Array.from({ length: k }, () => ath(clubId, lv));
const orderOf = (groups: string[][]): LevelOrder => ({ groups, sections: {}, splitDecided: true });
const ids = (xs: StoredAthlete[]) => xs.map((a) => a.id);

/** Build the screen as it was (clubs split `a` into [first 3 | rest]), place group A in squad 0 and group B in squad 2, save. */
function placed() {
  n = 0;
  const a = some(6, 'a', 'XS');
  const b = some(4, 'b', 'XP');
  const athletes = [...a, ...b];
  const orders = { a: { 's1-green__XS': orderOf([ids(a).slice(0, 3), ids(a).slice(3)]) } };
  const d = buildSessionData(session, athletes, orders);
  const gA = d.cards.find((c) => c.clubId === 'a' && c.groupIndex === 0)!;
  const gB = d.cards.find((c) => c.clubId === 'a' && c.groupIndex === 1)!;
  const bc = d.cards.find((c) => c.clubId === 'b')!;
  const plan = [{ name: 'A', cardKeys: [gA.key, bc.key] }, { name: 'B', cardKeys: [] }, { name: 'C', cardKeys: [gB.key] }, { name: 'D', cardKeys: [] }];
  const stored = toStoredSquadDoc('one', plan, d.cards, { stretch: '', warmups: '', competition: '' });
  return { a, b, athletes, stored };
}

function restore(athletes: StoredAthlete[], orders: Record<string, Record<string, LevelOrder>>, stored: ReturnType<typeof placed>['stored']) {
  const d = buildSessionData(session, athletes, orders);
  const ctx = { discipline: session.discipline, apparatusOf: (id: string) => d.athletes.get(id)?.apparatus ?? [], levelRank: d.levelRank, clubLabel: d.clubLabel, independentLabel: d.independentLabel };
  const r = restoreSquads({ stored, discipline: 'WAG', sessionRegs: d.regs, savedGroups: d.savedGroups, ctx, describe: d.describe, levelName: (l) => l });
  const byKey = new Map(r.cards.map((c) => [c.key, c]));
  const inSquad = (i: number) => r.plan[i].cardKeys.flatMap((k) => byKey.get(k)!.regIds);
  const tray = r.cards.filter((c) => !r.plan.some((s) => s.cardKeys.includes(c.key))).flatMap((c) => c.regIds);
  return { r, d, inSquad, tray };
}

describe('restoreSquads', () => {
  it('unchanged: the same athletes in the same squads, no notice', () => {
    const { a, b, athletes, stored } = placed();
    const orders = { a: { 's1-green__XS': orderOf([ids(a).slice(0, 3), ids(a).slice(3)]) } };
    const { r, inSquad, tray } = restore(athletes, orders, stored);
    expect(r.changes).toEqual([]);
    expect(r.movedCount).toBe(0);
    expect(inSquad(0).sort()).toEqual([...ids(a).slice(0, 3), ...ids(b)].sort());
    expect(inSquad(2).sort()).toEqual(ids(a).slice(3).sort());
    expect(tray).toEqual([]);
  });

  it('a club re-splits its groups after placement: athletes stay in their squads, the change is listed', () => {
    const { a, b, athletes, stored } = placed();
    // new split: [first 2 | next 2 | last 2]; group indexes shift under the placed slots
    const orders = { a: { 's1-green__XS': orderOf([ids(a).slice(0, 2), ids(a).slice(2, 4), ids(a).slice(4)]) } };
    const { r, inSquad, tray } = restore(athletes, orders, stored);
    expect(inSquad(0).sort()).toEqual([...ids(a).slice(0, 3), ...ids(b)].sort());
    expect(inSquad(2).sort()).toEqual(ids(a).slice(3).sort());
    expect(tray).toEqual([]);
    // a1 (index 2) moved group 0 -> 1; a3,a4 (idx 3,4) group 1 -> 1/2; a5 group 1 -> 2
    const regrouped = r.changes.filter((c) => c.kind === 'regrouped');
    expect(regrouped.length).toBeGreaterThan(0);
    expect(regrouped.every((c) => c.clubLabel === 'a Gym' && c.levelName === 'XS')).toBe(true);
    expect(r.changes.some((c) => c.kind === 'dropped' || c.kind === 'added')).toBe(false);
    // the group that now straddles two squads shows as two cards
    expect(r.cards.filter((c) => c.clubId === 'a' && c.groupIndex === 1).map((c) => c.squadId).sort()).toEqual(['0', '2']);
    const stats = planStats(r.plan, new Map(r.cards.map((c) => [c.key, c])), 'WAG', () => 0);
    expect(stats[0].athletes + stats[2].athletes).toBe(10);
  });

  it('an athlete is removed (no longer competing): they drop out and are named', () => {
    const { a, athletes, stored } = placed();
    const gone = a[1];
    const left = athletes.map((x) => (x.id === gone.id ? { ...x, removed: true } : x));
    const orders = { a: { 's1-green__XS': orderOf([ids(a).slice(0, 3).filter((i) => i !== gone.id), ids(a).slice(3)]) } };
    const { r, inSquad } = restore(left, orders, stored);
    expect(inSquad(0)).not.toContain(gone.id);
    expect(r.changes).toEqual([{ kind: 'dropped', clubLabel: 'a Gym', levelName: 'XS', names: [`${gone.first} Invented`], squad: 'A' }]);
    expect(r.movedCount).toBe(1);
  });

  it('an athlete who moved to another level drops out of the slot', () => {
    const { a, athletes, stored } = placed();
    const moved = athletes.map((x) => (x.id === a[5].id ? { ...x, levelCode: 'XP', levelName: 'XP' } : x));
    const { r, inSquad, tray } = restore(moved, { a: { 's1-green__XS': orderOf([ids(a).slice(0, 3), ids(a).slice(3, 5)]) } }, stored);
    expect(inSquad(2)).not.toContain(a[5].id);
    expect(tray).toContain(a[5].id);
    expect(r.changes.filter((c) => c.kind === 'dropped')).toHaveLength(1);
  });

  it('an athlete is added: they go to the tray, not into a squad, and are listed', () => {
    const { a, athletes, stored } = placed();
    const extra = ath('a', 'XS');
    const orders = { a: { 's1-green__XS': orderOf([ids(a).slice(0, 3), [...ids(a).slice(3), extra.id]]) } };
    const { r, inSquad, tray } = restore([...athletes, extra], orders, stored);
    expect(tray).toEqual([extra.id]);
    expect(inSquad(2)).not.toContain(extra.id);
    expect(inSquad(2).sort()).toEqual(ids(a).slice(3).sort());
    expect(r.changes).toEqual([{ kind: 'added', clubLabel: 'a Gym', levelName: 'XS', names: [`${extra.first} Invented`] }]);
    // the rest of their group stays placed, so the group is now two cards (placed + tray)
    expect(r.cards.filter((c) => c.clubId === 'a' && c.groupIndex === 1)).toHaveLength(2);
  });

  it('athletes the host left in the tray on purpose are not reported as new', () => {
    n = 0;
    const x = some(3, 'a', 'XS');
    const y = some(2, 'b', 'XP');
    const d = buildSessionData(session, [...x, ...y], {});
    const only = d.cards.find((c) => c.clubId === 'a')!;
    const stored = toStoredSquadDoc('one', [{ name: 'A', cardKeys: [only.key] }, { name: 'B', cardKeys: [] }, { name: 'C', cardKeys: [] }, { name: 'D', cardKeys: [] }], d.cards, { stretch: '', warmups: '', competition: '' });
    const { r, tray } = restore([...x, ...y], {}, stored);
    expect(r.changes).toEqual([]);
    expect(tray.sort()).toEqual(ids(y).sort());
  });

  it('independents keep their squad', () => {
    n = 0;
    const solo = ath('independent-x', 'XP', { independent: true });
    const d = buildSessionData(session, [solo], {});
    const stored = toStoredSquadDoc('one', [{ name: 'A', cardKeys: [] }, { name: 'B', cardKeys: [d.cards[0].key] }, { name: 'C', cardKeys: [] }, { name: 'D', cardKeys: [] }], d.cards, { stretch: '', warmups: '', competition: '' });
    const { r, inSquad } = restore([solo], {}, stored);
    expect(inSquad(1)).toEqual([solo.id]);
    expect(r.changes).toEqual([]);
  });

  it('cardOwner reads club, level and group from a key', () => {
    expect(cardOwner('north::XS::1::-')).toEqual({ clubId: 'north', levelId: 'XS', group: 1 });
    expect(cardOwner('north::XS::1::3')).toEqual({ clubId: 'north', levelId: 'XS', group: 1 });
    expect(cardOwner('indep::WAG_x::-')).toEqual({ indep: true });
    expect(cardOwner('junk')).toBeNull();
  });
});
