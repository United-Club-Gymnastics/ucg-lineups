// Pure: rotation patterns for artistic (MAG/WAG) sessions. Ported from the approved prototype
// (`rotation`, `scorecardPages`, `rotationSummary`); spec §4 and §6.
import { apparatusCodes, type ArtisticDiscipline } from './squad-builder';

export { apparatusCodes };
export type { ArtisticDiscipline };

/** A pattern id, e.g. `one`, `parallel`, `wag-7`. Definitions are data (`PATTERNS`); an unknown id reads as the discipline's default. */
export type RotationPattern = string;

/** BYE in a squad's sequence: the squad has nothing in that slot (it starts one rotation late). */
export const BYE = 'BYE';

export interface PatternDef {
  id: RotationPattern;
  discipline: ArtisticDiscipline;
  /** Button text on the Squads screen. */
  label: string;
  /** Two flights on A/B equipment (squads interleaved: even = flight A, odd = flight B). Only the existing two-flight pattern has flights. */
  flights: boolean;
  /** Per squad, its competing order: an equipment column (`VT-A`, `BB-B`, `FX`) or BYE. */
  sequences: string[][];
  /** Optional printed timeline, per squad, one cell per slot exactly as printed: `(W) VT-P`, `(C) VT-P`, `(W/C) UB`, `BYE`, `-`. */
  timeline?: string[][];
  /** Optional note lines printed beside each squad on the rotation sheet. */
  notes?: string[][];
  /** Every equipment column in display order -> its printed name (`VT-P` -> `VT-Platform`). */
  equipment: Record<string, string>;
  /** Short note for the Squads screen (e.g. what the timeline slots are). */
  blurb?: string;
}

/** The apparatus code of a rotation column (`VT-A` -> `VT`). */
export const columnCode = (column: string): string => column.split('-')[0];

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

const rotated = (codes: string[], start: number): string[] => codes.map((_, k) => codes[(start + k) % codes.length]);

function standardDefs(discipline: ArtisticDiscipline): PatternDef[] {
  const codes = apparatusCodes(discipline);
  const n = codes.length;
  const one = Array.from({ length: n }, (_, i) => rotated(codes, i));
  // Two flights: squads interleaved (even = A, odd = B); squads 2k and 2k+1 start on apparatus k.
  const parallel = Array.from({ length: n * 2 }, (_, i) => rotated(codes, Math.floor(i / 2) % n).map((c) => `${c}-${i % 2 === 1 ? 'B' : 'A'}`));
  const identity = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, c]));
  return [
    { id: 'one', discipline, label: `One flight · ${n} squads`, flights: false, sequences: one, equipment: identity(codes) },
    {
      id: 'parallel', discipline, label: `Two flights, A/B equipment · ${n * 2}`, flights: true, sequences: parallel,
      equipment: identity(codes.flatMap((c) => [`${c}-A`, `${c}-B`])),
    },
  ];
}

/** Julia's NE Regionals 2026 sheet: 7 squads, 2 vaults (platform, ground) and 2 beams, one bars and one floor. */
const WAG_7_SEQUENCES = [
  ['VT-P', 'UB', 'BB-B', 'FX'],
  [BYE, 'VT-G', 'UB', 'BB-A', 'FX'],
  ['UB', 'BB-A', 'FX', 'VT-P'],
  ['BB-A', 'FX', 'VT-P', 'UB'],
  [BYE, 'BB-B', 'FX', 'VT-G', 'UB'],
  ['FX', 'VT-P', 'UB', 'BB-B'],
  [BYE, 'FX', 'VT-G', 'UB', 'BB-A'],
];
const WAG_7_TIMELINE = [
  ['(W) VT-P', '(C) VT-P', '(W/C) UB', '(W) BB-B', '(C) BB-B', '(W) FX', '(C) FX', '-'],
  [BYE, '(W) VT-G', '(C) VT-G', '(W/C) UB', '(W) BB-A', '(C) BB-A', '(W) FX', '(C) FX'],
  ['(W) UB', '(C) UB', '(W) BB-A', '(C) BB-A', '(W) FX', '(C) FX', '(W) VT-P', '(C) VT-P'],
  ['(W) BB-A', '(C) BB-A', '(W) FX', '(C) FX', '(W) VT-P', '(C) VT-P', '(W/C) UB', '-'],
  [BYE, '(W) BB-B', '(C) BB-B', '(W) FX', '(C) FX', '(W) VT-G', '(C) VT-G', '(W/C) UB'],
  ['(W) FX', '(C) FX', '(W) VT-P', '(C) VT-P', '(W/C) UB', '(W) BB-B', '(C) BB-B', '-'],
  [BYE, '(W) FX', '(C) FX', '(W) VT-G', '(C) VT-G', '(W/C) UB', '(W) BB-A', '(C) BB-A'],
];
const WAG_7_NOTES = [
  ['UB/FX after Squad C'],
  ['Start warm-ups when Squad A starts competing.', 'UB/FX after Squad A'],
  ['FX after Squad E'],
  ['UB/FX after Squad G'],
  ['Start warm-ups when Squad D starts competing', 'UB/FX after Squad D'],
  ['UB after Squad B'],
  ['Bump touch warm-up once F starts competing', 'UB/FX after Squad F'],
];

