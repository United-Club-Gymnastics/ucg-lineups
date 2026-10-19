import { beforeEach, describe, expect, it, vi } from 'vitest';

// A tiny in-memory Firestore: paths -> data, plus an ordered log of writes.
const fs = vi.hoisted(() => {
  const data = new Map<string, Record<string, unknown>>();
  const ops: string[] = [];
  const failDelete = { on: false };
  const join = (p: string[]) => p.join('/');
  const colDocs = (col: string) => [...data.entries()].filter(([k]) => k.startsWith(`${col}/`) && !k.slice(col.length + 1).includes('/'))
    .map(([k, v]) => ({ id: k.slice(col.length + 1), data: () => v }));
  let auto = 0;
  // Firestore's set-with-merge merges nested maps (the link's `meets.<id>` entries), not just top-level fields.
  const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && !('toMillis' in (v as object)) && !('ts' in (v as object)) && !('toDate' in (v as object));
  const merge = (a: Record<string, unknown> = {}, b: Record<string, unknown>): Record<string, unknown> => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = isMap(v) && isMap(out[k]) ? merge(out[k] as Record<string, unknown>, v) : v;
    return out;
  };
  return {
    data, ops, failDelete,
    doc: (_db: unknown, ...p: string[]) => join(p),
    collection: (_db: unknown, ...p: string[]) => join(p),
    getDoc: async (path: string) => ({ exists: () => data.has(path), data: () => data.get(path) }),
    getDocs: async (col: string) => ({ docs: colDocs(col) }),
    setDoc: async (path: string, v: Record<string, unknown>, o?: { merge?: boolean }) => { ops.push(`set ${path}`); data.set(path, o?.merge ? merge(data.get(path), v) : v); },
    addDoc: async (col: string, v: Record<string, unknown>) => { ops.push(`add ${col}`); data.set(`${col}/auto${++auto}`, v); },
    deleteDoc: async (path: string) => { ops.push(`delete ${path}`); if (failDelete.on) throw new Error('nope'); data.delete(path); },
    serverTimestamp: () => 'NOW',
    Timestamp: { fromDate: (d: Date) => ({ ts: d.toISOString() }) },
    writeBatch: () => {
      const pending: [string, Record<string, unknown>, { merge?: boolean } | undefined][] = [];
      return { set: (path: string, v: Record<string, unknown>, o?: { merge?: boolean }) => { pending.push([path, v, o]); }, commit: async () => { for (const [p, v, o] of pending) { ops.push(`batch ${p}`); data.set(p, o?.merge ? merge(data.get(p), v) : v); } } };
    },
  };
});
vi.mock('firebase/firestore', () => fs);

import { addEmailLog, loadClubsScreenData, regenerateClubLink, saveClubEmails, saveEmailTemplates, saveOrderDeadline } from '../../src/lib/data/email-store';
import { DEFAULT_TEMPLATES } from '../../src/lib/email-templates';
import { ATHLETES, CLUBS, SESSIONS } from './clubs-fixtures';

const db = {} as never;
const M = 'meets/m1';

function seed() {
  fs.data.clear();
  fs.ops.length = 0;
  fs.failDelete.on = false;
  fs.data.set(`${M}/settings/meet`, { meetName: 'Test Nationals', orderDeadline: { toDate: () => new Date('2027-03-27T06:59:00Z') } });
  for (const a of ATHLETES) fs.data.set(`${M}/athletes/${a.id}`, { ...a });
  for (const s of SESSIONS) fs.data.set(`${M}/sessions/${s.id}`, { ...s });
  for (const c of CLUBS) {
    fs.data.set(`${M}/clubs/${c.id}`, { name: c.name, emails: c.emails });
    fs.data.set(`clubTokens/${c.id}`, { token: c.token });
  }
  // Two meets: m1 (this one) and m2 (an earlier one the club also ordered in). One link for both.
  fs.data.set('meets/m1', { name: 'Finals', createdAt: { toMillis: () => 2000 }, archived: false });
  fs.data.set('meets/m2', { name: 'Prelims', createdAt: { toMillis: () => 1000 }, archived: false });
  fs.data.set('meets/m3', { name: 'Archived one', createdAt: { toMillis: () => 500 }, archived: true });
  fs.data.set('clubLinks/tokAlpha', { clubId: 'alpha-gymnastics', clubName: 'Alpha Gymnastics', meets: { m2: { meetName: 'Prelims', createdAt: 1000, sessions: ['prelims roster'], levelKeys: ['k'] } } });
  fs.data.set('clubOrders/tokAlpha/meets/m1/levels/s1-orange__XS', { groups: [{ ids: ['a', 'b', 'c'] }], sections: {}, splitDecided: true, updatedAt: { toMillis: () => 1000 } });
  fs.data.set('clubOrders/tokAlpha/meets/m1/levels/s2-red__Dev', { groups: [{ ids: ['d'] }], sections: {}, splitDecided: false, updatedAt: { toMillis: () => 2000 } });
  fs.data.set('clubOrders/tokAlpha/meets/m2/levels/s1-orange__XS', { groups: [{ ids: ['p'] }], sections: {}, splitDecided: false, updatedAt: { toMillis: () => 500 } });
  fs.data.set('clubOrders/tokAlpha/meets/m3/levels/s1-orange__XS', { groups: [{ ids: ['z'] }], sections: {}, splitDecided: false, updatedAt: { toMillis: () => 100 } });
}
beforeEach(seed);

