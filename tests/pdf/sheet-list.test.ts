import { describe, expect, it } from 'vitest';
import type { Page } from '../../src/lib/pdf/model';
import { sameSheetList, sheetEntries, sheetKey, sheetListDoc } from '../../src/lib/pdf/sheet-list';
import { sheetUrl } from '../../src/lib/pdf/sheet-qr';

const page = (event: string, squad: string, n: number): Page => ({ qr: sheetUrl({ meetId: 'm1', sessionId: 's1-purple', event, squad, page: n }) } as Page);

describe('sheet lists for the scorecard photo app', () => {
  it('lists each QR sheet in print order with its page count, skipping pages without a QR', () => {
    const pages = [page('TR', 'A', 1), page('TR', 'A', 2), page('TR', 'C', 1), { qr: undefined } as Page, page('SY', 'Flight 1/2', 1)];
    expect(sheetEntries(pages)).toEqual([
      { event: 'TR', squad: 'A', page: 1, pages: 2 },
      { event: 'TR', squad: 'A', page: 2, pages: 2 },
      { event: 'TR', squad: 'C', page: 1, pages: 1 },
      { event: 'SY', squad: 'Flight 1/2', page: 1, pages: 1 },
    ]);
  });

  it('keys are the QR link\'s encoded event/squad/page', () => {
    expect(sheetKey({ event: 'SY', squad: 'Flight 1/2', page: 3 })).toBe('SY/Flight%201%2F2/3');
    const d = sheetListDoc({ name: 'Session 1', location: 'Purple', discipline: 'TNT' }, [page('DM', 'B', 1), page('SY', 'Novice Pairs', 1)]);
    expect(d.keys).toEqual(['DM/B/1', 'SY/Novice%20Pairs/1']);
    expect(d).toMatchObject({ name: 'Session 1', location: 'Purple', discipline: 'TNT' });
  });

  it('compares with a saved list regardless of key order', () => {
    const d = sheetListDoc({ name: 'Session 2', location: 'Green', discipline: 'WAG' }, [page('VT', 'A', 1), page('UB', 'A', 1)]);
    const saved = { keys: [...d.keys], sheets: d.sheets.map((e) => ({ pages: e.pages, page: e.page, squad: e.squad, event: e.event })), discipline: 'WAG', location: 'Green', name: 'Session 2' };
    expect(sameSheetList(saved, d)).toBe(true);
    expect(sameSheetList({ ...saved, keys: ['VT/A/1'] }, d)).toBe(false);
    expect(sameSheetList({ ...saved, name: 'Session 3' }, d)).toBe(false);
    expect(sameSheetList(null, d)).toBe(false);
  });
});
