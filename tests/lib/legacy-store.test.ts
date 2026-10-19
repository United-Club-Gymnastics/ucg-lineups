import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => {
  const state = { pages: [] as { id: string; data: () => unknown }[][], batches: [] as unknown[][][], settings: null as unknown, queried: [] as string[] };
  return {
    state,
    doc: vi.fn((_db: unknown, ...p: string[]) => p.join('/')),
    collection: vi.fn((_db: unknown, ...p: string[]) => p.join('/')),
    query: vi.fn((c: string, ...rest: unknown[]) => ({ c, rest })),
    orderBy: vi.fn(() => 'order'),
    documentId: vi.fn(() => 'id'),
    startAfter: vi.fn((d: unknown) => ({ after: d })),
    limit: vi.fn((n: number) => ({ limit: n })),
    getDoc: vi.fn(async () => ({ exists: () => state.settings !== null, data: () => state.settings })),
    getDocs: vi.fn(async (q: { c: string }) => { state.queried.push(q.c); const docs = state.pages.shift() ?? []; return { docs, empty: docs.length === 0 }; }),
    writeBatch: vi.fn(() => { const ops: unknown[][] = []; state.batches.push(ops); return { set: (...a: unknown[]) => { ops.push(a); }, commit: vi.fn(async () => {}) }; }),
  };
});
vi.mock('firebase/firestore', () => fs);

import { applyLegacyOps, hasLegacyData, loadLegacy } from '../../src/lib/data/legacy-store';

const db = {} as never;
const page = (n: number, prefix = 'a') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, data: () => ({ i }) }));
beforeEach(() => { vi.clearAllMocks(); fs.state.pages = []; fs.state.batches = []; fs.state.settings = null; fs.state.queried = []; });

describe('legacy store', () => {
  it('hasLegacyData checks athletes, clubs and settings/meet with limit(1)', async () => {
    fs.state.pages = [[], []];
    expect(await hasLegacyData(db)).toBe(false);
    expect(fs.limit).toHaveBeenCalledWith(1);
    fs.state.pages = [[], page(1)];
    expect(await hasLegacyData(db)).toBe(true);
    fs.state.pages = [[], []];
    fs.state.settings = { meetName: 'x' };
    expect(await hasLegacyData(db)).toBe(true);
  });

  it('hasLegacyData is false when the read fails', async () => {
    fs.getDocs.mockRejectedValueOnce(new Error('denied'));
    expect(await hasLegacyData(db)).toBe(false);
  });

  it('loadLegacy reads a full page, then asks for the next one', async () => {
    // athletes: 400 then 3; every other collection empty.
    fs.state.pages = [page(400), page(3, 'b')];
    const s = await loadLegacy(db);
    expect(s.docs.filter((d) => d.path.startsWith('athletes/'))).toHaveLength(403);
    expect(fs.startAfter).toHaveBeenCalledTimes(1);
    expect(fs.state.queried.slice(0, 2)).toEqual(['athletes', 'athletes']);
  });

  it('applies writes in batches of at most 450', async () => {
    const ops = Array.from({ length: 1000 }, (_, i) => ({ path: `meets/m/athletes/${i}`, data: { i }, merge: false }));
    const progress: number[] = [];
    expect(await applyLegacyOps(db, ops, (d) => progress.push(d))).toBe(1000);
    expect(fs.state.batches.map((b) => b.length)).toEqual([450, 450, 100]);
    expect(progress).toEqual([450, 900, 1000]);
    expect(fs.state.batches[0][0]).toEqual(['meets/m/athletes/0', { i: 0 }, { merge: false }]);
  });
});
