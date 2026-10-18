import { describe, expect, it } from 'vitest';
import {
  arrivalOrder, firstApparatus, flightRows, rotationFor, routinesPerRotation, squadCountFor, squadLetter, startsOnBye,
} from '../../src/lib/rotation';

const letters = (xs: number[]) => xs.map(squadLetter).join(', ');

describe('squad counts and letters', () => {
  it('WAG 4/8/8 and MAG 6/12/12', () => {
    expect(['one', 'parallel', 'byes'].map((p) => squadCountFor(p as 'one', 'WAG'))).toEqual([4, 8, 8]);
    expect(['one', 'parallel', 'byes'].map((p) => squadCountFor(p as 'one', 'MAG'))).toEqual([6, 12, 12]);
  });
  it('letters run A..Z then AA', () => {
    expect([0, 1, 25, 26, 27].map(squadLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
  });
});

describe('rotationFor', () => {
  it('one flight: squad i starts on apparatus i', () => {
    expect(rotationFor(0, 'one', 'MAG')).toEqual(['FX', 'PH', 'SR', 'VT', 'PB', 'HB']);
    expect(rotationFor(5, 'one', 'MAG')).toEqual(['HB', 'FX', 'PH', 'SR', 'VT', 'PB']);
    expect(rotationFor(2, 'one', 'WAG')).toEqual(['BB', 'FX', 'VT', 'UB']);
  });
  it('parallel: even index = flight A, odd = flight B, two squads share a start', () => {
    expect(rotationFor(0, 'parallel', 'WAG')).toEqual(['VT-A', 'UB-A', 'BB-A', 'FX-A']);
    expect(rotationFor(1, 'parallel', 'WAG')).toEqual(['VT-B', 'UB-B', 'BB-B', 'FX-B']);
    expect(rotationFor(2, 'parallel', 'WAG')).toEqual(['UB-A', 'BB-A', 'FX-A', 'VT-A']);
    expect(rotationFor(11, 'parallel', 'MAG')).toEqual(['HB-B', 'FX-B', 'PH-B', 'SR-B', 'VT-B', 'PB-B']);
  });
  it('2024 WAG 8-squad bye pattern', () => {
    expect(rotationFor(0, 'byes', 'WAG')).toEqual(['VT-A', 'UB-A', 'BB-A', 'FX']);
    expect(rotationFor(1, 'byes', 'WAG')).toEqual(['BYE', 'VT-B', 'UB-B', 'BB-B', 'FX']);
    expect(rotationFor(2, 'byes', 'WAG')).toEqual(['UB-A', 'BB-A', 'FX', 'VT-A']);
    expect(rotationFor(3, 'byes', 'WAG')).toEqual(['BYE', 'UB-B', 'BB-B', 'FX', 'VT-B']);
    expect(rotationFor(6, 'byes', 'WAG')).toEqual(['FX', 'VT-A', 'UB-A', 'BB-A']);
    expect(rotationFor(7, 'byes', 'WAG')).toEqual(['BYE', 'FX', 'VT-B', 'UB-B', 'BB-B']);
  });
  it('MAG byes keep floor unsuffixed', () => {
    expect(rotationFor(1, 'byes', 'MAG')).toEqual(['BYE', 'FX', 'PH-B', 'SR-B', 'VT-B', 'PB-B', 'HB-B']);
  });
  it('helpers', () => {
    expect(startsOnBye(1, 'byes', 'WAG')).toBe(true);
    expect(startsOnBye(0, 'byes', 'WAG')).toBe(false);
    expect(firstApparatus(1, 'byes', 'WAG')).toBe('VT');
    expect(flightRows('byes', 'WAG')).toEqual([[0, 2, 4, 6], [1, 3, 5, 7]]);
    expect(flightRows('one', 'MAG')).toEqual([[0, 1, 2, 3, 4, 5]]);
  });
});

describe('arrivalOrder', () => {
  it('one flight MAG floor: A, F, E, D, C, B', () => {
    expect(letters(arrivalOrder('FX', 'one', 'MAG'))).toBe('A, F, E, D, C, B');
  });
  it('one flight MAG first-apparatus is the squad itself first', () => {
    expect(letters(arrivalOrder('PH', 'one', 'MAG'))).toBe('B, A, F, E, D, C');
  });
  it('one flight WAG vault', () => {
    expect(letters(arrivalOrder('VT', 'one', 'WAG'))).toBe('A, D, C, B');
  });
  it('two flights: pairs arrive together, lower letter first', () => {
    expect(letters(arrivalOrder('VT', 'parallel', 'WAG'))).toBe('A, B, G, H, E, F, C, D');
  });
  it('byes: flight B arrives one rotation later, so G (start FX) and B tie at rotation 2', () => {
    expect(letters(arrivalOrder('VT', 'byes', 'WAG'))).toBe('A, B, G, E, H, C, F, D');
  });
});

describe('routinesPerRotation', () => {
  const counts = (n: number, v: Record<string, number>) => Array.from({ length: n }, () => ({ ...v }));
  it('one flight: every rotation has every squad on its own apparatus', () => {
    const s = routinesPerRotation('one', 'WAG', counts(4, { VT: 5, UB: 6, BB: 7, FX: 8 }), 12);
    expect(s.equipment).toEqual(['VT', 'UB', 'BB', 'FX']);
    expect(s.rows).toHaveLength(4);
    expect(s.rows[0].cells.map((c) => c?.squads[0].letter)).toEqual(['A', 'B', 'C', 'D']);
    expect(s.rows[0].total).toBe(26);
  });
  it('flags a squad over the cap', () => {
    const c = counts(4, { VT: 5, UB: 5, BB: 5, FX: 5 });
    c[0].VT = 13;
    const s = routinesPerRotation('one', 'WAG', c, 12);
    expect(s.rows[0].cells[0]?.squads[0]).toMatchObject({ letter: 'A', count: 13, over: true });
  });
  it('byes: five rotations, flight B sits out the first, bye letters listed', () => {
    const s = routinesPerRotation('byes', 'WAG', counts(8, { VT: 1, UB: 1, BB: 1, FX: 1 }), 12);
    expect(s.equipment).toEqual(['VT-A', 'VT-B', 'UB-A', 'UB-B', 'BB-A', 'BB-B', 'FX']);
    expect(s.rows).toHaveLength(5);
    expect(s.rows[0].byes).toEqual(['B', 'D', 'F', 'H']);
    expect(s.rows[1].byes).toEqual([]);
  });
  it('shared floor can hold two squads in one rotation and both are counted', () => {
    const s = routinesPerRotation('byes', 'WAG', counts(8, { VT: 1, UB: 1, BB: 1, FX: 3 }), 12);
    const shared = s.rows.flatMap((r) => r.cells).filter((c) => c && c.equipment === 'FX' && c.squads.length > 1);
    expect(shared.length).toBeGreaterThan(0);
    expect(shared[0]!.total).toBe(6);
    // every squad appears exactly once on FX across all rotations
    const fx = s.rows.flatMap((r) => r.cells).filter((c) => c?.equipment === 'FX').flatMap((c) => c!.squads.map((q) => q.index));
    expect([...fx].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