const MAG_CODES = ['FX', 'PH', 'SR', 'VT', 'PB', 'HB'];
const magDef = (id: string, label: string, orders: string[]): PatternDef => ({
  id, discipline: 'MAG', label, flights: false,
  sequences: orders.map((o) => o.split(' ')),
  equipment: Object.fromEntries(MAG_CODES.map((c) => [c, c])),
});

/** Every pattern: the two standard ones, then Julia's alternatives. A MAG/WAG session picks from its own discipline's list. */
export const PATTERNS: PatternDef[] = [
  ...standardDefs('WAG'),
  {
    id: 'wag-7', discipline: 'WAG', label: '7 squads (2 vaults, 2 beams)', flights: false,
    sequences: WAG_7_SEQUENCES, timeline: WAG_7_TIMELINE, notes: WAG_7_NOTES,
    equipment: { 'VT-P': 'VT-Platform', 'VT-G': 'VT-Ground', UB: 'UB', 'BB-A': 'BB-A', 'BB-B': 'BB-B', FX: 'FX' },
    blurb: 'The routines table below has one row per timeline slot (8), counting a squad on an apparatus in the slot where it competes (C or W/C).',
  },
  ...standardDefs('MAG'),
  magDef('mag-2', '2 squads', ['FX PH SR VT PB HB', 'PH FX VT SR HB PB']),
  magDef('mag-3', '3 squads', ['FX PH SR VT PB HB', 'PH SR FX PB HB VT', 'SR FX PH HB VT PB']),
  magDef('mag-3-wag', '3 squads, WAG overlap', ['FX VT PB PH SR HB', 'VT PB FX SR HB PH', 'PB FX VT HB PH SR']),
];

/** The patterns a session of this discipline can use, in the order the Squads screen lists them. */
export const patternsFor = (discipline: ArtisticDiscipline): PatternDef[] => PATTERNS.filter((p) => p.discipline === discipline);

/** New / unsaved sessions: WAG two flights on A/B equipment (8 squads), MAG one flight (6 squads). */
export const defaultPattern = (discipline: ArtisticDiscipline): RotationPattern => (discipline === 'WAG' ? 'parallel' : 'one');

/** The definition for `pattern`; an id that is unknown for this discipline reads as the discipline's default. */
export function patternDef(pattern: RotationPattern, discipline: ArtisticDiscipline): PatternDef {
  const defs = patternsFor(discipline);
  return defs.find((p) => p.id === pattern) ?? defs.find((p) => p.id === defaultPattern(discipline))!;
}

/**
 * Reads a stored pattern id. The removed `byes` pattern reads as `parallel` (same squad count); `removedByes` tells the Squads
 * screen to show its one-time notice. Anything else unknown returns null. With `discipline`, an id that belongs to the other
 * discipline is unknown too.
 */
export function readPattern(value: unknown, discipline?: ArtisticDiscipline): { pattern: RotationPattern; removedByes: boolean } | null {
  if (value === 'byes') return { pattern: 'parallel', removedByes: true };
  const found = PATTERNS.find((p) => p.id === value && (!discipline || p.discipline === discipline));
  return found ? { pattern: found.id, removedByes: false } : null;
}

export const isTwoFlights = (pattern: RotationPattern, discipline: ArtisticDiscipline): boolean => patternDef(pattern, discipline).flights;

export const squadCountFor = (pattern: RotationPattern, discipline: ArtisticDiscipline): number => patternDef(pattern, discipline).sequences.length;

/** The squad's columns in competing order, e.g. WAG squad B in 'parallel': VT-B UB-B BB-B FX-B (a BYE is a column too). */
export const rotationFor = (index: number, pattern: RotationPattern, discipline: ArtisticDiscipline): string[] =>
  [...(patternDef(pattern, discipline).sequences[index] ?? [])];

