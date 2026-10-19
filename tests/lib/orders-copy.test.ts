import { describe, expect, it } from 'vitest';
import type { LinkAthlete, LinkSession } from '../../src/lib/club-links';
import { buildClubRows } from '../../src/lib/club-overview';
import type { LevelOrder } from '../../src/lib/club-order-model';
import { levelStatus } from '../../src/lib/club-status';
import { buildCopiedOrder, isOrderSet, matchLevels, planOrderCopy, type ClubCopyInput } from '../../src/lib/orders-copy';

const WAG = ['VT', 'UB', 'BB', 'FX'];
const MAG = ['FX', 'PH', 'SR', 'VT', 'PB', 'HB'];
const NAMES = ['Ava', 'Bea', 'Cy', 'Dee', 'Eve', 'Fay', 'Gia', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lou', 'Mia', 'Nat', 'Oz', 'Pia', 'Quin', 'Rue'];
const ath = (disc: string, first: string, apparatus = disc === 'WAG' ? WAG : MAG): LinkAthlete => ({ id: `${disc}_club-a_${first.toLowerCase()}`, first, last: 'Test', apparatus });
const ids = (disc: string, firsts: string[]) => firsts.map((f) => `${disc}_club-a_${f.toLowerCase()}`);

function level(sessionId: string, disc: 'WAG' | 'MAG', code: string, name: string, athletes: LinkAthlete[]) {
  return { levelCode: code, levelName: name, levelKey: `${sessionId}__${code}`, athletes };
}
function session(sessionId: string, disc: 'WAG' | 'MAG', levels: ReturnType<typeof level>[]): LinkSession {
  return { sessionId, label: sessionId, discipline: disc, name: sessionId, location: 'X', gym: 'X', levels };
}
const order = (groups: string[][], sections: Record<string, string[][]> = {}, splitDecided = false): LevelOrder => ({ groups, sections, splitDecided });
const reversed = (firsts: string[], disc = 'WAG') => ids(disc, [...firsts].reverse());

/** A WAG XP level of 6 athletes in Prelims; reversed order set by the club. */
const SIX = NAMES.slice(0, 6);
const prelimsRoster = (firsts = SIX) => [session('prelims-s1', 'WAG', [level('prelims-s1', 'WAG', 'XP', 'Platinum XP', firsts.map((f) => ath('WAG', f)))])];
const finalsRoster = (firsts = SIX) => [session('finals-s9', 'WAG', [level('finals-s9', 'WAG', 'XP', 'Platinum XP', firsts.map((f) => ath('WAG', f)))])];
const customSix = order([reversed(SIX)], Object.fromEntries(WAG.map((c) => [c, [reversed(SIX)]])));

function club(over: Partial<ClubCopyInput> = {}): ClubCopyInput {
  return {
    clubId: 'club-a', token: 'tokA', clubName: 'Club A',
    source: prelimsRoster(), target: finalsRoster(),
    sourceSaved: { 'prelims-s1__XP': customSix }, targetSaved: {},
    ...over,
  };
}

describe('matching levels by level code within the discipline', () => {
  it('pairs different session ids by level code and discipline', () => {
    const pairs = matchLevels(prelimsRoster(), finalsRoster());
    expect(pairs).toHaveLength(1);
    expect(pairs[0].src?.l.levelKey).toBe('prelims-s1__XP');
    expect(pairs[0].tgt.l.levelKey).toBe('finals-s9__XP');
  });

  it('does not match the same code across disciplines (MAG Dev is not WAG Dev)', () => {
    const src = [session('p', 'WAG', [level('p', 'WAG', 'Dev', 'Developmental', [ath('WAG', 'Ava')])])];
    const tgt = [session('f', 'MAG', [level('f', 'MAG', 'Dev', 'Developmental', [ath('MAG', 'Ava')])])];
    expect(matchLevels(src, tgt)[0].src).toBeUndefined();
  });

  it('when a code is split across two sessions, the source level with the most athletes in common wins', () => {
    const src = [
      session('p1', 'WAG', [level('p1', 'WAG', 'XP', 'XP', ['Ava', 'Bea'].map((f) => ath('WAG', f)))]),
      session('p2', 'WAG', [level('p2', 'WAG', 'XP', 'XP', ['Cy', 'Dee'].map((f) => ath('WAG', f)))]),
    ];
    const tgt = [session('f1', 'WAG', [level('f1', 'WAG', 'XP', 'XP', ['Cy', 'Dee'].map((f) => ath('WAG', f)))])];
    expect(matchLevels(src, tgt)[0].src?.l.levelKey).toBe('p2__XP');
  });
});

describe('building the copied order', () => {
  it('keeps the groups and the per-apparatus order of the source for the athletes still present', () => {
    const src = order([ids('WAG', ['Ava', 'Bea', 'Cy']), ids('WAG', ['Dee', 'Eve', 'Fay'])], {
      VT: [ids('WAG', ['Cy', 'Ava', 'Bea']), ids('WAG', ['Fay', 'Dee', 'Eve'])],
      UB: [ids('WAG', ['Bea', 'Cy', 'Ava']), ids('WAG', ['Eve', 'Fay', 'Dee'])],
    }, true);
    // Bea and Fay did not make Finals.
    const target = ['Ava', 'Cy', 'Dee', 'Eve'].map((f) => ath('WAG', f));
    const out = buildCopiedOrder('WAG', target, src);
    expect(out.order.groups).toEqual([ids('WAG', ['Ava', 'Cy']), ids('WAG', ['Dee', 'Eve'])]);
    expect(out.order.sections.VT).toEqual([ids('WAG', ['Cy', 'Ava']), ids('WAG', ['Dee', 'Eve'])]);
    expect(out.order.sections.UB).toEqual([ids('WAG', ['Cy', 'Ava']), ids('WAG', ['Eve', 'Dee'])]);
    expect(out.order.splitDecided).toBe(true); // as the source had it
    expect(out.newcomers).toEqual([]);
    expect(out.resplit).toBe(false);
  });

  it('drops a group whose athletes are all gone', () => {
    const src = order([ids('WAG', ['Ava', 'Bea']), ids('WAG', ['Cy'])], { VT: [ids('WAG', ['Bea', 'Ava']), ids('WAG', ['Cy'])] });
    const out = buildCopiedOrder('WAG', ['Ava', 'Bea'].map((f) => ath('WAG', f)), src);
    expect(out.order.groups).toEqual([ids('WAG', ['Ava', 'Bea'])]);
    expect(out.order.sections.VT).toEqual([ids('WAG', ['Bea', 'Ava'])]);
  });

  it('puts someone new at the END (last group, every apparatus), A–Z, and lists them', () => {
    const src = order([ids('WAG', ['Dee', 'Cy']), ids('WAG', ['Bea'])], { VT: [ids('WAG', ['Dee', 'Cy']), ids('WAG', ['Bea'])] });
    const target = ['Ava', 'Bea', 'Cy', 'Dee', 'Zed'].map((f) => ath('WAG', f));
    const out = buildCopiedOrder('WAG', target, src);
    expect(out.newcomers).toEqual(ids('WAG', ['Ava', 'Zed'])); // A–Z
    expect(out.order.groups).toEqual([ids('WAG', ['Dee', 'Cy']), ids('WAG', ['Bea', 'Ava', 'Zed'])]);
    expect(out.order.sections.VT).toEqual([ids('WAG', ['Dee', 'Cy']), ids('WAG', ['Bea', 'Ava', 'Zed'])]);
    expect(out.order.sections.FX[1]).toEqual(ids('WAG', ['Ava', 'Bea', 'Zed'])); // an apparatus the source never ordered: A–Z within the group
  });

  it('an athlete not on an apparatus in the source, but present, goes to the end of that apparatus only', () => {
    const src = order([ids('WAG', ['Ava', 'Bea'])], { VT: [ids('WAG', ['Bea', 'Ava'])], UB: [ids('WAG', ['Bea'])] });
    const target = [ath('WAG', 'Ava'), ath('WAG', 'Bea')];
    const out = buildCopiedOrder('WAG', target, src);
    expect(out.order.sections.UB).toEqual([ids('WAG', ['Bea', 'Ava'])]);
    expect(out.newcomers).toEqual([]);
  });

  it('keeps the source groups when they fit the cap, even if the target level is bigger overall', () => {
    const firsts = NAMES.slice(0, 14); // 14 > 12: two groups of 7 fit
    const groups = [ids('WAG', firsts.slice(0, 7)), ids('WAG', firsts.slice(7))];
    const src = order(groups, Object.fromEntries(WAG.map((c) => [c, groups])), true);
    const out = buildCopiedOrder('WAG', firsts.map((f) => ath('WAG', f)), src);
    expect(out.order.groups).toEqual(groups);
    expect(out.resplit).toBe(false);
    expect(out.order.splitDecided).toBe(true);
  });

  it('re-splits when the source groups do not fit the cap in the target, and leaves splitDecided as the source had it', () => {
    // Source: one group of 8 on VT only. Target: the same 8 are now on all apparatus, but a 5 more joined the group via a bigger level.
    const firsts = NAMES.slice(0, 14);
    const src = order([ids('WAG', firsts)], { VT: [ids('WAG', firsts)] }, false); // one group of 14: over the cap of 12 in the target
    const out = buildCopiedOrder('WAG', firsts.map((f) => ath('WAG', f)), src);
    expect(out.resplit).toBe(true);
    expect(out.order.groups.length).toBeGreaterThan(1);
    expect(out.order.groups.every((g) => g.length <= 12)).toBe(true);
    expect(out.order.groups.flat()).toEqual(expect.arrayContaining(ids('WAG', firsts)));
    expect(out.order.splitDecided).toBe(false);
  });

  it('new arrivals that do not fit the last group start a new last group instead of overfilling it', () => {
    const firsts = NAMES.slice(0, 12);
    const src = order([ids('WAG', firsts)], { VT: [ids('WAG', firsts)] }, true);
    const target = [...firsts, 'Zed'].map((f) => ath('WAG', f));
    const out = buildCopiedOrder('WAG', target, src);
    expect(out.order.groups).toEqual([ids('WAG', firsts), ids('WAG', ['Zed'])]);
    expect(out.resplit).toBe(false);
  });
});

describe('planning the copy for every club', () => {
  it('copies per level, counts clubs / levels / athletes, and the copied order is "Order set" (custom), not default', () => {
    const plan = planOrderCopy([club()], { replace: false });
    expect(plan).toMatchObject({ clubs: 1, levels: 1, athletes: 6, skippedSet: 0, replaced: 0, noSource: 0 });
    const w = plan.writes[0];
    expect(w).toMatchObject({ clubId: 'club-a', token: 'tokA', sourceKey: 'prelims-s1__XP', targetKey: 'finals-s9__XP' });
    expect(w.order.groups).toEqual([reversed(SIX)]);
    const target = finalsRoster()[0].levels[0].athletes;
    expect(levelStatus('WAG', target, w.order)).toBe('custom');
    expect(levelStatus('WAG', target, undefined)).toBe('default'); // before the copy: A–Z, which gets the reminder
  });

  it('after a copy the Clubs table shows "Order set" for copied levels and "Still A–Z" for the rest', () => {
    const c2: ClubCopyInput = club({ clubId: 'club-b', clubName: 'Club B', token: 'tokB', sourceSaved: {} }); // never set a Prelims order
    const plan = planOrderCopy([club(), c2], { replace: false });
    expect(plan.clubs).toBe(1);
    expect(plan.noSource).toBe(1);
    const sessions = [{ id: 'finals-s9', name: 'Finals 1', location: 'X', gym: 'X', discipline: 'WAG' as const, levelCodes: ['XP'] }];
    const mk = (clubId: string) => SIX.map((f) => ({
      id: `WAG_${clubId}_${f.toLowerCase()}`, first: f, last: 'Test', clubId, independent: false, levelCode: 'XP', levelName: 'Platinum XP', sessionId: 'finals-s9', apparatus: WAG, competes: true,
    }));
    const saved = { 'club-a': Object.fromEntries(plan.writes.map((w) => [w.targetKey, { order: w.order, updatedAt: 1 }])) };
    // The planner works on ids from the LinkAthlete roster; for the table use athletes whose ids match.
    const athletesA = finalsRoster()[0].levels[0].athletes.map((a) => ({ id: a.id, first: a.first, last: a.last, clubId: 'club-a', independent: false, levelCode: 'XP', levelName: 'Platinum XP', sessionId: 'finals-s9', apparatus: a.apparatus, competes: true }));
    const rows = buildClubRows([...athletesA, ...mk('club-b')], sessions, [{ id: 'club-a', name: 'Club A', emails: [], token: 'tokA' }, { id: 'club-b', name: 'Club B', emails: [], token: 'tokB' }], saved);
    expect(rows.find((r) => r.id === 'club-a')!.sessions[0].status).toBe('custom'); // Order set
    expect(rows.find((r) => r.id === 'club-b')!.sessions[0].status).toBe('default'); // still reminded
  });

  it('a source left at A–Z, or a level with nothing saved, stays default (no copy)', () => {
    const azSix = order([ids('WAG', SIX)], Object.fromEntries(WAG.map((c) => [c, [ids('WAG', SIX)]])));
    expect(isOrderSet('WAG', prelimsRoster()[0].levels[0].athletes, azSix)).toBe(false);
    const plan = planOrderCopy([club({ sourceSaved: { 'prelims-s1__XP': azSix } }), club({ clubId: 'club-c', sourceSaved: {} })], { replace: false });
    expect(plan.writes).toEqual([]);
    expect(plan.noSource).toBe(2);
    expect(plan.clubs).toBe(0);
  });

  it('never overwrites an order the club already saved in the target, unless asked; counts both', () => {
    const mine = order([ids('WAG', ['Cy', 'Ava', 'Bea', 'Dee', 'Eve', 'Fay'])], Object.fromEntries(WAG.map((c) => [c, [ids('WAG', ['Cy', 'Ava', 'Bea', 'Dee', 'Eve', 'Fay'])]])));
    const c = club({ targetSaved: { 'finals-s9__XP': mine } });
    const skip = planOrderCopy([c], { replace: false });
    expect(skip).toMatchObject({ levels: 0, skippedSet: 1, replaced: 0 });
    const rep = planOrderCopy([c], { replace: true });
    expect(rep).toMatchObject({ levels: 1, skippedSet: 0, replaced: 1 });
    expect(rep.writes[0].replaces).toBe(true);
    expect(rep.writes[0].order.groups).toEqual([reversed(SIX)]);
  });

  it('an untouched saved doc in the target (A–Z, no decision) does not count as set', () => {
    const az = order([ids('WAG', SIX)], Object.fromEntries(WAG.map((c) => [c, [ids('WAG', SIX)]])));
    expect(planOrderCopy([club({ targetSaved: { 'finals-s9__XP': az } })], { replace: false })).toMatchObject({ levels: 1, skippedSet: 0, replaced: 0 });
  });

  it('lists levels that exist in only one meet, and counts source orders with nowhere to go', () => {
    const src = [
      session('p', 'WAG', [level('p', 'WAG', 'XP', 'Platinum XP', SIX.map((f) => ath('WAG', f))), level('p', 'WAG', 'XS', 'Silver XS', ['Ann', 'Ben'].map((f) => ath('WAG', f)))]),
      session('pm', 'MAG', [level('pm', 'MAG', 'Dev', 'Developmental', ['Max', 'Moe'].map((f) => ath('MAG', f)))]),
    ];
    const tgt = [
      session('f', 'WAG', [level('f', 'WAG', 'XP', 'Platinum XP', SIX.map((f) => ath('WAG', f))), level('f', 'WAG', 'L9', 'Level 9', ['Zoe', 'Zed'].map((f) => ath('WAG', f)))]),
    ];
    const xsOrder = order([ids('WAG', ['Ben', 'Ann'])], { VT: [ids('WAG', ['Ben', 'Ann'])] });
    const plan = planOrderCopy([club({ source: src, target: tgt, sourceSaved: { 'p__XP': customSix, 'p__XS': xsOrder } })], { replace: false });
    expect(plan.levels).toBe(1);
    expect(plan.unmatchedSource.map((r) => `${r.discipline} ${r.levelCode}`).sort()).toEqual(['MAG Dev', 'WAG XS']);
    expect(plan.unmatchedTarget.map((r) => `${r.discipline} ${r.levelCode}`)).toEqual(['WAG L9']);
    expect(plan.unplaced).toBe(1); // the XS order has no XS level in Finals
  });

  it('lists newcomers and the levels that were re-split', () => {
    const tgt = finalsRoster([...SIX, 'Zed']);
    const plan = planOrderCopy([club({ target: tgt })], { replace: false });
    expect(plan.newcomers).toEqual([{ clubName: 'Club A', levelName: 'Platinum XP', names: ['Zed Test'] }]);
    expect(plan.writes[0].order.groups[0].at(-1)).toBe('WAG_club-a_zed');
    expect(plan.athletes).toBe(7);
  });

  it('a copy that comes out identical to A–Z is not written', () => {
    // The only athlete the club moved is not in Finals: what is left is A–Z.
    const c = club({
      source: [session('p', 'WAG', [level('p', 'WAG', 'XP', 'XP', ['Ava', 'Bea', 'Cy', 'Zed'].map((f) => ath('WAG', f)))])],
      target: [session('f', 'WAG', [level('f', 'WAG', 'XP', 'XP', ['Ava', 'Bea', 'Cy'].map((f) => ath('WAG', f)))])],
      sourceSaved: { p__XP: order([ids('WAG', ['Zed', 'Ava', 'Bea', 'Cy'])], Object.fromEntries(WAG.map((x) => [x, [ids('WAG', ['Zed', 'Ava', 'Bea', 'Cy'])]]))) },
    });
    expect(planOrderCopy([c], { replace: false })).toMatchObject({ levels: 0, noSource: 1 });
  });

  it('handles MAG and WAG in the same club independently', () => {
    const mag = ['Ava', 'Bea', 'Cy'].map((f) => ath('MAG', f));
    const c = club({
      source: [...prelimsRoster(), session('pm', 'MAG', [level('pm', 'MAG', 'Dev', 'Dev', mag)])],
      target: [...finalsRoster(), session('fm', 'MAG', [level('fm', 'MAG', 'Dev', 'Dev', mag)])],
      sourceSaved: { 'prelims-s1__XP': customSix, pm__Dev: order([ids('MAG', ['Cy', 'Bea', 'Ava'])], { FX: [ids('MAG', ['Cy', 'Bea', 'Ava'])] }) },
    });
    const plan = planOrderCopy([c], { replace: false });
    expect(plan.writes.map((w) => `${w.discipline} ${w.levelCode}`).sort()).toEqual(['MAG Dev', 'WAG XP']);
    expect(plan.clubs).toBe(1);
  });
});
