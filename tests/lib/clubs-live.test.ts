import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A mocked listener API: onSnapshot registers a listener by path; the test pushes snapshots and errors by hand.
const fs = vi.hoisted(() => {
  type Listener = { path: string; next: (s: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void; error: (e: Error) => void; off: ReturnType<typeof vi.fn> };
  const listeners: Listener[] = [];
  return {
    listeners,
    collection: (_db: unknown, ...p: string[]) => p.join('/'),
    onSnapshot: (path: string, next: Listener['next'], error: Listener['error']) => {
      const off = vi.fn();
      listeners.push({ path, next, error, off });
      return off;
    },
    // not used by watchClubsLive, but the module imports them
    addDoc: vi.fn(), deleteDoc: vi.fn(), doc: (_db: unknown, ...p: string[]) => p.join('/'), getDoc: vi.fn(), getDocs: vi.fn(), serverTimestamp: vi.fn(), setDoc: vi.fn(), Timestamp: {}, writeBatch: vi.fn(),
  };
});
vi.mock('firebase/firestore', () => fs);

import { watchClubsLive } from '../../src/lib/data/email-store';

const docs = (rows: Record<string, Record<string, unknown>>) => ({ docs: Object.entries(rows).map(([id, d]) => ({ id, data: () => d })) });
const at = (path: string) => fs.listeners.filter((l) => l.path === path && !l.off.mock.calls.length);
const push = (path: string, rows: Record<string, Record<string, unknown>>) => at(path).forEach((l) => l.next(docs(rows)));
// The name fixes document is a single-document listener: `null` = the document does not exist yet.
const pushFixes = (data: Record<string, unknown> | null) => at('meets/m1/nameFixes/main').forEach((l) => (l.next as unknown as (s: unknown) => void)({ exists: () => data !== null, data: () => data }));

const CLUBS = { 'club-a': { name: 'Club A', emails: [], token: 'tok-a' }, 'club-b': { name: 'Club B', emails: [], token: 'tok-b' } };
const LEVEL = (updatedAt: number) => ({ order: [], updatedAt: { toMillis: () => updatedAt } });

beforeEach(() => { fs.listeners.length = 0; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('watchClubsLive', () => {
  it('listens to the meet collections and one levels collection per club token, and reports nothing until all have answered', () => {
    const onChange = vi.fn();
    watchClubsLive({} as never, 'm1', { onChange, onError: vi.fn() });
    expect(fs.listeners.map((l) => l.path).sort()).toEqual(['meets/m1/athletes', 'meets/m1/clubs', 'meets/m1/nameFixes/main', 'meets/m1/sessions']);
    push('meets/m1/sessions', {});
    push('meets/m1/athletes', {});
    pushFixes(null);
    push('meets/m1/clubs', CLUBS);
    expect(fs.listeners.map((l) => l.path)).toContain('clubOrders/tok-a/levels');
    expect(fs.listeners.map((l) => l.path)).toContain('clubOrders/tok-b/levels');
    expect(onChange).not.toHaveBeenCalled();
    push('clubOrders/tok-a/levels', {});
    expect(onChange).not.toHaveBeenCalled();
    push('clubOrders/tok-b/levels', { 'wag-xs': LEVEL(5) });
    expect(onChange).toHaveBeenCalledTimes(1);
    const live = onChange.mock.calls[0][0];
    expect(live.clubs.map((c: { id: string }) => c.id)).toEqual(['club-a', 'club-b']);
    expect(live.saved['club-b']['wag-xs'].updatedAt).toBe(5);
    expect(live.saved['club-a']).toEqual({});
  });

  function started(debounceMs = 300) {
    const onChange = vi.fn();
    const onError = vi.fn();
    const stop = watchClubsLive({} as never, 'm1', { onChange, onError }, debounceMs);
    push('meets/m1/sessions', {});
    push('meets/m1/athletes', {});
    pushFixes(null);
    push('meets/m1/clubs', CLUBS);
    push('clubOrders/tok-a/levels', {});
    push('clubOrders/tok-b/levels', {});
    onChange.mockClear();
    return { onChange, onError, stop };
  }

  it('debounces a burst of changes into one recomputation', () => {
    const { onChange } = started();
    push('clubOrders/tok-a/levels', { x: LEVEL(1) });
    vi.advanceTimersByTime(200);
    push('clubOrders/tok-a/levels', { x: LEVEL(2) });
    push('clubOrders/tok-b/levels', { y: LEVEL(3) });
    vi.advanceTimersByTime(299);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].saved['club-a'].x.updatedAt).toBe(2);
    expect(onChange.mock.calls[0][0].saved['club-b'].y.updatedAt).toBe(3);
  });

  it('adds a listener for a new token and drops the listener of a token that went away', () => {
    const { onChange } = started();
    const oldA = fs.listeners.find((l) => l.path === 'clubOrders/tok-a/levels')!;
    push('meets/m1/clubs', { 'club-a': { ...CLUBS['club-a'], token: 'tok-a2' }, 'club-b': CLUBS['club-b'] });
    expect(oldA.off).toHaveBeenCalledTimes(1);
    expect(at('clubOrders/tok-a/levels')).toHaveLength(0);
    expect(at('clubOrders/tok-a2/levels')).toHaveLength(1);
    expect(at('clubOrders/tok-b/levels')).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled(); // held until the new token's first snapshot
    push('clubOrders/tok-a2/levels', {});
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('stops every listener and any pending recomputation when cleaned up', () => {
    const { onChange, stop } = started();
    push('clubOrders/tok-a/levels', { x: LEVEL(1) });
    stop();
    expect(fs.listeners.every((l) => l.off.mock.calls.length === 1)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports a failing listener once and stops the rest', () => {
    const { onError, onChange, stop } = started();
    fs.listeners.find((l) => l.path === 'clubOrders/tok-b/levels')!.error(new Error('Missing or insufficient permissions.'));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toMatch(/permissions/);
    expect(fs.listeners.every((l) => l.off.mock.calls.length >= 1)).toBe(true);
    fs.listeners[0].error(new Error('again'));
    expect(onError).toHaveBeenCalledTimes(1);
    push('clubOrders/tok-a/levels', { x: LEVEL(9) });
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
    stop();
  });

  it('shows athletes with the meet\'s name fixes applied, and waits for the fixes before reporting', () => {
    const onChange = vi.fn();
    watchClubsLive({} as never, 'm1', { onChange, onError: vi.fn() });
    push('meets/m1/sessions', {});
    push('meets/m1/athletes', { WAG_a: { first: 'Ada', last: 'MurrayMetzger', clubId: 'club-a' } });
    push('meets/m1/clubs', CLUBS);
    push('clubOrders/tok-a/levels', {});
    push('clubOrders/tok-b/levels', {});
    expect(onChange).not.toHaveBeenCalled();
    pushFixes({ fixes: [{ field: 'last', from: 'MurrayMetzger', to: 'Murray Metzger' }] });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].athletes).toEqual([{ id: 'WAG_a', first: 'Ada', last: 'Murray Metzger', clubId: 'club-a' }]);
    // Removing the fix shows the export's spelling again.
    pushFixes(null);
    vi.advanceTimersByTime(300);
    expect(onChange.mock.calls[1][0].athletes[0].last).toBe('MurrayMetzger');
  });
});