/** What an equipment column is called on paper (`VT-P` -> `VT-Platform`; BYE and unknown columns as they are). */
export const columnLabel = (column: string, pattern: RotationPattern, discipline: ArtisticDiscipline): string =>
  patternDef(pattern, discipline).equipment[column] ?? column;

/** Compete / warm-up slot cells of a timeline: `(W/C) UB` -> { phase: 'W/C', column: 'UB' }; BYE and `-` -> null. */
export function parseTimelineCell(cell: string): { phase: 'W' | 'C' | 'W/C'; column: string } | null {
  const m = /^\((W|C|W\/C)\) (\S+)$/.exec(cell.trim());
  return m ? { phase: m[1] as 'W' | 'C' | 'W/C', column: m[2] } : null;
}

const competes = (phase: string): boolean => phase === 'C' || phase === 'W/C';

/**
 * When (0-based) the squad reaches each column of its sequence: the index in the sequence, or - when the pattern has a timeline -
 * the timeline slot in which it competes there (C or W/C). A BYE is at its own position.
 */
export function slotsFor(index: number, pattern: RotationPattern, discipline: ArtisticDiscipline): number[] {
  const def = patternDef(pattern, discipline);
  const seq = def.sequences[index] ?? [];
  const line = def.timeline?.[index];
  if (!line) return seq.map((_, k) => k);
  const comp = line.flatMap((cell, slot) => {
    const c = parseTimelineCell(cell);
    return c && competes(c.phase) ? [slot] : [];
  });
  let k = 0;
  return seq.map((c, pos) => (c === BYE ? pos : comp[k++] ?? pos));
}

/** Slot (0-based) at which the squad competes on `code` (`VT` matches VT-P / VT-G / VT-A), or -1 when it never does. */
export function slotOf(index: number, code: string, pattern: RotationPattern, discipline: ArtisticDiscipline): number {
  const seq = rotationFor(index, pattern, discipline);
  const at = seq.findIndex((c) => c !== BYE && columnCode(c) === code);
  return at < 0 ? -1 : slotsFor(index, pattern, discipline)[at];
}

/** Earliest slot at which the squad competes on any of `codes` (for specialists), or -1. */
export function firstSlotOf(index: number, codes: readonly string[], pattern: RotationPattern, discipline: ArtisticDiscipline): number {
  const slots = codes.map((c) => slotOf(index, c, pattern, discipline)).filter((s) => s >= 0);
  return slots.length ? Math.min(...slots) : -1;
}

/** Squad indexes in the order they compete on `code` (ties: lower squad first). One flight MAG floor: A, F, E, D, C, B. */
export function arrivalOrder(code: string, pattern: RotationPattern, discipline: ArtisticDiscipline): number[] {
  const visits: { i: number; r: number }[] = [];
  for (let i = 0; i < squadCountFor(pattern, discipline); i++) {
    const r = slotOf(i, code, pattern, discipline);
    if (r >= 0) visits.push({ i, r });
  }
  return visits.sort((a, b) => a.r - b.r || a.i - b.i).map((v) => v.i);
}

/** First apparatus the squad competes on. */
export function firstApparatus(index: number, pattern: RotationPattern, discipline: ArtisticDiscipline): string {
  const first = rotationFor(index, pattern, discipline).find((c) => c !== BYE);
  return first ? columnCode(first) : '';
}

/** Flight rows of squad indexes to draw: two flights when the pattern has them. */
export function flightRows(pattern: RotationPattern, discipline: ArtisticDiscipline): number[][] {
  const n = squadCountFor(pattern, discipline);
  const all = Array.from({ length: n }, (_, i) => i);
  return isTwoFlights(pattern, discipline) ? [all.filter((i) => i % 2 === 0), all.filter((i) => i % 2 === 1)] : [all];
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
  const def = patternDef(pattern, discipline);
  const n = def.sequences.length;
  const equipment = Object.keys(def.equipment);
  // Who is on which equipment in each row: a squad's column in its sequence at that position, or - with a timeline - the
  // columns it competes on (C or W/C) in that slot.
  const at: (string | null)[][] = Array.from({ length: n }, (_, i) => {
    const line = def.timeline?.[i];
    if (!line) return def.sequences[i];
    return line.map((cell) => {
      const c = parseTimelineCell(cell);
      return c && competes(c.phase) ? c.column : null;
    });
  });
  const rounds = Math.max(0, ...at.map((r) => r.length));
  const rows: RotationRow[] = Array.from({ length: rounds }, (_, r) => {
    let total = 0;
    const cells = equipment.map((e): RotationCell | null => {
      const squads = at
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
