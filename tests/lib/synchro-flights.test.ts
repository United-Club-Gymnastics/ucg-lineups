import { describe, expect, it } from 'vitest';
import type { SynchroPair } from '../../src/lib/synchro-source';
import {
  assignPair, defaultFlights, mergeFlights, movePair, pairClubs, pairNames, pairsInSession, pairsNeedingSession, parseAssignments, placePairs, sortPairs,
  type FlightPair, type RosterPerson, type SynchroAssignments,
} from '../../src/lib/synchro-flights';

const S1 = 's1-green';
const S2 = 's2-green';
const person = (id: string, first: string, last: string, clubName: string, sessionId = S1, inSynchro = true): RosterPerson => ({ id, first, last, clubName, sessionId, inSynchro });
const roster: RosterPerson[] = [
  person('a1', 'Ada', 'Test', 'Alpha Gymnastics'), person('a2', 'Bo', 'StPierre', 'Alpha Gymnastics'),
  person('b1', 'Cy', 'Test', 'Beta Club'), person('b2', 'Di', "O'Neil", 'Beta Club'),
  person('z1', 'Zed', 'Far', 'Zeta Club', S2), person('z2', 'Zoe', 'Far', 'Zeta Club', S2),
];
const SESSIONS = [S1, S2];
let k = 0;
const sp = (name1: string, club1: string, name2: string, club2: string, level = 'IF', id = `p${++k}`): SynchroPair => ({
  id, level, a1: '', name1, club1, a2: '', name2, club2, createdAt: null, source: '',
});
const place = (pairs: SynchroPair[], assignments: SynchroAssignments = {}, people = roster) => placePairs(pairs, people, assignments, SESSIONS);