const alpha = { ...CLUBS[0] };

describe('Regenerate link', () => {
  it('copies the orders of EVERY meet to the new token BEFORE anything is removed, keeps the other meets in the link, repoints the club, then deletes the old link', async () => {
    const res = await regenerateClubLink(db, 'm1', alpha, () => 'newTok');
    expect(res).toEqual({ token: 'newTok', copied: 4, oldLinkRemoved: true });

    // Orders survive under the new token, identical (including their save time and split decision), for all three meets (archived too).
    for (const [meet, key] of [['m1', 's1-orange__XS'], ['m1', 's2-red__Dev'], ['m2', 's1-orange__XS'], ['m3', 's1-orange__XS']]) {
      expect(fs.data.get(`clubOrders/newTok/meets/${meet}/levels/${key}`)).toEqual(fs.data.get(`clubOrders/tokAlpha/meets/${meet}/levels/${key}`));
    }
    // The new link keeps the old one's other meets (Prelims) and gets this meet's current roster.
    const link = fs.data.get('clubLinks/newTok') as { clubId: string; meets: Record<string, { sessions: unknown[] }> };
    expect(link.clubId).toBe('alpha-gymnastics');
    expect(Object.keys(link.meets).sort()).toEqual(['m1', 'm2']);
    expect(link.meets.m2.sessions).toEqual(['prelims roster']);
    expect(link.meets.m1.sessions.length).toBeGreaterThan(0);
    expect(fs.data.has('clubLinks/tokAlpha')).toBe(false);
    // The club now points at the new token, in ONE place for all meets; the meet's club document has no token.
    expect(fs.data.get('clubTokens/alpha-gymnastics')).toEqual({ token: 'newTok' });
    expect(fs.data.get(`${M}/clubs/alpha-gymnastics`)).toEqual({ name: 'Alpha Gymnastics', emails: ['coach@alpha.example'] });

    const iDeleteLink = fs.ops.indexOf('delete clubLinks/tokAlpha');
    expect(iDeleteLink).toBe(fs.ops.length - 1);
    const iLastOrder = Math.max(...fs.ops.map((o, i) => (o.startsWith('batch clubOrders/newTok/') ? i : -1)));
    expect(iLastOrder).toBeGreaterThan(0);
    expect(iLastOrder).toBeLessThan(fs.ops.indexOf('set clubLinks/newTok'));
    expect(fs.ops.indexOf('set clubLinks/newTok')).toBeLessThan(fs.ops.indexOf('set clubTokens/alpha-gymnastics'));
    expect(fs.ops.indexOf('set clubTokens/alpha-gymnastics')).toBeLessThan(iDeleteLink);
    // The old orders are left where they were (nothing is permanently deleted but the old link).
    expect(fs.data.has('clubOrders/tokAlpha/meets/m2/levels/s1-orange__XS')).toBe(true);
    // Other clubs untouched.
    expect(fs.data.get('clubTokens/bravo-academy')).toEqual({ token: 'tokBravo' });
  });

  it('a failure while copying leaves the old link and the club untouched', async () => {
    const real = fs.getDocs;
    fs.getDocs = async () => { throw new Error('network'); };
    await expect(regenerateClubLink(db, 'm1', alpha, () => 'newTok')).rejects.toThrow('network');
    fs.getDocs = real;
    expect(fs.data.has('clubLinks/tokAlpha')).toBe(true);
    expect(fs.data.get('clubTokens/alpha-gymnastics')).toEqual({ token: 'tokAlpha' });
    expect(fs.ops.filter((o) => o.startsWith('delete'))).toEqual([]);
  });

  it('if only the final delete fails, the new link works and the result says the old one may still open', async () => {
    fs.failDelete.on = true;
    const res = await regenerateClubLink(db, 'm1', alpha, () => 'newTok');
    expect(res).toEqual({ token: 'newTok', copied: 4, oldLinkRemoved: false });
    expect(fs.data.get('clubTokens/alpha-gymnastics')).toEqual({ token: 'newTok' });
  });

  it('refuses to reuse the same token', async () => {
    await expect(regenerateClubLink(db, 'm1', alpha, () => 'tokAlpha')).rejects.toThrow();
    expect(fs.ops).toEqual([]);
  });
});

