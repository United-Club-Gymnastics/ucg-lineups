import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => {
  const batchOps: unknown[][] = [];
  return {
    batchOps,
    doc: vi.fn((_db: unknown, ...p: string[]) => p.join('/')),
    collection: vi.fn((_db: unknown, ...p: string[]) => `col:${p.join('/')}`),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteField: vi.fn(() => 'DELETE'),
    serverTimestamp: vi.fn(() => 'NOW'),
    writeBatch: vi.fn(() => ({ set: (...a: unknown[]) => { batchOps.push(a); }, commit: vi.fn(async () => {}) })),
  };
});
vi.mock('firebase/firestore', () => fs);

import { createMeet, listMeets, renameMeet, setMeetArchived } from '../../src/lib/data/meet-store';
import { loadAthletes, loadClubs, loadSessions, publishClubLinks, unpublishMeetFromLinks, applyImport } from '../../src/lib/data/store';
import { loadGymOrder, loadSquadDoc, saveSquadDoc } from '../../src/lib/data/squad-store';
import { loadTntDoc, saveTntDoc } from '../../src/lib/data/tnt-store';
import { loadPublicMeet } from '../../src/lib/data/club-store';
import { loadMeetSettings, saveMeetNameDate, saveScheduleOverride, saveScheduleRow } from '../../src/lib/data/export-store';

const db = {} as never;
beforeEach(() => { vi.clearAllMocks(); fs.batchOps.length = 0; });

describe('meet store', () => {
  it('creates meets/{id} and its default settings in one batch', async () => {
    const id = await createMeet(db, '  NE Regionals ', () => 'ne-regionals-ab12');
    expect(id).toBe('ne-regionals-ab12');
    expect(fs.batchOps.map((o) => o[1])).toEqual([
      { name: 'NE Regionals', createdAt: 'NOW', archived: false },
      expect.objectContaining({ meetName: 'NE Regionals', meetDate: '', orderDeadline: null }),
    ]);
    expect(fs.batchOps.map((o) => o[0])).toEqual(['meets/ne-regionals-ab12', 'meets/ne-regionals-ab12/settings/meet']);
  });

  it('refuses a blank name', async () => {
    await expect(createMeet(db, '  ')).rejects.toThrow();
    await expect(renameMeet(db, 'm1', '')).rejects.toThrow();
  });

  it('renames the meet and its settings name only, archives with a merge flag (never deletes)', async () => {
    await renameMeet(db, 'm1', 'Renamed');
    expect(fs.batchOps).toEqual([['meets/m1', { name: 'Renamed' }, { merge: true }], ['meets/m1/settings/meet', { meetName: 'Renamed' }, { merge: true }]]);
    await setMeetArchived(db, 'm1', true);
    expect(fs.setDoc).toHaveBeenCalledWith('meets/m1', { archived: true }, { merge: true });
  });

  it('lists meets newest first', async () => {
    fs.getDocs.mockResolvedValue({ docs: [
      { id: 'a', data: () => ({ name: 'A', createdAt: { toMillis: () => 1 } }) },
      { id: 'b', data: () => ({ name: 'B', createdAt: { toMillis: () => 2 } }) },
    ] });
    expect((await listMeets(db)).map((m) => m.id)).toEqual(['b', 'a']);
    expect(fs.collection).toHaveBeenCalledWith(db, 'meets');
  });
});

