import { describe, expect, it } from 'vitest';
import {
  BYE, PATTERNS, arrivalOrder, columnCode, columnLabel, defaultPattern, firstApparatus, flightRows, parseTimelineCell, patternDef, patternsFor,
  readPattern, rotationFor, routinesPerRotation, slotOf, slotsFor, squadCountFor, squadLetter,
} from '../../src/lib/rotation';
import { apparatusCodes } from '../../src/lib/squad-builder';

const letters = (xs: number[]) => xs.map(squadLetter).join('');

describe('pattern definitions', () => {
  it('each discipline lists its own patterns, standard ones first; ids are unique per discipline', () => {
    expect(patternsFor('WAG').map((p) => p.id)).toEqual(['one', 'parallel', 'wag-7']);
    expect(patternsFor('MAG').map((p) => p.id)).toEqual(['one', 'parallel', 'mag-2', 'mag-3', 'mag-3-wag']);
    expect(patternsFor('WAG').map((p) => p.label)).toEqual(['One flight · 4 squads', 'Two flights, A/B equipment · 8', '7 squads (2 vaults, 2 beams)']);
    expect(patternsFor('MAG').slice(2).map((p) => p.label)).toEqual(['2 squads', '3 squads', '3 squads, WAG overlap']);
    for (const d of ['WAG', 'MAG'] as const) {
      const ids = patternsFor(d).map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('defaults are unchanged: WAG two flights (8), MAG one flight (6)', () => {
    expect(defaultPattern('WAG')).toBe('parallel');
    expect(defaultPattern('MAG')).toBe('one');
    expect(squadCountFor('parallel', 'WAG')).toBe(8);
    expect(squadCountFor('one', 'MAG')).toBe(6);
  });

  it('only the existing two-flight pattern has flights', () => {
    expect(PATTERNS.filter((p) => p.flights).map((p) => `${p.discipline}:${p.id}`)).toEqual(['WAG:parallel', 'MAG:parallel']);
    expect(flightRows('wag-7', 'WAG')).toEqual([[0, 1, 2, 3, 4, 5, 6]]);
    expect(flightRows('mag-3', 'MAG')).toEqual([[0, 1, 2]]);
  });

  it('squad counts', () => {
    expect([squadCountFor('wag-7', 'WAG'), squadCountFor('mag-2', 'MAG'), squadCountFor('mag-3', 'MAG'), squadCountFor('mag-3-wag', 'MAG')]).toEqual([7, 2, 3, 3]);
  });

  it('every squad visits every apparatus once; no two squads on the same equipment in one rotation (no timeline)', () => {
    for (const def of PATTERNS) {
      const codes = apparatusCodes(def.discipline);
      def.sequences.forEach((seq) => {
        expect(seq.filter((c) => c !== BYE).map(columnCode).sort()).toEqual([...codes].sort());
        for (const c of seq) if (c !== BYE) expect(Object.keys(def.equipment)).toContain(c);
      });
      if (def.timeline) continue;
      const rounds = Math.max(...def.sequences.map((s) => s.length));
      for (let r = 0; r < rounds; r++) {
        const at = def.sequences.map((s) => s[r]).filter(Boolean);
        expect(new Set(at).size).toBe(at.length);
      }
    }
  });

  it('standard patterns are computed as before', () => {
    expect(rotationFor(2, 'one', 'WAG')).toEqual(['BB', 'FX', 'VT', 'UB']);
    expect(rotationFor(11, 'parallel', 'MAG')).toEqual(['HB-B', 'FX-B', 'PH-B', 'SR-B', 'VT-B', 'PB-B']);
  });
});

describe('WAG 7 squads (2 vaults, 2 beams): Julia\'s NE Regionals sheet', () => {
  it('equipment and names', () => {
    expect(Object.keys(patternDef('wag-7', 'WAG').equipment)).toEqual(['VT-P', 'VT-G', 'UB', 'BB-A', 'BB-B', 'FX']);
    expect(['VT-P', 'VT-G', 'UB', 'BB-A', 'BB-B', 'FX'].map((c) => columnLabel(c, 'wag-7', 'WAG'))).toEqual(['VT-Platform', 'VT-Ground', 'UB', 'BB-A', 'BB-B', 'FX']);
  });

  it('competing orders, BYE columns', () => {
    const seq = (i: number) => rotationFor(i, 'wag-7', 'WAG').join(' ');
    expect([0, 1, 2, 3, 4, 5, 6].map(seq)).toEqual([
      'VT-P UB BB-B FX',
      'BYE VT-G UB BB-A FX',
      'UB BB-A FX VT-P',
      'BB-A FX VT-P UB',
      'BYE BB-B FX VT-G UB',
      'FX VT-P UB BB-B',
      'BYE FX VT-G UB BB-A',
    ]);
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => firstApparatus(i, 'wag-7', 'WAG'))).toEqual(['VT', 'VT', 'UB', 'BB', 'BB', 'FX', 'FX']);
  });

  it('the exact 8-slot timeline grid', () => {
    expect(patternDef('wag-7', 'WAG').timeline!.map((r) => r.join(' | '))).toEqual([
      '(W) VT-P | (C) VT-P | (W/C) UB | (W) BB-B | (C) BB-B | (W) FX | (C) FX | -',
      'BYE | (W) VT-G | (C) VT-G | (W/C) UB | (W) BB-A | (C) BB-A | (W) FX | (C) FX',
      '(W) UB | (C) UB | (W) BB-A | (C) BB-A | (W) FX | (C) FX | (W) VT-P | (C) VT-P',
      '(W) BB-A | (C) BB-A | (W) FX | (C) FX | (W) VT-P | (C) VT-P | (W/C) UB | -',
      'BYE | (W) BB-B | (C) BB-B | (W) FX | (C) FX | (W) VT-G | (C) VT-G | (W/C) UB',
      '(W) FX | (C) FX | (W) VT-P | (C) VT-P | (W/C) UB | (W) BB-B | (C) BB-B | -',
      'BYE | (W) FX | (C) FX | (W) VT-G | (C) VT-G | (W/C) UB | (W) BB-A | (C) BB-A',
    ]);
  });

  it('the notes, exactly as printed on the sheet', () => {
    expect(patternDef('wag-7', 'WAG').notes).toEqual([
      ['UB/FX after Squad C'],
      ['Start warm-ups when Squad A starts competing.', 'UB/FX after Squad A'],
      ['FX after Squad E'],
      ['UB/FX after Squad G'],
      ['Start warm-ups when Squad D starts competing', 'UB/FX after Squad D'],
      ['UB after Squad B'],
      ['Bump touch warm-up once F starts competing', 'UB/FX after Squad F'],
    ]);
  });

  it('the timeline agrees with the competing orders, and nobody shares equipment in a slot', () => {
    const def = patternDef('wag-7', 'WAG');
    def.timeline!.forEach((line, i) => {
      expect(line).toHaveLength(8);
      const cells = line.map(parseTimelineCell);
      // competing columns in slot order = the sequence without its BYE
      const comp = cells.flatMap((c) => (c && (c.phase === 'C' || c.phase === 'W/C') ? [c.column] : []));
      expect(comp).toEqual(def.sequences[i].filter((c) => c !== BYE));
      // each competing slot is preceded by that squad's warm-up (W) of the same equipment, or is itself W/C
      cells.forEach((c, k) => { if (c?.phase === 'C') expect(cells[k - 1]).toMatchObject({ phase: 'W', column: c.column }); });
      // a BYE squad has BYE in slot 1 only
      expect(line[0] === BYE).toBe(def.sequences[i][0] === BYE);
    });
    for (let slot = 0; slot < 8; slot++) {
      const competing = def.timeline!.flatMap((line) => { const c = parseTimelineCell(line[slot]); return c && c.phase !== 'W' ? [c.column] : []; });
      expect(new Set(competing).size).toBe(competing.length);
    }
  });

  it('slots: when each squad competes on each apparatus', () => {
    expect(slotsFor(0, 'wag-7', 'WAG')).toEqual([1, 2, 4, 6]);
    expect(slotsFor(1, 'wag-7', 'WAG')).toEqual([0, 2, 3, 5, 7]); // BYE at its own position
    expect(slotOf(1, 'VT', 'wag-7', 'WAG')).toBe(2);
    expect(slotOf(6, 'BB', 'wag-7', 'WAG')).toBe(7);
    expect(slotOf(0, 'XX', 'wag-7', 'WAG')).toBe(-1);
  });

  it('arrival order = order squads compete, by compete slot', () => {
    expect(letters(arrivalOrder('VT', 'wag-7', 'WAG'))).toBe('ABFGDEC');
    expect(letters(arrivalOrder('UB', 'wag-7', 'WAG'))).toBe('CABFGDE');
    expect(letters(arrivalOrder('BB', 'wag-7', 'WAG'))).toBe('DECABFG');
    expect(letters(arrivalOrder('FX', 'wag-7', 'WAG'))).toBe('FGDECAB');
  });

  it('routines per rotation uses the competing (C and W/C) slots', () => {
    const counts = Array.from({ length: 7 }, (_, i) => ({ VT: i + 1, UB: i + 1, BB: i + 1, FX: i + 1 }));
    const s = routinesPerRotation('wag-7', 'WAG', counts, 12);
    expect(s.equipment).toEqual(['VT-P', 'VT-G', 'UB', 'BB-A', 'BB-B', 'FX']);
    expect(s.rows).toHaveLength(8);
    const who = (r: number) => s.rows[r].cells.map((c, k) => (c ? `${s.equipment[k]}:${c.squads.map((q) => q.letter).join('')}` : null)).filter(Boolean);
    expect(who(0)).toEqual([]); // slot 1: everyone is warming up
    expect(who(1)).toEqual(['VT-P:A', 'UB:C', 'BB-A:D', 'FX:F']);
    expect(who(2)).toEqual(['VT-G:B', 'UB:A', 'BB-B:E', 'FX:G']);
    expect(s.rows[1].total).toBe(1 + 3 + 4 + 6);
    expect(s.rows[0].total).toBe(0);
    // every squad appears once per apparatus across the 8 slots
    const seen = s.rows.flatMap((r) => r.cells.flatMap((c) => (c ? c.squads.map((q) => `${q.letter}${columnCode(c.equipment)}`) : [])));
    expect(new Set(seen).size).toBe(28);
    expect(seen).toHaveLength(28);
  });

  it('flags a squad over the cap in its competing slot', () => {
    const counts = Array.from({ length: 7 }, () => ({ VT: 1, UB: 1, BB: 1, FX: 1 }));
    counts[2].UB = 13;
    const s = routinesPerRotation('wag-7', 'WAG', counts, 12);
    expect(s.rows[1].cells[2]?.squads[0]).toMatchObject({ letter: 'C', count: 13, over: true });
  });
});

describe('MAG patterns', () => {
  const seq = (p: string, i: number) => rotationFor(i, p, 'MAG').join(' ');
  const order = (p: string) => ['FX', 'PH', 'SR', 'VT', 'PB', 'HB'].map((c) => letters(arrivalOrder(c, p, 'MAG')));
  it('2 squads', () => {
    expect([0, 1].map((i) => seq('mag-2', i))).toEqual(['FX PH SR VT PB HB', 'PH FX VT SR HB PB']);
    expect(order('mag-2')).toEqual(['AB', 'BA', 'AB', 'BA', 'AB', 'BA']);
  });
  it('3 squads', () => {
    expect([0, 1, 2].map((i) => seq('mag-3', i))).toEqual(['FX PH SR VT PB HB', 'PH SR FX PB HB VT', 'SR FX PH HB VT PB']);
    expect(order('mag-3')).toEqual(['ACB', 'BAC', 'CBA', 'ACB', 'BAC', 'CBA']);
  });
  it('3 squads, WAG overlap', () => {
    expect([0, 1, 2].map((i) => seq('mag-3-wag', i))).toEqual(['FX VT PB PH SR HB', 'VT PB FX SR HB PH', 'PB FX VT HB PH SR']);
    expect(order('mag-3-wag')).toEqual(['ACB', 'ACB', 'BAC', 'BAC', 'CBA', 'CBA']);
  });
  it('no BYE, no timeline, no notes, plain equipment names', () => {
    for (const id of ['mag-2', 'mag-3', 'mag-3-wag']) {
      const def = patternDef(id, 'MAG');
      expect(def.timeline).toBeUndefined();
      expect(def.notes).toBeUndefined();
      expect(def.sequences.flat()).not.toContain(BYE);
      expect(columnLabel('VT', id, 'MAG')).toBe('VT');
    }
  });
});

describe('reading stored ids', () => {
  it('known ids read as themselves for their own discipline', () => {
    expect(readPattern('wag-7', 'WAG')).toEqual({ pattern: 'wag-7', removedByes: false });
    expect(readPattern('mag-3-wag', 'MAG')).toEqual({ pattern: 'mag-3-wag', removedByes: false });
    expect(readPattern('one')).toEqual({ pattern: 'one', removedByes: false });
  });
  it('an id of the other discipline or a made-up id is unknown (null)', () => {
    expect(readPattern('wag-7', 'MAG')).toBeNull();
    expect(readPattern('mag-2', 'WAG')).toBeNull();
    expect(readPattern('nonsense', 'WAG')).toBeNull();
    expect(readPattern(7, 'WAG')).toBeNull();
  });
  it('the removed byes pattern still reads as parallel', () => {
    expect(readPattern('byes', 'WAG')).toEqual({ pattern: 'parallel', removedByes: true });
  });
  it('an unknown id used for layout falls back to the discipline default', () => {
    expect(patternDef('nonsense', 'WAG').id).toBe('parallel');
    expect(patternDef('wag-7', 'MAG').id).toBe('one');
    expect(squadCountFor('nonsense', 'MAG')).toBe(6);
  });
});
