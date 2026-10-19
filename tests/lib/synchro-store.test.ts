import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({ setDoc: vi.fn(), doc: vi.fn((_db: unknown, ...p: string[]) => p.join('/')), deleteField: vi.fn(() => 'DELETE'), serverTimestamp: vi.fn(() => 'NOW'), getDoc: vi.fn() }));
vi.mock('firebase/firestore', () => fs);

import { loadSynchroDoc, saveSynchroAssignment, saveSynchroScratch } from '../../src/lib/data/synchro-store';

beforeEach(() => vi.clearAllMocks());

describe('saveSynchroAssignment', () => {
  it('merges just this pair into the map (creating the doc if missing), leaving other pairs alone', async () => {
    await saveSynchroAssignment({} as never, 'm1', 'pair-1', 's2-green');
    expect(fs.setDoc).toHaveBeenCalledWith('meets/m1/synchroSessions/main', { assignments: { 'pair-1': 's2-green' }, updatedAt: 'NOW' }, { merge: true });
  });
  it('clears one pair with deleteField, and an id with dots or slashes stays a plain map key', async () => {
    await saveSynchroAssignment({} as never, 'm1', 'a.b/c', null);
    expect(fs.setDoc).toHaveBeenCalledWith('meets/m1/synchroSessions/main', { assignments: { 'a.b/c': 'DELETE' }, updatedAt: 'NOW' }, { merge: true });
  });
});

describe('saveSynchroScratch', () => {
  it('sets just this pair true with a merge write (creating the doc if missing)', async () => {
    await saveSynchroScratch({} as never, 'm1', 'pair-1', true);
    expect(fs.setDoc).toHaveBeenCalledWith('meets/m1/synchroSessions/main', { scratched: { 'pair-1': true }, updatedAt: 'NOW' }, { merge: true });
  });
  it('restores with deleteField, and an id with dots or slashes stays a plain map key', async () => {
    await saveSynchroScratch({} as never, 'm1', 'a.b/c', false);
    expect(fs.setDoc).toHaveBeenCalledWith('meets/m1/synchroSessions/main', { scratched: { 'a.b/c': 'DELETE' }, updatedAt: 'NOW' }, { merge: true });
  });
  it('never touches assignments', async () => {
    await saveSynchroScratch({} as never, 'm1', 'p', true);
    expect(Object.keys(fs.setDoc.mock.calls[0][1])).not.toContain('assignments');
  });
});

describe('loadSynchroDoc', () => {
  it('reads both maps, and an absent doc is no choices and no scratches', async () => {
    fs.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ assignments: { a: 's1' }, scratched: { b: true, c: false } }) });
    expect(await loadSynchroDoc({} as never, 'm1')).toEqual({ assignments: { a: 's1' }, scratched: { b: true } });
    fs.getDoc.mockResolvedValueOnce({ exists: () => false });
    expect(await loadSynchroDoc({} as never, 'm1')).toEqual({ assignments: {}, scratched: {} });
  });
});
