import { describe, expect, it } from 'vitest';
import { planImport, chunk, MAX_BATCH } from '../../src/lib/data/plan';
import { diffAthletes, type StoredAthlete } from '../../src/lib/import/diff';
import { assignTokens, newClubToken } from '../../src/lib/import/token';
import type { Athlete, ImportModel } from '../../src/lib/import/types';

const ath = (bib: string, over: Partial<Athlete> = {}): Athlete => ({
  id: `WAG_${bib}`, discipline: 'WAG', first: 'Ada', last: 'Test', clubId: 'alpha', clubName: 'Alpha',
  independent: false, levelCode: 'XP', levelName: 'Platinum', sessionId: 's1-orange', apparatus: ['VT', 'UB'], competes: true, ...over,
});

describe('diffAthletes', () => {
  it('classifies added / changed / removed / unchanged', () => {
    const existing: StoredAthlete[] = [ath('1'), ath('2'), ath('3'), ath('4', { tnt: { SY: 'NF' }, discipline: 'TNT', id: 'TNT_4' })];
    const incoming = [
      ath('1'),
      ath('2', { apparatus: ['VT'], sessionId: 's2-red' }),
      ath('5'),
      ath('4', { tnt: { SY: 'NF' }, discipline: 'TNT', id: 'TNT_4' }),
    ];
    const d = diffAthletes(existing, incoming);
    expect(d.unchanged.sort()).toEqual(['TNT_4', 'WAG_1']);
    expect(d.added.map((x) => x.id)).toEqual(['WAG_5']);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].athlete.id).toBe('WAG_2');
    expect(d.changed[0].fields.sort()).toEqual(['apparatus', 'sessionId']);
    expect(d.removed).toEqual(['WAG_3']);
  });

  it('detects T&T level changes, ignores stored extras, un-removes returning athletes', () => {
    const t = ath('9', { id: 'TNT_9', discipline: 'TNT', tnt: { TR: 'NF', SY: 'NF' }, apparatus: ['TR', 'SY'] });
    const stored = { ...t, extra: 'x', updatedAt: 5 } as StoredAthlete;
    expect(diffAthletes([stored], [t]).unchanged).toEqual(['TNT_9']);
    const changed = diffAthletes([stored], [{ ...t, tnt: { TR: 'NF', SY: 'IF' } }]);
    expect(changed.changed[0].fields).toEqual(['tnt']);
    const back = diffAthletes([{ ...t, removed: true }], [t]);
    expect(back.changed[0].fields).toEqual(['removed']);
  });

  it('does not re-report already removed athletes and is order-independent for tnt keys', () => {
    const gone = { ...ath('7'), removed: true };
    expect(diffAthletes([gone], []).removed).toEqual([]);
    const a1 = ath('8', { tnt: { TR: 'NF', DM: 'IF' } });
    const a2 = ath('8', { tnt: { DM: 'IF', TR: 'NF' } });
    expect(diffAthletes([a1], [a2]).unchanged).toEqual(['WAG_8']);
  });
});

describe('tokens', () => {
  it('makes 128-bit base64url tokens', () => {
    const t = newClubToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newClubToken()).not.toBe(t);
  });
  it('keeps existing tokens and mints only for new clubs', () => {
    let n = 0;
    const out = assignTokens(['a', 'b'], { a: 'KEEP' }, () => `NEW${++n}`);
    expect(out).toEqual({ a: 'KEEP', b: 'NEW1' });
  });
});

describe('planImport', () => {
  const model = (athletes: Athlete[], clubs = [{ id: 'alpha', name: 'Alpha', emails: ['n@a.org'] }]): ImportModel => ({
    athletes, clubs, warnings: [],
    sessions: [{ id: 's1-orange', number: 1, gym: 'Orange', discipline: 'WAG', levelCodes: ['XP'] }],
  });

  it('first import writes everything, mints tokens, seeds settings', () => {
    const p = planImport(model([ath('1')]), { athletes: [], clubs: [], hasSettings: false }, 'm1', () => 'TOK');
    expect(p.ops.map((o) => o.path)).toEqual(['meets/m1/athletes/WAG_1', 'meets/m1/sessions/s1-orange', 'meets/m1/clubs/alpha', 'meets/m1/settings/meet']);
    expect(p.ops.find((o) => o.path === 'meets/m1/clubs/alpha')!.data).toEqual({ name: 'Alpha', emails: ['n@a.org'], token: 'TOK' });
    expect(p.ops[0]).toMatchObject({ merge: false, data: { removed: false } });
    expect(p.newClubs).toBe(1);
  });

  it('re-import keeps tokens, skips unchanged athletes, flags removed, keeps stored emails when none incoming', () => {
    const existing = {
      athletes: [ath('1'), ath('2')],
      clubs: [{ id: 'alpha', name: 'Alpha', emails: ['kept@a.org'], token: 'OLD' }],
      hasSettings: true,
    };
    const p = planImport(model([ath('1')], [{ id: 'alpha', name: 'Alpha', emails: [] }]), existing, 'm1', () => 'NEW');
    expect(p.ops.map((o) => o.path)).toEqual(['meets/m1/athletes/WAG_2', 'meets/m1/sessions/s1-orange', 'meets/m1/clubs/alpha']);
    expect(p.ops[0]).toEqual({ path: 'meets/m1/athletes/WAG_2', data: { removed: true }, merge: true });
    expect(p.ops[2].data).toEqual({ name: 'Alpha', emails: ['kept@a.org'], token: 'OLD' });
    expect(p.newClubs).toBe(0);
  });

  it('chunks writes into batches of at most 450', () => {
    expect(MAX_BATCH).toBe(450);
    const batches = chunk(Array.from({ length: 1000 }, (_, i) => i));
    expect(batches.map((b) => b.length)).toEqual([450, 450, 100]);
  });
});
