import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({ setDoc: vi.fn(), doc: vi.fn((_db: unknown, ...p: string[]) => p.join('/')), deleteField: vi.fn(() => 'DELETE'), serverTimestamp: vi.fn(() => 'NOW'), getDoc: vi.fn() }));
vi.mock('firebase/firestore', () => fs);

import { saveSynchroAssignment } from '../../src/lib/data/synchro-store';

beforeEach(() => vi.clearAllMocks());

describe('saveSynchroAssignment', () => {
  it('merges just this pair into the map (creating the doc if missing), leaving other pairs alone', async () => {
    await saveSynchroAssignment({} as never, 'pair-1', 's2-green');
    expect(fs.setDoc).toHaveBeenCalledWith('synchroSessions/main', { assignments: { 'pair-1': 's2-green' }, updatedAt: 'NOW' }, { merge: true });
  });
  it('clears one pair with deleteField, and an id with dots or slashes stays a plain map key', async () => {
    await saveSynchroAssignment({} as never, 'a.b/c', null);
    expect(fs.setDoc).toHaveBeenCalledWith('synchroSessions/main', { assignments: { 'a.b/c': 'DELETE' }, updatedAt: 'NOW' }, { merge: true });
  });
});