describe('data store functions take the meet id', () => {
  it('reads each collection under the meet', async () => {
    fs.getDocs.mockResolvedValue({ docs: [] });
    await loadAthletes(db, 'm2');
    await loadClubs(db, 'm2');
    await loadSessions(db, 'm2');
    expect(fs.collection.mock.calls.map((c) => c[1])).toEqual(['meets/m2/athletes', 'meets/m2/clubs', 'clubTokens', 'meets/m2/sessions']);
  });

  it('reads settings and the gym order from the meet', async () => {
    fs.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ gymOrder: ['Red'], meetName: 'X', schedule: {} }) });
    expect(await loadGymOrder(db, 'm2')).toEqual(['Red']);
    expect((await loadMeetSettings(db, 'm2')).meetName).toBe('X');
    expect(fs.getDoc.mock.calls.map((c) => c[0])).toEqual(['meets/m2/settings/meet', 'meets/m2/settings/meet']);
  });

  it('writes squads and T&T plans under the meet', async () => {
    fs.getDoc.mockResolvedValue({ exists: () => false });
    await loadSquadDoc(db, 'm3', 's1');
    await loadTntDoc(db, 'm3', 's1');
    await saveSquadDoc(db, 'm3', 's1', { squads: [] } as never);
    await saveTntDoc(db, 'm3', 's1', { squads: [] } as never);
    expect(fs.getDoc.mock.calls.map((c) => c[0])).toEqual(['meets/m3/squads/s1', 'meets/m3/squads/s1']);
    expect(fs.setDoc.mock.calls.map((c) => c[0])).toEqual(['meets/m3/squads/s1', 'meets/m3/squads/s1']);
  });

  it('writes the schedule and the name/date under the meet, and keeps the meet name in step', async () => {
    await saveScheduleRow(db, 'm4', 2, { date: '', stretch: '', warmups: '', competition: '1 PM' });
    await saveScheduleOverride(db, 'm4', 's2-red', { date: '', stretch: '', warmups: '', competition: '2 PM' });
    expect(fs.setDoc.mock.calls.map((c) => c[0])).toEqual(['meets/m4/settings/meet', 'meets/m4/sessions/s2-red']);
    await saveMeetNameDate(db, 'm4', { meetName: ' N ', meetDate: ' d ' });
    expect(fs.batchOps).toEqual([['meets/m4/settings/meet', { meetName: 'N', meetDate: 'd' }, { merge: true }], ['meets/m4', { name: 'N' }, { merge: true }]]);
  });

  it('an import writes no token; publishing mints one per club (clubTokens) and merges only this meet into the club\'s one link', async () => {
    fs.getDocs.mockImplementation(async (c: string) => ({
      docs: c.endsWith('/clubs') ? [{ id: 'alpha', data: () => ({ name: 'Alpha', emails: [] }) }] : [],
    }));
    fs.getDoc.mockImplementation(async (p: string) => (p === 'meets/m5' ? { exists: () => true, data: () => ({ name: 'Finals', createdAt: { toMillis: () => 2000 } }) } : { exists: () => false }));
    const n = await publishClubLinks(db, 'm5');
    expect(n).toBe(1);
    const tokenOp = fs.batchOps.find((o) => o[0] === 'clubTokens/alpha')!;
    const token = (tokenOp[1] as { token: string }).token;
    expect(token.length).toBeGreaterThan(15);
    const linkOp = fs.batchOps.find((o) => o[0] === `clubLinks/${token}`)!;
    expect(linkOp[1]).toMatchObject({ clubId: 'alpha', meets: { m5: { meetName: 'Finals', createdAt: 2000 } } });
    expect(Object.keys((linkOp[1] as { meets: object }).meets)).toEqual(['m5']); // only this meet's entry
    expect(linkOp[2]).toEqual({ merge: true }); // a merge: the club's other meets are left alone
    expect(fs.batchOps.indexOf(tokenOp)).toBeLessThan(fs.batchOps.indexOf(linkOp));

    fs.batchOps.length = 0;
    await applyImport(db, 'm5', { athletes: [], clubs: [{ id: 'alpha', name: 'Alpha', emails: [] }], sessions: [{ id: 's1-orange', number: 1, gym: 'Orange', discipline: 'WAG', levelCodes: [] }], warnings: [] }, { athletes: [], clubs: [], hasSettings: false });
    expect(fs.batchOps.map((o) => o[0])).toEqual(['meets/m5/sessions/s1-orange', 'meets/m5/clubs/alpha', 'meets/m5/settings/meet']);
    expect(fs.batchOps[1][1]).toEqual({ name: 'Alpha', emails: [], contacts: [] });
  });

  it('an existing token is reused for another meet, an archived meet publishes nothing, and archiving removes just that meet\'s entry', async () => {
    fs.getDocs.mockImplementation(async (c: string) => ({
      docs: c.endsWith('/clubs') ? [{ id: 'alpha', data: () => ({ name: 'Alpha', emails: [] }) }]
        : c === 'col:clubTokens' ? [{ id: 'alpha', data: () => ({ token: 'ONE' }) }]
        : c === 'col:clubLinks' ? [{ id: 'ONE', data: () => ({ meets: { m5: {}, m6: {} } }) }, { id: 'TWO', data: () => ({ meets: { m6: {} } }) }, { id: 'OLD', data: () => ({ meetId: 'm5' }) }]
        : [],
    }));
    fs.getDoc.mockImplementation(async (p: string) => ({ exists: () => true, data: () => ({ name: p, archived: p === 'meets/m9', createdAt: { toMillis: () => 1 } }) }));
    await publishClubLinks(db, 'm6');
    expect(fs.batchOps.map((o) => o[0])).toEqual(['clubLinks/ONE']);
    fs.batchOps.length = 0;
    expect(await publishClubLinks(db, 'm9')).toBe(0); // archived: not published
    expect(fs.batchOps).toEqual([]);
    expect(await unpublishMeetFromLinks(db, 'm5')).toBe(1); // only ONE lists m5; the old-shape OLD is not touched
    expect(fs.batchOps).toEqual([['clubLinks/ONE', { meets: { m5: 'DELETE' } }, { merge: true }]]);
  });

  it("the club page's public read is the link's meet settings", async () => {
    const t = { toDate: () => new Date('2027-01-02T00:00:00Z') };
    fs.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ orderDeadline: t, meetName: 'Regionals' }) });
    expect(await loadPublicMeet(db, 'm6')).toEqual({ deadline: new Date('2027-01-02T00:00:00Z'), name: 'Regionals' });
    expect(fs.getDoc).toHaveBeenCalledWith('meets/m6/settings/meet');
    fs.getDoc.mockResolvedValue({ exists: () => false });
    expect(await loadPublicMeet(db, 'm6')).toEqual({ deadline: null, name: '' });
  });
});