describe('placePairs: matching', () => {
  it('matches by club + name ignoring spaces, case and punctuation', () => {
    const [p] = place([sp('ada test', 'ALPHA  gymnastics', 'Bo St Pierre', 'Alpha Gymnastics')]);
    expect(p.athlete1).toBe('a1');
    expect(p.athlete2).toBe('a2');
    expect(p.check).toBe(false);
    expect(place([sp('Di Oneil', 'Beta Club', 'Cy Test', 'Beta Club')])[0].athlete1).toBe('b2');
  });

  it('flags a pair whose athletes cannot both be matched, keeps the Synchro tool names, and leaves it needing a session', () => {
    const [p] = place([sp('Ada Test', 'Alpha Gymnastics', 'Nobody Known', 'Alpha Gymnastics', 'HF')]);
    expect(p.check).toBe(true);
    expect(p.athlete1).toBe('a1');
    expect(p.athlete2).toBeNull();
    expect(pairNames(p)).toBe('Ada Test & Nobody Known');
    expect(p.problems).toEqual(['Nobody Known is not in this import']);
    expect(p.level).toBe('HF');
    expect(p.sessionId).toBeNull();
    expect(p.unassignedReason).toBe('unmatched');
  });

  it('matches a renamed club by name alone when one T&T athlete has that name, and shows the import\'s club (no Check pair)', () => {
    const [p] = place([sp('Ada Test', 'Alpha Club Gymnastics (old name)', 'Bo St Pierre', 'Old Alpha')]);
    expect([p.athlete1, p.athlete2]).toEqual(['a1', 'a2']);
    expect(p.check).toBe(false);
    expect(p.problems).toEqual([]);
    expect([p.club1, p.club2]).toEqual(['Alpha Gymnastics', 'Alpha Gymnastics']);
    expect(pairClubs(p)).toBe('Alpha Gymnastics');
    expect(p.name1).toBe('Ada Test');
    expect(p.sessionId).toBe(S1);
  });

  it('same name in two clubs: the partner\'s club breaks the tie, else the partner\'s session, else it stays unmatched', () => {
    const dup = [
      ...roster, person('t1', 'Ada', 'Test', 'Other Club', S2), person('t2', 'Eve', 'Other', 'Other Club', S2),
      person('t3', 'Fay', 'Third', 'Third Club', S1), person('t4', 'Fay', 'Third', 'Fourth Club', S2), person('t5', 'Gil', 'Solo', 'Whatever', S2),
    ];
    // partner Eve (Other Club) -> Ada of Other Club, though the Synchro tool has a stale club name for both
    const [byClub] = place([sp('Ada Test', 'Renamed', 'Eve Other', 'Renamed')], {}, dup);
    expect(byClub.athlete1).toBe('t1');
    // partner Gil is in S2 and only one Fay is in S2
    const [bySession] = place([sp('Fay Third', 'Renamed', 'Gil Solo', 'Renamed')], {}, dup);
    expect(bySession.athlete1).toBe('t4');
    expect(bySession.sessionId).toBe(S2);
    // partner Ada Test (exact club + name, S1): two Fays and neither shares its club; only one Fay is in S1
    const [tie] = place([sp('Fay Third', 'Renamed', 'Ada Test', 'Alpha Gymnastics')], {}, dup);
    expect(tie.athlete1).toBe('t3');
    // nothing to break the tie
    const [lost] = place([sp('Fay Third', 'Renamed', 'Nobody Known', 'Renamed')], {}, dup);
    expect(lost.athlete1).toBeNull();
    expect(lost.check).toBe(true);
    expect(lost.problems[0]).toMatch(/more than one/);
    expect(lost.sessionId).toBeNull();
  });

  it('flags a name that matches two athletes of one club', () => {
    const dup = [...roster, person('a1b', 'Ada', 'Test', 'Alpha Gymnastics')];
    const [p] = place([sp('Ada Test', 'Alpha Gymnastics', 'Bo StPierre', 'Alpha Gymnastics')], {}, dup);
    expect(p.check).toBe(true);
    expect(p.athlete1).toBeNull();
    expect(p.problems[0]).toMatch(/more than one/);
    expect(p.sessionId).toBeNull();
  });

  it('flags a pair when an athlete is on the roster but not entered in synchro (the pair still gets its session)', () => {
    const r = [...roster.filter((x) => x.id !== 'a2'), person('a2', 'Bo', 'StPierre', 'Alpha Gymnastics', S1, false)];
    const [p] = place([sp('Ada Test', 'Alpha Gymnastics', 'Bo StPierre', 'Alpha Gymnastics')], {}, r);
    expect(p.check).toBe(true);
    expect(p.problems).toEqual(['Bo StPierre is on the roster but not entered in synchro']);
    expect(p.athlete2).toBe('a2');
    expect(p.sessionId).toBe(S1);
  });

  it('normalises the level text and shows one club or both', () => {
    const [p] = place([sp('Ada Test', 'Alpha Gymnastics', 'Cy Test', 'Beta Club', 'High Flyers')]);
    expect(p.level).toBe('HF');
    expect(pairClubs(p)).toBe('Alpha Gymnastics & Beta Club');
  });
});

