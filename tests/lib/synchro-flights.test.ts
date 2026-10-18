import { describe, expect, it } from 'vitest';
import type { SynchroPair } from '../../src/lib/synchro-source';
import {
  defaultFlights, matchPairs, mergeFlights, movePair, pairClubs, pairNames, sortPairs, type FlightPair, type Person,
} from '../../src/lib/synchro-flights';

const person = (id: string, first: string, last: string, clubName: string): Person => ({ id, first, last, clubName });
const here: Person[] = [
  person('a1', 'Ada', 'Test', 'Alpha Gymnastics'), person('a2', 'Bo', 'StPierre', 'Alpha Gymnastics'),
  person('b1', 'Cy', 'Test', 'Beta Club'), person('b2', 'Di', "O'Neil", 'Beta Club'),
];
const elsewhere: Person[] = [person('z1', 'Zed', 'Far', 'Zeta Club'), person('z2', 'Zoe', 'Far', 'Zeta Club')];
let k = 0;
const sp = (name1: string, club1: string, name2: string, club2: string, level = 'IF', id = `p${++k}`): SynchroPair => ({
  id, level, a1: '', name1, club1, a2: '', name2, club2, createdAt: null, source: '',
});

describe('matchPairs', () => {
  it('matches by club + name ignoring spaces, case and punctuation', () => {
    const [p] = matchPairs([sp('ada test', 'ALPHA  gymnastics', 'Bo St Pierre', 'Alpha Gymnastics')], here, elsewhere);
    expect(p.athlete1).toBe('a1');
    expect(p.athlete2).toBe('a2');
    expect(p.check).toBe(false);
    expect(matchPairs([sp('Di Oneil', 'Beta Club', 'Cy Test', 'Beta Club')], here)[0].athlete1).toBe('b2');
  });

  it('flags a pair whose athletes cannot both be matched and keeps the Synchro tool names', () => {
    const [p] = matchPairs([sp('Ada Test', 'Alpha Gymnastics', 'Nobody Known', 'Alpha Gymnastics', 'HF')], here, elsewhere);
    expect(p.check).toBe(true);
    expect(p.athlete1).toBe('a1');
    expect(p.athlete2).toBeNull();
    expect(pairNames(p)).toBe('Ada Test & Nobody Known');
    expect(p.problems).toEqual(['Nobody Known is not in this import']);
    expect(p.level).toBe('HF');
  });

  it('flags a club mismatch (same name, wrong club) as unmatched', () => {
    const [p] = matchPairs([sp('Ada Test', 'Beta Club', 'Cy Test', 'Beta Club')], here);
    expect(p.check).toBe(true);
    expect(p.athlete1).toBeNull();
  });

  it('leaves out pairs that belong to another T&T session, flags a pair split across sessions, keeps unknown pairs flagged', () => {
    const out = matchPairs([
      sp('Zed Far', 'Zeta Club', 'Zoe Far', 'Zeta Club'),
      sp('Ada Test', 'Alpha Gymnastics', 'Zoe Far', 'Zeta Club'),
      sp('Who Ever', 'Nowhere', 'Else Where', 'Nowhere'),
    ], here, elsewhere);
    expect(out).toHaveLength(2);
    expect(out[0].problems).toEqual(['Zoe Far is in another T&T session']);
    expect(out[1].check).toBe(true);
    expect(out[1].problems).toHaveLength(2);
  });

  it('flags a name that matches two athletes of one club', () => {
    const dup = [...here, person('a1b', 'Ada', 'Test', 'Alpha Gymnastics')];
    const [p] = matchPairs([sp('Ada Test', 'Alpha Gymnastics', 'Bo StPierre', 'Alpha Gymnastics')], dup);
    expect(p.check).toBe(true);
    expect(p.athlete1).toBeNull();
    expect(p.problems[0]).toMatch(/more than one/);
  });

  it('normalises the level text and shows one club or both', () => {
    const [p] = matchPairs([sp('Ada Test', 'Alpha Gymnastics', 'Cy Test', 'Beta Club', 'High Flyers')], here);
    expect(p.level).toBe('HF');
    expect(pairClubs(p)).toBe('Alpha Gymnastics & Beta Club');
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
