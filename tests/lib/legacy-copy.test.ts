import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { planLegacyCopy, sameValue, type LegacySnapshot, type MeetState } from '../../src/lib/legacy-copy';

// Invented data only.
const TA = 'tokenAAAAAAAAAAAAAAAAAA';
const TB = 'tokenBBBBBBBBBBBBBBBBBB';
const deadline = Timestamp.fromMillis(1_800_000_000_000);
const snap = (): LegacySnapshot => ({
  docs: [
    { path: 'settings/meet', data: { meetName: 'Old Nationals', meetDate: '2026-07-01', orderDeadline: deadline, gymOrder: ['Blue', 'Teal'] } },
    { path: 'athletes/WAG_0001', data: { first: 'Ann', last: 'Example', clubId: 'club-a' } },
    { path: 'athletes/WAG_0002', data: { first: 'Bea', last: 'Example', clubId: 'club-b' } },
    { path: 'clubs/club-a', data: { name: 'Club A', token: TA, emails: [] } },
    { path: 'clubs/club-b', data: { name: 'Club B', token: TB, emails: [] } },
    { path: 'sessions/s1', data: { number: 1, gym: 'Blue' } },
    { path: 'squads/s1', data: { squads: [] } },
    { path: 'synchroSessions/main', data: { assignments: { p1: 's1' } } },
    { path: 'emailSettings/main', data: { templates: {} } },
    { path: 'emailLog/x', data: { sent: true } },
  ],
  clubLinks: [
    { id: TA, data: { clubId: 'club-a', levelKeys: [] } },
    { id: TB, data: { clubId: 'club-b', levelKeys: [], meetId: 'other-meet' } },
    { id: 'stray', data: { clubId: 'zzz' } },
  ],
});
const empty: MeetState = new Map();

describe('planLegacyCopy', () => {
  it('copies every meet-specific doc to meets/M/<same path>, data unchanged', () => {
    const s = snap();
    const plan = planLegacyCopy(s, empty, 'm1', 'skip');
    const byPath = new Map(plan.ops.map((o) => [o.path, o]));
    for (const d of s.docs.filter((d) => d.path !== 'settings/meet')) {
      const op = byPath.get(`meets/m1/${d.path}`);
      expect(op?.data).toBe(d.data);
      expect(op?.merge).toBe(false);
    }
    expect(plan.counts.athletes).toEqual({ total: 2, copy: 2, skipped: 0, unchanged: 0 });
    expect(plan.hasConflicts).toBe(false);
  });

  it('merges settings into an empty/default meet, keeping the Timestamp', () => {
    const state: MeetState = new Map([['settings/meet', { meetName: 'UCG Nationals 2026', meetDate: '', orderDeadline: null, gymOrder: ['Blue', 'Teal', 'Red'] }]]);
    const plan = planLegacyCopy(snap(), state, 'm1', 'skip');
    const op = plan.ops.find((o) => o.path === 'meets/m1/settings/meet')!;
    expect(op.merge).toBe(true);
    expect(op.data).toEqual({ meetDate: '2026-07-01', orderDeadline: deadline });
    expect(plan.settings.kept).toEqual(expect.arrayContaining(['meetName', 'gymOrder']));
  });

  it('does not overwrite settings the meet already has, unless replace is chosen (and the meet name stays)', () => {
    const state: MeetState = new Map([['settings/meet', { meetName: 'Mine', meetDate: '2027-01-01', orderDeadline: null }]]);
    const skip = planLegacyCopy(snap(), state, 'm1', 'skip').ops.find((o) => o.path.endsWith('settings/meet'))!;
    expect(skip.data).toEqual({ orderDeadline: deadline, gymOrder: ['Blue', 'Teal'] });
    const rep = planLegacyCopy(snap(), state, 'm1', 'replace').ops.find((o) => o.path.endsWith('settings/meet'))!;
    expect(rep.data).toEqual({ meetDate: '2026-07-01', orderDeadline: deadline, gymOrder: ['Blue', 'Teal'] });
  });

  it('attaches only legacy-club links that have no meetId', () => {
    const plan = planLegacyCopy(snap(), empty, 'm1', 'skip');
    const linkOps = plan.ops.filter((o) => o.path.startsWith('clubLinks/'));
    expect(linkOps).toEqual([{ path: `clubLinks/${TA}`, data: { meetId: 'm1' }, merge: true }]);
    expect(plan.links).toEqual({ total: 3, attach: 1, alreadyHere: 0, other: 2, working: 1 });
  });

  it('never deletes and never touches clubOrders', () => {
    const plan = planLegacyCopy(snap(), empty, 'm1', 'replace');
    expect(plan.ops.every((o) => o.path.startsWith('meets/m1/') || o.path.startsWith('clubLinks/'))).toBe(true);
    expect(plan.ops.some((o) => o.path.includes('clubOrders'))).toBe(false);
  });

  it('reports conflicts; skip leaves existing docs, replace overwrites them', () => {
    const state: MeetState = new Map([
      ['athletes/WAG_0001', { first: 'Changed' }],
      ['clubs/club-a', { name: 'Club A', token: 'different-token', emails: [] }],
    ]);
    const skip = planLegacyCopy(snap(), state, 'm1', 'skip');
    expect(skip.hasConflicts).toBe(true);
    expect(skip.existing).toMatchObject({ athletes: 1, clubs: 1, sessions: 0, squads: 0 });
    expect(skip.counts.athletes).toMatchObject({ copy: 1, skipped: 1 });
    expect(skip.ops.some((o) => o.path === 'meets/m1/athletes/WAG_0001')).toBe(false);
    expect(skip.tokenMismatch).toBe(1);
    const rep = planLegacyCopy(snap(), state, 'm1', 'replace');
    expect(rep.ops.some((o) => o.path === 'meets/m1/athletes/WAG_0001' && o.merge === false)).toBe(true);
    expect(rep.counts.athletes).toMatchObject({ copy: 2, skipped: 0 });
    expect(rep.tokenMismatch).toBe(0);
  });

  it('is idempotent: planning against the result of a run writes nothing (both modes)', () => {
    const s = snap();
    const first = planLegacyCopy(s, empty, 'm1', 'skip');
    const state: MeetState = new Map();
    for (const o of first.ops) {
      if (!o.path.startsWith('meets/m1/')) continue;
      const rel = o.path.slice('meets/m1/'.length);
      state.set(rel, o.merge ? { ...(state.get(rel) ?? {}), ...o.data } : o.data);
    }
    // The links now carry the meetId.
    s.clubLinks[0] = { id: TA, data: { ...s.clubLinks[0].data, meetId: 'm1' } };
    for (const mode of ['skip', 'replace'] as const) {
      const again = planLegacyCopy(s, state, 'm1', mode);
      expect(again.ops).toEqual([]);
      expect(again.nothingToDo).toBe(true);
      expect(again.links.alreadyHere).toBe(1);
    }
  });
});

describe('sameValue', () => {
  it('compares Timestamps, arrays and nested objects by value', () => {
    expect(sameValue(Timestamp.fromMillis(5), Timestamp.fromMillis(5))).toBe(true);
    expect(sameValue(Timestamp.fromMillis(5), Timestamp.fromMillis(6))).toBe(false);
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameValue({ a: [1] }, { a: [1, 2] })).toBe(false);
  });
});