describe('placePairs: sessions', () => {
  const same = sp('Ada Test', 'Alpha Gymnastics', 'Bo StPierre', 'Alpha Gymnastics');
  const zeta = sp('Zed Far', 'Zeta Club', 'Zoe Far', 'Zeta Club');
  const split = sp('Ada Test', 'Alpha Gymnastics', 'Zoe Far', 'Zeta Club');

  it('defaults a pair to the T&T session both athletes are in', () => {
    const [a, z] = place([same, zeta]);
    expect([a.sessionId, a.defaultSessionId, a.manual]).toEqual([S1, S1, false]);
    expect([z.sessionId, z.defaultSessionId]).toEqual([S2, S2]);
    expect(pairsInSession([a, z], S2).map((p) => p.id)).toEqual([zeta.id]);
    expect(pairsNeedingSession([a, z])).toEqual([]);
  });

  it('puts a pair whose athletes are in different sessions in "Needs a session" (no guessing)', () => {
    const [p] = place([split]);
    expect(p.sessionId).toBeNull();
    expect(p.defaultSessionId).toBeNull();
    expect(p.unassignedReason).toBe('different-sessions');
    expect(p.athleteSessions).toEqual([S1, S2]);
    expect(p.check).toBe(false);
    expect(pairsNeedingSession([p])).toHaveLength(1);
    expect(pairsInSession([p], S1)).toEqual([]);
    expect(pairsInSession([p], S2)).toEqual([]);
  });

  it('an unmatched pair appears once, under Needs a session, and in no session', () => {
    const lost = sp('Who Ever', 'Nowhere', 'Else Where', 'Nowhere');
    const placed = place([lost, sp('Zed Far', 'Zeta Club', 'Zoe Far', 'Zeta Club')]);
    expect(pairsNeedingSession(placed).map((p) => p.id)).toEqual([lost.id]);
    expect(SESSIONS.flatMap((sid) => pairsInSession(placed, sid)).map((p) => p.id)).not.toContain(lost.id);
    expect(placed[0].problems).toHaveLength(2);
  });

  it('an unmatched pair stays in "Needs a session" until the host chooses', () => {
    const lost = sp('Who Ever', 'Nowhere', 'Else Where', 'Nowhere');
    expect(place([lost])[0]).toMatchObject({ sessionId: null, unassignedReason: 'unmatched', check: true });
    expect(place([lost], assignPair({}, lost.id, S2))[0]).toMatchObject({ sessionId: S2, manual: true, unassignedReason: null });
  });

  it('the host can move any pair to any T&T session, and the choice wins over the default', () => {
    const moved = place([same, split], assignPair(assignPair({}, same.id, S2), split.id, S1));
    expect(moved.map((p) => [p.sessionId, p.manual])).toEqual([[S2, true], [S1, true]]);
    expect(moved[0].defaultSessionId).toBe(S1);
  });

  it('a manual move persists across a refresh: re-reading the pairs with the same stored choices gives the same placement', () => {
    const stored = parseAssignments(JSON.parse(JSON.stringify({ assignments: assignPair({}, same.id, S2) })));
    const first = place([same, zeta], stored);
    const afterRefresh = place([zeta, same, sp('New', 'Alpha Gymnastics', 'Bo StPierre', 'Alpha Gymnastics')], stored);
    expect(first.find((p) => p.id === same.id)!.sessionId).toBe(S2);
    expect(afterRefresh.find((p) => p.id === same.id)).toMatchObject({ sessionId: S2, manual: true });
    // Refresh pairs merges the session's flights and never touches the choices.
    const flightsS2 = mergeFlights([{ name: 'A', pairIds: [zeta.id] }], pairsInSession(afterRefresh, S2)).flights;
    expect([...flightsS2[0].pairIds].sort()).toEqual([zeta.id, same.id].sort());
  });

  it('ignores a stored choice that names a session that no longer exists', () => {
    const [p] = place([same], { [same.id]: 'gone' });
    expect(p).toMatchObject({ sessionId: S1, manual: false });
  });

  it('parseAssignments reads defensively', () => {
    expect(parseAssignments(null)).toEqual({});
    expect(parseAssignments({ assignments: { a: 's1', b: 3, c: '' } })).toEqual({ a: 's1' });
    expect(parseAssignments({ assignments: 'x' })).toEqual({});
  });
});

const fp = (id: string, level: string, club = 'Club', name = id): FlightPair => ({
  id, level, name1: name, name2: 'X', club1: club, club2: club, athlete1: 'a', athlete2: 'b', check: false, problems: [],
});

