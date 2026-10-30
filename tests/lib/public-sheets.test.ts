// The public sheets page's data. Invented people only.
import { describe, expect, it } from 'vitest';
import { sessionPages, type SessionExportInput } from '../../src/lib/pdf/collate';
import { buildArtisticSessionInput, buildTntSessionInput } from '../../src/lib/pdf/session-input';
import { anonymizeIds, parsePublicSheet, publicSheetDoc, sheetKindOf, PUBLIC_SHEET_VERSION } from '../../src/lib/public-sheets';
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
      // No athlete ids (they can carry a birth date): opaque ones, and the pages below still come out the same.
      expect(doc.input).not.toMatch(/(WAG|MAG|TNT)_/);
      expect(doc.input).toMatch(/"p0000\d"/);
      const back = parsePublicSheet({ ...doc, publishedAt: { toDate: () => new Date('2027-04-01T16:00:00Z') } })!;
      expect(back.title).toBe('Session 1 – Orange');
      expect(back.publishedAt?.toISOString()).toBe('2027-04-01T16:00:00.000Z');
      expect(sessionPages('scorecards', back.input, 'x')).toEqual(sessionPages('scorecards', input, 'x'));
      expect(sessionPages('rotation', back.input, 'x')).toEqual(sessionPages('rotation', input, 'x'));
    }
  });

  it('athlete ids become opaque in their own order, birth-date suffixes and card keys included', () => {
    const json = JSON.stringify({
      a: 'WAG_alpha-gym_ada-test_2014-03-02', b: 'WAG_alpha-gym_ada-test_2015-07-09', c: 'MAG_beta_cy-test~2',
      key: 'indep::WAG_alpha-gym_ada-test_2014-03-02::0', again: 'MAG_beta_cy-test~2', session: 's1-orange',
    });
    expect(JSON.parse(anonymizeIds(json))).toEqual({ a: 'p00002', b: 'p00003', c: 'p00001', key: 'indep::p00002::0', again: 'p00001', session: 's1-orange' });
    const leaky = { ...artistic, name: 'Born 2014-03-02' } as SessionExportInput;
    expect(() => publicSheetDoc('Session 1', leaky)).toThrow(/date like a birth date/);
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
