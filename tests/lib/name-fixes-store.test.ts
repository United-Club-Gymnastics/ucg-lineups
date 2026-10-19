import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => {
  const data: Record<string, Record<string, unknown>[]> = {};
  const docs: Record<string, Record<string, unknown> | undefined> = {};
  return {
    data, docs,
    collection: (_db: unknown, path: string) => path,
    doc: (_db: unknown, ...p: string[]) => p.join('/'),
    getDocs: vi.fn(async (path: string) => ({ docs: (data[path] ?? []).map((d) => ({ id: d.id as string, data: () => d })) })),
    getDoc: vi.fn(async (path: string) => ({ exists: () => docs[path] !== undefined, data: () => docs[path] })),
    setDoc: vi.fn(async (path: string, value: Record<string, unknown>) => { docs[path] = value; }),
    writeBatch: vi.fn(() => { const ops: [string, unknown][] = []; return { set: (p: string, v: unknown) => ops.push([p, v]), commit: async () => { for (const [p, v] of ops) published.push([p, v]); } }; }),
    serverTimestamp: () => 'NOW',
  };
});
const published: [string, unknown][] = [];
vi.mock('firebase/firestore', () => fs);

import { loadAthletesForDisplay, loadAthletes, publishClubLinks, saveNameFixesAndRepublish } from '../../src/lib/data/store';
import { loadNameFixes, saveNameFixes } from '../../src/lib/data/name-fixes-store';

const ATH = (id: string, first: string, last: string, clubId: string) => ({
  id, discipline: 'WAG', first, last, clubId, clubName: clubId, independent: false, levelCode: 'Dev', levelName: 'Dev', sessionId: 's1-green', apparatus: ['VT'], competes: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  published.length = 0;
  for (const k of Object.keys(fs.docs)) delete fs.docs[k];
  fs.data['meets/m1/athletes'] = [ATH('WAG_a', 'Ada', 'MurrayMetzger', 'club-a'), ATH('WAG_b', 'Bea', 'Plain', 'club-b')];
  fs.data['meets/m1/sessions'] = [{ id: 's1-green', number: 1, gym: 'Green', discipline: 'WAG', levelCodes: ['Dev'] }];
  fs.data['meets/m1/clubs'] = [{ id: 'club-a', name: 'Club A', emails: [], token: 'tokA' }, { id: 'club-b', name: 'Club B', emails: [], token: 'tokB' }];
});

describe('name fixes storage', () => {
  it('lives in meets/{id}/nameFixes/main, not in the public settings', async () => {
    await saveNameFixes({} as never, 'm1', [{ field: 'last', from: 'MurrayMetzger', to: 'Murray Metzger' }]);
    expect(fs.setDoc).toHaveBeenCalledWith('meets/m1/nameFixes/main', { fixes: [{ field: 'last', from: 'MurrayMetzger', to: 'Murray Metzger' }], updatedAt: 'NOW' });
    expect(fs.setDoc.mock.calls.every((c) => !String(c[0]).includes('settings'))).toBe(true);
    expect(await loadNameFixes({} as never, 'm1')).toEqual([{ field: 'last', from: 'MurrayMetzger', to: 'Murray Metzger' }]);
    expect(await loadNameFixes({} as never, 'm2')).toEqual([]);
  });
});

describe('where the fixes are applied', () => {
  beforeEach(() => { fs.docs['meets/m1/nameFixes/main'] = { fixes: [{ field: 'last', from: 'MurrayMetzger', to: 'Murray Metzger' }] }; });

  it('loadAthletesForDisplay fixes names but keeps ids; loadAthletes (the import comparison) keeps the export spelling', async () => {
    const shown = await loadAthletesForDisplay({} as never, 'm1');
    expect(shown.map((a) => [a.id, a.last])).toEqual([['WAG_a', 'Murray Metzger'], ['WAG_b', 'Plain']]);
    expect((await loadAthletes({} as never, 'm1'))[0].last).toBe('MurrayMetzger');
  });

  it('the published club roster carries the fixed name, so a re-import (which republishes) keeps it', async () => {
    await publishClubLinks({} as never, 'm1');
    const link = published.find(([p]) => p === 'clubLinks/tokA')![1] as { sessions: { levels: { athletes: { id: string; last: string }[] }[] }[] };
    expect(link.sessions[0].levels[0].athletes).toEqual([expect.objectContaining({ id: 'WAG_a', last: 'Murray Metzger' })]);
  });
});

describe('saveNameFixesAndRepublish', () => {
  it('saves, then republishes only the clubs whose names changed, and reports them', async () => {
    const r = await saveNameFixesAndRepublish({} as never, 'm1', [], [{ field: 'last', from: 'MurrayMetzger', to: 'Murray Metzger' }]);
    expect(r).toEqual({ republished: ['Club A'] });
    expect(fs.docs['meets/m1/nameFixes/main']).toBeDefined();
    expect(published.map(([p]) => p)).toEqual(['clubLinks/tokA']);
  });
  it('a fix that matches nobody republishes nothing', async () => {
    const r = await saveNameFixesAndRepublish({} as never, 'm1', [], [{ field: 'last', from: 'NoSuchName', to: 'No Such Name' }]);
    expect(r.republished).toEqual([]);
    expect(published).toEqual([]);
  });
  it('keeps the saved fixes and says so when republishing fails', async () => {
    fs.writeBatch.mockImplementationOnce(() => ({ set: () => {}, commit: async () => { throw new Error('offline'); } }) as never);
    const r = await saveNameFixesAndRepublish({} as never, 'm1', [], [{ field: 'last', from: 'MurrayMetzger', to: 'Murray Metzger' }]);
    expect(r.publishError).toBe('offline');
    expect(fs.docs['meets/m1/nameFixes/main']).toBeDefined();
  });
});
