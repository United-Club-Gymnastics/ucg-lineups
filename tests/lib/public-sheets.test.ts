// The public sheets page's data. Invented people only.
import { describe, expect, it } from 'vitest';
import { sessionPages, type SessionExportInput } from '../../src/lib/pdf/collate';
import { buildArtisticSessionInput, buildTntSessionInput } from '../../src/lib/pdf/session-input';
import { parsePublicSheet, publicSheetDoc, sheetKindOf, PUBLIC_SHEET_VERSION } from '../../src/lib/public-sheets';
import { MEET, magFixture, tntFixture } from '../pdf/fixtures';

// Every athlete carries an email (and a birth-date-like id suffix is not data): none of it may reach the public document.
const withEmails = <T extends { athletes: { first: string }[] }>(f: T): T => ({ ...f, athletes: f.athletes.map((a) => ({ ...a, email: `${a.first.toLowerCase()}@example.org` })) });
const mag = withEmails(magFixture());
const tnt = withEmails(tntFixture());
const artistic: SessionExportInput = { type: 'artistic', id: 's1-orange', name: 'Session 1', location: 'Orange', input: buildArtisticSessionInput({ ...mag, meet: MEET }) };
const tntInput: SessionExportInput = { type: 'tnt', id: 's1-purple', name: 'Session 1', location: 'Purple', input: buildTntSessionInput({ session: tnt.session, athletes: tnt.athletes, stored: tnt.stored, pairs: tnt.pairs, meet: MEET }) };

describe('public sheet documents', () => {
  it('the export inputs carry no athlete emails, so they publish; the page draws the same pages', () => {
    for (const input of [artistic, tntInput]) {
      const doc = publicSheetDoc('Session 1 – Orange', input);
      expect(doc.v).toBe(PUBLIC_SHEET_VERSION);
      expect(doc.input).not.toMatch(/@/);
      const back = parsePublicSheet({ ...doc, publishedAt: { toDate: () => new Date('2027-04-01T16:00:00Z') } })!;
      expect(back.title).toBe('Session 1 – Orange');
      expect(back.publishedAt?.toISOString()).toBe('2027-04-01T16:00:00.000Z');
      expect(sessionPages('scorecards', back.input, 'x')).toEqual(sessionPages('scorecards', input, 'x'));
      expect(sessionPages('rotation', back.input, 'x')).toEqual(sessionPages('rotation', input, 'x'));
    }
  });

  it('refuses to publish anything that looks like an email address', () => {
    const leaky = { ...artistic, name: 'Session 1 coach@example.org' } as SessionExportInput;
    expect(() => publicSheetDoc('Session 1', leaky)).toThrow(/contains an email address/);
  });

  it('reads only its own version and shape', () => {
    expect(parsePublicSheet(null)).toBeNull();
    expect(parsePublicSheet({ v: 2, title: 't', input: '{}' })).toBeNull();
    expect(parsePublicSheet({ v: 1, title: 't', input: 'not json' })).toBeNull();
    expect(parsePublicSheet({ v: 1, title: 't', input: '{"type":"other","input":{}}' })).toBeNull();
    expect(parsePublicSheet({ v: 1, title: 't', input: JSON.stringify(artistic) })?.publishedAt).toBeNull();
  });

  it('?doc= picks the sheets, rotation by default', () => {
    expect(sheetKindOf('scorecards')).toBe('scorecards');
    expect(sheetKindOf('rotation')).toBe('rotation');
    expect(sheetKindOf(null)).toBe('rotation');
    expect(sheetKindOf('anything')).toBe('rotation');
  });
});
