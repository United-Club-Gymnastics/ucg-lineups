import { describe, expect, it } from 'vitest';
import { runLimited } from '../../src/lib/data/plan';

const tick = () => new Promise((r) => setTimeout(r, 1));

describe('runLimited', () => {
  it('runs every task, never more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const ran: number[] = [];
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      running++;
      peak = Math.max(peak, running);
      await tick();
      ran.push(i);
      running--;
    });
    await runLimited(tasks, 3);
    expect(ran.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(peak).toBe(3);
  });

  it('rejects with the first error and starts nothing after it', async () => {
    const started: number[] = [];
    const tasks = Array.from({ length: 6 }, (_, i) => async () => {
      started.push(i);
      await tick();
      if (i === 1) throw new Error('batch 1 failed');
    });
    await expect(runLimited(tasks, 2)).rejects.toThrow('batch 1 failed');
    expect(started.length).toBeLessThan(6);
  });

  it('does nothing for no tasks', async () => {
    await expect(runLimited([])).resolves.toBeUndefined();
  });
});
