import { describe, expect, it } from 'vitest';
import type { StoredAthlete } from '../../src/lib/import/diff';
import { buildTntSessionData, isTntSession, parseTntDoc, toStoredTntDoc, toTntAthlete } from '../../src/lib/tnt-data';

const ath = (over: Partial<StoredAthlete>): StoredAthlete => ({
  id: 'TNT_club_a', discipline: 'TNT', first: 'Ada', last: 'Test', clubId: 'club', clubName: 'Club', independent: false, levelCode: 'IF', levelName: 'x',
  sessionId: 's1-purple', apparatus: ['TR'], tnt: { TR: 'IF' }, competes: true, ...over,
});
const session = { id: 's1-purple', number: 1, gym: 'Purple', discipline: 'TNT' as const, levelCodes: [] };

describe('buildTntSessionData', () => {
  it('splits squad athletes from synchro-only and ignores removed, other-session and non-competing athletes', () => {
    const d = buildTntSessionData(session, [
      ath({ id: 'a', first: 'B' }), ath({ id: 's', first: 'A', apparatus: ['SY'], tnt: { SY: 'HF' } }),
      ath({ id: 'r', removed: true }), ath({ id: 'o', sessionId: 's2-red' }), ath({ id: 'n', competes: false }), ath({ id: 'w', discipline: 'WAG' }),
    ]);
    expect(d.squadAthletes.map((a) => a.id)).toEqual(['a']);
    expect(d.synchroOnly.map((a) => a.id)).toEqual(['s']);
    expect(d.describe('a')).toBe('B Test · Club');
  });
  it('reads per-event levels, and falls back to the athlete level for old records', () => {
    expect(toTntAthlete(ath({ apparatus: ['TR', 'DM', 'SY'], tnt: { TR: 'NF', DM: 'HF', SY: 'IF' } })).levels).toEqual({ TR: 'NF', DM: 'HF', SY: 'IF' });
    expect(toTntAthlete(ath({ apparatus: ['TR', 'TU'], tnt: undefined, levelCode: 'HF' })).levels).toEqual({ TR: 'HF', TU: 'HF' });
  });
  it('session test', () => {
    expect(isTntSession(session)).toBe(true);
  });
});

describe('stored T&T doc', () => {
  const doc = toStoredTntDoc({ squads: [['a'], ['b'], []], tray: ['c'], orders: { A_TR: ['a'] }, flights: [{ name: 'A', pairIds: ['p1'] }], pairsReadAt: new Date('2026-10-18T10:00:00Z') });
  it('round-trips and has no nested arrays', () => {
    expect(doc.kind).toBe('tnt');
    expect(doc.squads).toEqual([{ name: 'A', athleteIds: ['a'] }, { name: 'B', athleteIds: ['b'] }, { name: 'C', athleteIds: [] }]);
    expect(parseTntDoc(doc)).toEqual(doc);
  });
  it('reads a Firestore timestamp and ignores junk', () => {
    expect(parseTntDoc({ ...doc, pairsReadAt: { toDate: () => new Date('2026-01-01T00:00:00Z') } })!.pairsReadAt).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(parseTntDoc({ ...doc, orders: { A_TR: ['a'], Z_TR: ['x'], A_SY: ['x'], B_DM: 'nope' } })!.orders).toEqual({ A_TR: ['a'], B_DM: [] });
    expect(parseTntDoc(null)).toBeNull();
    expect(parseTntDoc({ pattern: 'one', squads: [], trayAthleteIds: [] })).toBeNull(); // an artistic plan
    expect(parseTntDoc({ kind: 'tnt', squads: [] })!.squads).toHaveLength(3);
  });
});
