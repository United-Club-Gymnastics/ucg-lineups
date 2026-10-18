// Pure: rotation patterns for artistic (MAG/WAG) sessions. Ported from the approved prototype
// (`rotation`, `scorecardPages`, `rotationSummary`); spec §4 and §6.
import { APPARATUS } from './apparatus';
import { apparatusCodes, type ArtisticDiscipline } from './squad-builder';

export { apparatusCodes };
export type { ArtisticDiscipline };

/**
 * one: a single flight (WAG 4 / MAG 6 squads).
 * parallel: two flights on A/B equipment (8 / 12 squads).
 * (The 2024 "two flights with byes" pattern was removed on 2026-10-18; see `readPattern`.)
 */
export type RotationPattern = 'one' | 'parallel';

export const ROTATION_PATTERNS: RotationPattern[] = ['one', 'parallel'];

/** New / unsaved sessions: WAG two flights on A/B equipment (8 squads), MAG one flight (6 squads). */
export const defaultPattern = (discipline: ArtisticDiscipline): RotationPattern => (discipline === 'WAG' ? 'parallel' : 'one');

/**
 * Reads a stored pattern. The removed `byes` pattern reads as `parallel` (same squad count); `removedByes`
 * tells the Squads screen to show its one-time notice. Anything else unknown returns null.
 */
export function readPattern(value: unknown): { pattern: RotationPattern; removedByes: boolean } | null {
  if (value === 'byes') return { pattern: 'parallel', removedByes: true };
  const pattern = ROTATION_PATTERNS.find((p) => p === value);
  return pattern ? { pattern, removedByes: false } : null;
}

/** The apparatus code of a rotation column (`VT-A` -> `VT`). */
export const columnCode = (column: string): string => column.split('-')[0];

export const isTwoFlights = (pattern: RotationPattern): boolean => pattern !== 'one';

/** WAG 4/8/8, MAG 6/12/12. */
export function squadCountFor(pattern: RotationPattern, discipline: ArtisticDiscipline): number {
  const n = APPARATUS[discipline].length;
  return isTwoFlights(pattern) ? n * 2 : n;
}

/** A, B, C... (past Z: AA, AB...). */
export function squadLetter(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** 0 = flight A, 1 = flight B. Squads are interleaved: even index = A, odd = B (one flight: always 0). */
export const flightOf = (index: number, pattern: RotationPattern): 0 | 1 => (isTwoFlights(pattern) && index % 2 === 1 ? 1 : 0);

/** Apparatus the squad starts on, as an index into the discipline's apparatus order. */
export function startIndexFor(index: number, pattern: RotationPattern, discipline: ArtisticDiscipline): number {
  const n = APPARATUS[discipline].length;
  return isTwoFlights(pattern) ? Math.floor(index / 2) % n : index % n;
}

/** The squad's columns in rotation order, e.g. WAG squad B in 'parallel': VT-B UB-B BB-B FX-B. */
export function rotationFor(index: number, pattern: RotationPattern, discipline: ArtisticDiscipline): string[] {
  const codes = apparatusCodes(discipline);
  const n = codes.length;
  const start = startIndexFor(index, pattern, discipline);
  const order = codes.map((_, k) => codes[(start + k) % n]);
  if (pattern === 'one') return order;
  const suffix = flightOf(index, pattern) === 1 ? 'B' : 'A';
  return order.map((c) => `${c}-${suffix}`);
}

/** Position (0-based rotation) at which the squad reaches `code`, or -1 when it never does. */
export function rotationIndexOf(index: number, code: string, pattern: RotationPattern, discipline: ArtisticDiscipline): number {
  return rotationFor(index, pattern, discipline).findIndex((c) => columnCode(c) === code);
}

/** Squad indexes in the order they reach `code` (ties: lower squad first). One flight MAG floor: A, F, E, D, C, B. */
export function arrivalOrder(code: string, pattern: RotationPattern, discipline: ArtisticDiscipline): number[] {
  const visits: { i: number; r: number }[] = [];
  for (let i = 0; i < squadCountFor(pattern, discipline); i++) {
    const r = rotationIndexOf(i, code, pattern, discipline);
    if (r >= 0) visits.push({ i, r });
  }
  return visits.sort((a, b) => a.r - b.r || a.i - b.i).map((v) => v.i);
}

/** First apparatus the squad competes on. */
export function firstApparatus(index: number, pattern: RotationPattern, discipline: ArtisticDiscipline): string {
  return columnCode(rotationFor(index, pattern, discipline)[0] ?? '');
}

/** Flight rows of squad indexes to draw: two flights when the pattern has them. */
export function flightRows(pattern: RotationPattern, discipline: ArtisticDiscipline): number[][] {
  const n = squadCountFor(pattern, discipline);
  const all = Array.from({ length: n }, (_, i) => i);
  return isTwoFlights(pattern) ? [all.filter((i) => i % 2 === 0), all.filter((i) => i % 2 === 1)] : [all];
}

export interface RotationCell {
  /** Equipment column, e.g. `VT-A`. */
  equipment: string;
  /** Every squad on this equipment this rotation (one, with A/B equipment). */
  squads: { index: number; letter: string; count: number; over: boolean }[];
  total: number;
}

export interface RotationRow {
  /** 1-based. */
  rotation: number;
  /** One entry per equipment column; null when nobody is on it this rotation. */
  cells: (RotationCell | null)[];
  total: number;
}

export interface RotationSummary {
  equipment: string[];
  rows: RotationRow[];
}

/**
 * "Routines per rotation": rotation x equipment, with the squad that is there and how many routines it has on
 * that apparatus. `counts[i]` = routines per apparatus code of squad `i`. A cell is `over` when a squad is above `cap`.
 */
export function routinesPerRotation(
  pattern: RotationPattern,
  discipline: ArtisticDiscipline,
  counts: Record<string, number>[],
  cap: number,
): RotationSummary {
  const n = squadCountFor(pattern, discipline);
  const codes = apparatusCodes(discipline);
  const rots = Array.from({ length: n }, (_, i) => rotationFor(i, pattern, discipline));
  const rounds = Math.max(0, ...rots.map((r) => r.length));
  const equipment: string[] = [];
  for (const code of codes) {
    for (const rot of rots) for (const e of rot) if (columnCode(e) === code && !equipment.includes(e)) equipment.push(e);
  }
  equipment.sort((a, b) => codes.indexOf(columnCode(a)) - codes.indexOf(columnCode(b)) || a.localeCompare(b));
  const rows: RotationRow[] = Array.from({ length: rounds }, (_, r) => {
    let total = 0;
    const cells = equipment.map((e): RotationCell | null => {
      const squads = rots
        .map((rot, i) => ({ rot, i }))
        .filter(({ rot }) => rot[r] === e)
        .map(({ i }) => {
          const count = counts[i]?.[columnCode(e)] ?? 0;
          return { index: i, letter: squadLetter(i), count, over: count > cap };
        });
      if (squads.length === 0) return null;
      const sum = squads.reduce((t, s) => t + s.count, 0);
      total += sum;
      return { equipment: e, squads, total: sum };
    });
    return { rotation: r + 1, cells, total };
  });
  return { equipment, rows };
}
