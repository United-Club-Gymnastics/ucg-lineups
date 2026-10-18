import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autosaver, type SaveState } from '../../src/lib/autosave';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('Autosaver', () => {
  it('debounces: only the last value per key is written, 600 ms after the last change', async () => {
    const write = vi.fn(async () => {});
    const states: SaveState[] = [];
    const s = new Autosaver<number>(write, (x) => states.push(x));
    s.schedule('a', 1);
    await vi.advanceTimersByTimeAsync(400);
    s.schedule('a', 2);
    s.schedule('b', 9);
    await vi.advanceTimersByTimeAsync(599);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(write.mock.calls).toEqual([['a', 2], ['b', 9]]);
    expect(states[0]).toEqual({ kind: 'saving' });
    expect(states.at(-1)?.kind).toBe('saved');
  });

  it('reports an error, keeps the value, and retries on flush', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const states: SaveState[] = [];
    const s = new Autosaver<number>(write, (x) => states.push(x));
    s.schedule('a', 1);
    await vi.advanceTimersByTimeAsync(700);
    expect(states.at(-1)).toEqual({ kind: 'error', message: 'offline' });
    expect(s.hasPending).toBe(true);
    await s.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(states.at(-1)?.kind).toBe('saved');
    expect(s.hasPending).toBe(false);
  });

  it('flush writes immediately', async () => {
    const write = vi.fn(async () => {});
    const s = new Autosaver<number>(write, () => {});
    s.schedule('a', 1);
    await s.flush();
    expect(write).toHaveBeenCalledTimes(1);
  });
});
