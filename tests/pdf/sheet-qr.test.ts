import { describe, expect, it } from 'vitest';
import { parseSheetUrl, qrModules, sheetQr, sheetUrl } from '../../src/lib/pdf/sheet-qr';

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

  it('a square module grid small enough to print at 48 pt (at most 41 modules for a typical link)', () => {
    const m = qrModules(sheetUrl({ meetId: 'x'.repeat(20), sessionId: 'xcel-platinum-finals-orange', event: 'FX', squad: 'A', page: 1 }));
    expect(m.length).toBeLessThanOrEqual(41);
    expect(m.every((r) => r.length === m.length)).toBe(true);
    // Finder pattern corner is dark.
    expect(m[0][0] && m[0][6] && m[6][0]).toBe(true);
  });
});