describe('default flights', () => {
  it('sorts HF > IF > NF, then club, then names, and splits evenly in two (extra pair in the first)', () => {
    const pairs = [fp('n1', 'NF', 'A'), fp('h2', 'HF', 'B'), fp('i1', 'IF', 'A'), fp('h1', 'HF', 'A'), fp('i2', 'IF', 'B')];
    expect(sortPairs(pairs).map((p) => p.id)).toEqual(['h1', 'h2', 'i1', 'i2', 'n1']);
    const f = defaultFlights(pairs);
    expect(f.map((x) => x.name)).toEqual(['A', 'B']);
    expect(f[0].pairIds).toEqual(['h1', 'h2', 'i1']);
    expect(f[1].pairIds).toEqual(['i2', 'n1']);
  });
  it('handles no pairs', () => {
    expect(defaultFlights([])).toEqual([{ name: 'A', pairIds: [] }, { name: 'B', pairIds: [] }]);
  });
});

describe('mergeFlights (Refresh pairs)', () => {
  const start = [fp('h1', 'HF'), fp('h2', 'HF'), fp('i1', 'IF'), fp('i2', 'IF'), fp('n1', 'NF'), fp('n2', 'NF')];
  const flights = [{ name: 'A', pairIds: ['h2', 'h1', 'i1'] }, { name: 'B', pairIds: ['i2', 'n2', 'n1'] }]; // admin reordered

  it('keeps existing order and flights when nothing changed', () => {
    const r = mergeFlights(flights, start);
    expect(r.flights).toEqual(flights);
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
  });

  it('drops deleted pairs and keeps everyone else where they were', () => {
    const r = mergeFlights(flights, start.filter((p) => p.id !== 'h1' && p.id !== 'n2'));
    expect(r.flights).toEqual([{ name: 'A', pairIds: ['h2', 'i1'] }, { name: 'B', pairIds: ['i2', 'n1'] }]);
    expect(r.removed.sort()).toEqual(['h1', 'n2']);
  });

  it('adds a new pair at the end of its level, in the flight that holds the level', () => {
    const r = mergeFlights(flights, [...start, fp('h3', 'HF'), fp('n3', 'NF')]);
    expect(r.flights[0].pairIds).toEqual(['h2', 'h1', 'h3', 'i1']);
    expect(r.flights[1].pairIds).toEqual(['i2', 'n2', 'n1', 'n3']);
    expect(r.added.sort()).toEqual(['h3', 'n3']);
  });

  it('puts a level that straddles both flights at the end of its last block', () => {
    const r = mergeFlights(flights, [...start, fp('i3', 'IF')]);
    expect(r.flights[0].pairIds).toEqual(['h2', 'h1', 'i1']);
    expect(r.flights[1].pairIds).toEqual(['i2', 'i3', 'n2', 'n1']);
  });

  it('a level that no flight holds goes to the last flight; several new pairs keep default order', () => {
    const only = [{ name: 'A', pairIds: ['h1'] }, { name: 'B', pairIds: ['i1'] }];
    const r = mergeFlights(only, [fp('h1', 'HF'), fp('i1', 'IF'), fp('n2', 'NF', 'B'), fp('n1', 'NF', 'A')]);
    expect(r.flights[1].pairIds).toEqual(['i1', 'n1', 'n2']);
    expect(r.flights[0].pairIds).toEqual(['h1']);
  });

  it('builds default flights when there are none saved', () => {
    expect(mergeFlights([], start).flights).toEqual(defaultFlights(start));
  });

  it('added, removed and kept in one go', () => {
    const r = mergeFlights(flights, [...start.filter((p) => p.id !== 'i1'), fp('i9', 'IF')]);
    expect(r.removed).toEqual(['i1']);
    expect(r.added).toEqual(['i9']);
    expect(r.flights.flatMap((f) => f.pairIds)).toEqual(['h2', 'h1', 'i2', 'i9', 'n2', 'n1']);
  });
});

describe('movePair', () => {
  it('moves a pair to the end of another flight', () => {
    expect(movePair([{ name: 'A', pairIds: ['x', 'y'] }, { name: 'B', pairIds: ['z'] }], 'x', 1)).toEqual([
      { name: 'A', pairIds: ['y'] }, { name: 'B', pairIds: ['z', 'x'] },
    ]);
  });
});
