import { describe, expect, it } from 'vitest';
import { QR_DOT_RADIUS as D, QR_EYE_RADII as E, parseSheetUrl, qrModules, qrPathLayers, qrShapePath, qrShapes, sheetQr, sheetUrl, type QrShape } from '../../src/lib/pdf/sheet-qr';
import { parsePath } from '../../src/lib/pdf/svg-path';

describe('scorecard QR links', () => {
  it('round-trips, encoding each part', () => {
    const k = { meetId: 'AbC123', sessionId: 'mag-finals-orange', event: 'SY', squad: 'Flight 1/2', page: 3 };
    const url = sheetUrl(k);
    expect(url).toBe('https://scorecards.unitedclubgymnastics.org/#/s/AbC123/mag-finals-orange/SY/Flight%201%2F2/3');
    expect(parseSheetUrl(url)).toEqual(k);
    expect(parseSheetUrl('AbC123/s1-green/FX/A/1')).toEqual({ meetId: 'AbC123', sessionId: 's1-green', event: 'FX', squad: 'A', page: 1 });
  });

  it('rejects anything else', () => {
    for (const t of ['', 'https://example.com', 'a/b/c/d/0', 'a/b/c/d/x', 'a/b/c/1']) expect(parseSheetUrl(t)).toBeNull();
  });

  it('no link without both ids', () => {
    expect(sheetQr(undefined, 's1', 'FX', 'A', 1)).toBeUndefined();
    expect(sheetQr('m', '', 'FX', 'A', 1)).toBeUndefined();
  });

  it('a square module grid small enough to print at 48 pt: version 5 (37 modules) for a typical link', () => {
    const m = qrModules(sheetUrl({ meetId: 'x'.repeat(20), sessionId: 'xcel-platinum-finals-orange', event: 'FX', squad: 'A', page: 1 }));
    expect(m.length).toBe(37);
    expect(m.every((r) => r.length === m.length)).toBe(true);
    // Finder pattern corner is dark.
    expect(m[0][0] && m[0][6] && m[6][0]).toBe(true);
  });

  it('uses error correction M while that fits version 5, then L (same rule as the platform scorecard QR)', () => {
    // 84 bytes is M's version-5 limit; 85 to 106 drop to L at version 5; longer goes denser rather than failing.
    expect(qrModules('x'.repeat(84)).length).toBe(37);
    expect(qrModules('x'.repeat(85)).length).toBe(37);
    expect(qrModules('x'.repeat(106)).length).toBe(37);
    expect(qrModules('x'.repeat(107)).length).toBe(41);
    // A short link keeps M: at L the same text would fit a smaller version.
    expect(qrModules('x'.repeat(40)).length).toBe(29);
  });
});

// The UCG dot/eye drawing (same rules as ucg-platform tests/page-qr-shapes.test.ts).
const grid = (cells: [number, number][], n = 21): boolean[][] =>
  Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => cells.some(([cr, cc]) => cr === r && cc === c)));
const dots = (s: QrShape[]) => s.filter((x) => x.w < 3 && x.ink);

describe('QR drawing: rounded dots and pointed eyes, black only', () => {
  it('a lone dot is a full circle; touching dots round only their outer corners', () => {
    expect(dots(qrShapes(grid([[10, 10]])))).toEqual([{ x: 10, y: 10, w: 1, h: 1, r: [D, D, D, D], ink: true }]);
    expect(dots(qrShapes(grid([[10, 10], [10, 11]]))).map((x) => x.r)).toEqual([[D, 0, 0, D], [0, D, D, 0]]);
    expect(dots(qrShapes(grid([[10, 10], [11, 10]]))).map((x) => x.r)).toEqual([[D, D, 0, 0], [0, 0, D, D]]);
  });

  it('bleed lengthens a dot only towards a dark right / lower neighbour', () => {
    const d = dots(qrShapes(grid([[10, 10], [10, 11], [11, 10]]), 0.04));
    expect(d.map((x) => [x.w, x.h])).toEqual([[1.04, 1.04], [1, 1], [1, 1]]);
  });

  it('finder zones are drawn only as three eyes (ring, paper hole, pupil), the corner facing the centre sharp', () => {
    const all: [number, number][] = [];
    for (let r = 0; r < 21; r++) for (let c = 0; c < 21; c++) all.push([r, c]);
    expect(dots(qrShapes(grid(all)))).toHaveLength(21 * 21 - 3 * 49);
    const s = qrShapes(grid([]));
    expect(s).toHaveLength(9);
    const at = (x: number, y: number, w: number) => s.find((q) => q.x === x && q.y === y && q.w === w)!;
    expect(at(0, 0, 7)).toMatchObject({ r: [E.ring, E.ring, 0, E.ring], ink: true });
    expect(at(1, 1, 5)).toMatchObject({ r: [E.hole, E.hole, 0, E.hole], ink: false });
    expect(at(2, 2, 3)).toMatchObject({ r: [E.pupil, E.pupil, 0, E.pupil], ink: true });
    expect(at(14, 0, 7).r).toEqual([E.ring, E.ring, E.ring, 0]);
    expect(at(0, 14, 7).r).toEqual([E.ring, 0, E.ring, E.ring]);
  });

  it('paths use only M, L, C and Z (what the PDF renderer parses) and close', () => {
    for (const s of qrShapes(qrModules(sheetUrl({ meetId: 'm', sessionId: 's1-green', event: 'FX', squad: 'A', page: 1 })), 0.04)) {
      const d = qrShapePath(s);
      expect(d).toMatch(/^M [^A-Z]+( [LC] [^A-Z]+)+ Z$/);
      const steps = parsePath(d);
      expect(steps[0].op).toBe('M');
      expect(steps.at(-1)?.op).toBe('Z');
    }
  });
});

describe('QR preview layers', () => {
  it('joins the shapes into three paths in paint order: black dots and rings, white holes, black pupils', () => {
    const text = sheetUrl({ meetId: 'm', sessionId: 's1-green', event: 'FX', squad: 'A', page: 1 });
    const layers = qrPathLayers(text);
    expect(layers.map((l) => l.ink)).toEqual([true, false, true]);
    // Every shape is still there: one closed sub-path each.
    const shapes = qrShapes(qrModules(text), 0.04);
    expect(layers.reduce((n, l) => n + (l.d.match(/Z/g) ?? []).length, 0)).toBe(shapes.length);
    expect(qrPathLayers(text)).toBe(layers);
  });
});
