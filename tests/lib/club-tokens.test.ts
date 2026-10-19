import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => {
  const rows: { id: string; token?: unknown }[] = [];
  const batches: [string, unknown][][] = [];
  return {
    rows, batches,
    collection: (_db: unknown, p: string) => p,
    doc: (_db: unknown, ...p: string[]) => p.join('/'),
    getDocs: async () => ({ docs: rows.map((r) => ({ id: r.id, data: () => ({ token: r.token }) })) }),
    writeBatch: () => { const ops: [string, unknown][] = []; return { set: (p: string, v: unknown) => ops.push([p, v]), commit: async () => { batches.push(ops); } }; },
  };
});
vi.mock('firebase/firestore', () => fs);

import { ensureClubTokens, loadClubTokens } from '../../src/lib/data/club-tokens';

beforeEach(() => { fs.rows.length = 0; fs.batches.length = 0; });

describe('clubTokens', () => {
  it('reads one token per club and ignores blanks', async () => {
    fs.rows.push({ id: 'a', token: 'TA' }, { id: 'b', token: '' }, { id: 'c' });
    expect(await loadClubTokens({} as never)).toEqual({ a: 'TA' });
  });

  it('creates a token only for clubs that have none, and never changes an existing one', async () => {
    fs.rows.push({ id: 'a', token: 'TA' });
    let n = 0;
    const out = await ensureClubTokens({} as never, ['a', 'b', 'b', 'c'], () => `NEW${++n}`);
    expect(out).toEqual({ a: 'TA', b: 'NEW1', c: 'NEW2' });
    expect(fs.batches.flat()).toEqual([['clubTokens/b', { token: 'NEW1' }], ['clubTokens/c', { token: 'NEW2' }]]);
  });

  it('writes nothing when every club already has a token', async () => {
    fs.rows.push({ id: 'a', token: 'TA' });
    await ensureClubTokens({} as never, ['a']);
    expect(fs.batches).toEqual([]);
  });
});
