import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ sessions: [] as { id: string; discipline: string }[], fetch: vi.fn() }));
vi.mock('firebase/firestore', async (orig) => ({
  ...(await orig<typeof import('firebase/firestore')>()),
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
  getDocs: vi.fn(async () => ({ docs: [] })),
}));
vi.mock('../../src/lib/data/squad-store', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/data/squad-store')>()),
  loadSquadsInput: vi.fn(async () => ({ sessions: h.sessions, athletes: [], gymOrder: [], ordersByClub: {} })),
}));
vi.mock('../../src/lib/data/synchro-store', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/data/synchro-store')>()),
  loadSynchroDoc: vi.fn(async () => ({ assignments: {}, scratched: {} })),
}));
vi.mock('../../src/lib/synchro-source', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/synchro-source')>()),
  fetchSynchroPairs: (...a: unknown[]) => h.fetch(...a),
}));

import * as exportStore from '../../src/lib/data/export-store';

describe('Exports and synchro (Julia 2026-10-19: no T&T import → no synchro)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.fetch.mockResolvedValue([{ id: 'p1' }]);
  });

  it('does not read the Synchro tool when the meet has no T&T sessions, and reports no pairs (not "unreadable")', async () => {
    h.sessions = [{ id: 's1-green', discipline: 'WAG' }];
    const out = await exportStore.loadExportsInput({} as never, 'm1');
    expect(h.fetch).not.toHaveBeenCalled();
    expect(out.synchroPairs).toEqual([]);
  });

  it('reads the Synchro tool when there is a T&T session', async () => {
    h.sessions = [{ id: 's1-purple', discipline: 'TNT' }];
    const out = await exportStore.loadExportsInput({} as never, 'm1');
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(out.synchroPairs).toEqual([{ id: 'p1' }]);
  });
});
