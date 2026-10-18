import { describe, expect, it } from 'vitest';
import { sessionPages } from '../../src/lib/pdf/collate';
import { isLandscape, jumpGroups } from '../../src/lib/pdf/model';
import { splitPair } from '../../src/lib/pdf/pair';
import { pdfBytes, pdfSafe, renderPdf } from '../../src/lib/pdf/render';
import { buildArtisticSessionInput, buildTntSessionInput } from '../../src/lib/pdf/session-input';
import { parsePath } from '../../src/lib/pdf/svg-path';
import { MARK_PATHS } from '../../src/lib/pdf/logo-mark';
import { MEET, magFixture, tntFixture, wagInfinityFixture } from './fixtures';

const mag = magFixture();
const wag = wagInfinityFixture();
const tnt = tntFixture();
const magSession = { type: 'artistic' as const, id: 'a', number: 1, gym: 'Orange', input: buildArtisticSessionInput({ ...mag, meet: MEET }) };
const wagSession = { type: 'artistic' as const, id: 'b', number: 2, gym: 'Green', input: buildArtisticSessionInput({ ...wag, meet: MEET }) };
const tntSession = { type: 'tnt' as const, id: 'c', number: 1, gym: 'Purple', input: buildTntSessionInput({ session: tnt.session, athletes: tnt.athletes, stored: tnt.stored, pairs: tnt.pairs, meet: MEET }) };

describe('the jsPDF renderer', () => {
  it('draws one PDF page per model page, in the right orientation', () => {
    for (const s of [magSession, wagSession, tntSession]) {
      for (const kind of ['scorecards', 'rotation'] as const) {
        const pages = sessionPages(kind, s, 'Oct 18, 2026');
        const doc = renderPdf(pages);
        expect(doc.getNumberOfPages()).toBe(pages.length);
        pages.forEach((p, i) => {
          const size = doc.getPageInfo(i + 1).pageContext.mediaBox;
          const w = size.topRightX - size.bottomLeftX;
          const h = size.topRightY - size.bottomLeftY;
          expect(w > h).toBe(isLandscape(p));
          expect(Math.round(Math.min(w, h))).toBe(612);
        });
      }
    }
  });

  it('is black and white only: no colour operators in the page streams', () => {
    for (const s of [magSession, wagSession, tntSession]) {
      for (const kind of ['scorecards', 'rotation'] as const) {
        const raw = renderPdf(sessionPages(kind, s, 'x'), 'x', false).output();
        expect(raw.startsWith('%PDF')).toBe(true);
        expect(raw).not.toMatch(/\d(?:\.\d+)? \d(?:\.\d+)? \d(?:\.\d+)? (?:rg|RG)\b/);
        expect(raw).not.toMatch(/ (?:k|K)\n/);
        expect(raw).toMatch(/\bHelvetica\b/);
        expect(raw).not.toMatch(/NAIGC/);
      }
    }
  });

  it('produces bytes for a combined document of several sessions', () => {
    const pages = [...sessionPages('scorecards', wagSession, 'x'), ...sessionPages('scorecards', tntSession, 'x')];
    const doc = renderPdf(pages);
    expect(doc.getNumberOfPages()).toBe(pages.length);
    expect(pdfBytes(pages).byteLength).toBeGreaterThan(1000);
  });

  it('renders no pages without throwing', () => {
    expect(renderPdf([]).getNumberOfPages()).toBe(1);
  });

  it('keeps text inside the standard font: accents stripped, unknown characters become ?', () => {
    expect(pdfSafe('José Muñoz')).toBe('José Muñoz');
    expect(pdfSafe('Łukasz Ğ')).toBe('Lukasz G');
    expect(pdfSafe('日本')).toBe('??');
    expect(pdfSafe('Session 1 – Orange')).toBe('Session 1 – Orange');
  });

  it('splits a pair into two lines', () => {
    expect(splitPair('Ada & Bo')).toEqual(['Ada', 'Bo']);
    expect(splitPair('Solo')).toEqual(['Solo', '']);
  });
});

describe('the UCG mark and the jump bar', () => {
  it('parses every mark path (absolute M L C H Z only)', () => {
    for (const d of MARK_PATHS) {
      const steps = parsePath(d);
      expect(steps[0].op).toBe('M');
      expect(steps.at(-1)!.op).toBe('Z');
    }
    expect(() => parsePath('M0 0 A1 1 0 0 1 2 2')).toThrow();
  });

  it('groups pages into one jump row per apparatus, squads in arrival order', () => {
    const rows = jumpGroups(sessionPages('scorecards', magSession, 'x'));
    expect(rows.map((r) => r.group)).toEqual(['FX', 'PH', 'SR', 'VT', 'PB', 'HB']);
    expect(rows[0].items.map((i) => i.index)).toEqual([...rows[0].items.keys()]);
    const t = jumpGroups(sessionPages('scorecards', tntSession, 'x'));
    expect(t.map((r) => r.group)).toEqual(['TR', 'DM', 'TU', 'SY']);
  });
});
