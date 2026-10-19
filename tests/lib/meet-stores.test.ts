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
import { loadAthletes, loadClubs, loadSessions, publishClubLinks, applyImport } from '../../src/lib/data/store';
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
    expect(fs.collection.mock.calls.map((c) => c[1])).toEqual(['meets/m2/athletes', 'meets/m2/clubs', 'meets/m2/sessions']);
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

  it('an import and the published club links go to one meet, and each link carries its meetId', async () => {
    fs.getDocs.mockImplementation(async (c: string) => ({
      docs: c.endsWith('/clubs') ? [{ id: 'alpha', data: () => ({ name: 'Alpha', emails: [], token: 'TOK' }) }] : [],
    }));
    const n = await publishClubLinks(db, 'm5');
    expect(n).toBe(1);
    expect(fs.batchOps[0][0]).toBe('clubLinks/TOK');
    expect(fs.batchOps[0][1]).toMatchObject({ meetId: 'm5', clubId: 'alpha' });

    fs.batchOps.length = 0;
    await applyImport(db, 'm5', { athletes: [], clubs: [{ id: 'alpha', name: 'Alpha', emails: [] }], sessions: [{ id: 's1-orange', number: 1, gym: 'Orange', discipline: 'WAG', levelCodes: [] }], warnings: [] }, { athletes: [], clubs: [], hasSettings: false });
    expect(fs.batchOps.map((o) => o[0])).toEqual(['meets/m5/sessions/s1-orange', 'meets/m5/clubs/alpha', 'meets/m5/settings/meet']);
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
