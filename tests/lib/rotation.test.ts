import { describe, expect, it } from 'vitest';
import {
  arrivalOrder, defaultPattern, firstApparatus, flightRows, readPattern, rotationFor, routinesPerRotation, squadCountFor, squadLetter,
} from '../../src/lib/rotation';

const letters = (xs: number[]) => xs.map(squadLetter).join(', ');

describe('squad counts and letters', () => {
  it('WAG 4/8 and MAG 6/12', () => {
    expect((['one', 'parallel'] as const).map((p) => squadCountFor(p, 'WAG'))).toEqual([4, 8]);
    expect((['one', 'parallel'] as const).map((p) => squadCountFor(p, 'MAG'))).toEqual([6, 12]);
  });
  it('new sessions default to WAG two flights on A/B equipment (8 squads) and MAG one flight (6 squads)', () => {
    expect(defaultPattern('WAG')).toBe('parallel');
    expect(defaultPattern('MAG')).toBe('one');
    expect(squadCountFor(defaultPattern('WAG'), 'WAG')).toBe(8);
    expect(squadCountFor(defaultPattern('MAG'), 'MAG')).toBe(6);
  });
  it('a stored byes pattern reads as parallel (same squad count) and says so; junk is rejected', () => {
    expect(readPattern('byes')).toEqual({ pattern: 'parallel', removedByes: true });
    expect(squadCountFor(readPattern('byes')!.pattern, 'WAG')).toBe(8);
    expect(readPattern('one')).toEqual({ pattern: 'one', removedByes: false });
    expect(readPattern('parallel')).toEqual({ pattern: 'parallel', removedByes: false });
    expect(readPattern('three')).toBeNull();
    expect(readPattern(undefined)).toBeNull();
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
  it('no pattern has a BYE or an unsuffixed floor', () => {
    for (const d of ['WAG', 'MAG'] as const) {
      for (const p of ['one', 'parallel'] as const) {
        for (let i = 0; i < squadCountFor(p, d); i++) expect(rotationFor(i, p, d)).not.toContain('BYE');
      }
    }
    expect(rotationFor(7, 'parallel', 'WAG')).toEqual(['FX-B', 'VT-B', 'UB-B', 'BB-B']);
  });
  it('helpers', () => {
    expect(firstApparatus(1, 'parallel', 'WAG')).toBe('VT');
    expect(firstApparatus(2, 'parallel', 'WAG')).toBe('UB');
    expect(flightRows('parallel', 'WAG')).toEqual([[0, 2, 4, 6], [1, 3, 5, 7]]);
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
  it('two flights on A/B equipment: four rotations, each A/B cell holds one squad', () => {
    const s = routinesPerRotation('parallel', 'WAG', counts(8, { VT: 1, UB: 1, BB: 1, FX: 1 }), 12);
    expect(s.equipment).toEqual(['VT-A', 'VT-B', 'UB-A', 'UB-B', 'BB-A', 'BB-B', 'FX-A', 'FX-B']);
    expect(s.rows).toHaveLength(4);
    expect(s.rows.every((r) => r.cells.every((c) => c === null || c.squads.length === 1))).toBe(true);
    expect(s.rows[0].total).toBe(8);
  });
});