describe('writes', () => {
  it('saves contact emails with a merge into the club document', async () => {
    await saveClubEmails(db, 'm1', 'delta-gym', ['d@example.org']);
    expect(fs.data.get(`${M}/clubs/delta-gym`)).toEqual({ name: 'Delta Gym', emails: ['d@example.org'] });
  });

  it('saves the deadline as a Timestamp into settings/meet without touching the rest; null clears it', async () => {
    await saveOrderDeadline(db, 'm1', new Date('2027-03-27T06:59:00Z'));
    expect(fs.data.get(`${M}/settings/meet`)).toEqual(expect.objectContaining({ meetName: 'Test Nationals', orderDeadline: { ts: '2027-03-27T06:59:00.000Z' } }));
    await saveOrderDeadline(db, 'm1', null);
    expect(fs.data.get(`${M}/settings/meet`)!.orderDeadline).toBeNull();
  });

  it('saves templates to emailSettings/main and logs sends under emailLog with mode test', async () => {
    await saveEmailTemplates(db, 'm1', DEFAULT_TEMPLATES);
    expect(fs.data.get(`${M}/emailSettings/main`)).toEqual({ templates: DEFAULT_TEMPLATES });
    await addEmailLog(db, 'm1', { template: 'az', clubId: 'alpha-gymnastics', club: 'Alpha Gymnastics', to: 'jzsharpe+alpha-gymnastics@gmail.com', subject: 'S', by: 'admin@unitedclubgymnastics.org' });
    const row = [...fs.data.entries()].find(([k]) => k.startsWith(`${M}/emailLog/`))![1];
    expect(row).toEqual({ template: 'az', clubId: 'alpha-gymnastics', club: 'Alpha Gymnastics', to: 'jzsharpe+alpha-gymnastics@gmail.com', subject: 'S', by: 'admin@unitedclubgymnastics.org', mode: 'test', at: 'NOW' });
  });
});

describe('loading', () => {
  it('reads clubs, each club\'s saved orders with their times, the deadline, templates and the log (newest first)', async () => {
    fs.data.set(`${M}/emailSettings/main`, { templates: { az: { subject: 'Custom', body: 'B' } } });
    fs.data.set(`${M}/emailLog/1`, { template: 'az', club: 'Alpha Gymnastics', clubId: 'alpha-gymnastics', to: 'jzsharpe+alpha-gymnastics@gmail.com', by: 'x', mode: 'test', at: { toDate: () => new Date(1000) } });
    fs.data.set(`${M}/emailLog/2`, { template: 'split', club: 'Bravo Academy', clubId: 'bravo-academy', to: 'jzsharpe+bravo-academy@gmail.com', by: 'x', mode: 'test', at: { toDate: () => new Date(5000) } });
    const d = await loadClubsScreenData(db, 'm1');
    expect(d.clubs.map((c) => c.id).sort()).toEqual(CLUBS.map((c) => c.id).sort());
    expect(d.saved['alpha-gymnastics']['s1-orange__XS'].updatedAt).toBe(1000);
    expect(d.saved['alpha-gymnastics']['s2-red__Dev'].order?.groups).toEqual([['d']]);
    expect(d.deadline?.toISOString()).toBe('2027-03-27T06:59:00.000Z');
    expect(d.meetName).toBe('Test Nationals');
    expect(d.templates.az.subject).toBe('Custom');
    expect(d.templates.split).toEqual(DEFAULT_TEMPLATES.split);
    expect(d.log.map((e) => e.club)).toEqual(['Bravo Academy', 'Alpha Gymnastics']);
  });

  it('a failed read throws instead of showing empty defaults', async () => {
    const real = fs.getDocs;
    fs.getDocs = async () => { throw new Error('offline'); };
    await expect(loadClubsScreenData(db, 'm1')).rejects.toThrow('offline');
    fs.getDocs = real;
  });
});
