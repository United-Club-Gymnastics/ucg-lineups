import { describe, expect, it } from 'vitest';
import { detectSheet, detectWorkbook } from '../../src/lib/import/detect';
import { cellToString, normalizeHeader, readWorkbook } from '../../src/lib/import/read-workbook';
import { ATH_HEADERS, MAG_HEADERS, TNT_HEADERS, WAG_HEADERS, makeWorkbook } from './helpers';

describe('normalizeHeader', () => {
  it('lower-cases, collapses whitespace and drops _x000d_ / line breaks', () => {
    expect(normalizeHeader('  First   Name ')).toBe('first name');
    expect(normalizeHeader('Athlete_x000d_\nGender')).toBe('athlete gender');
    expect(normalizeHeader('Athlete\r\nGender')).toBe('athlete gender');
  });
});

describe('cellToString', () => {
  it('handles rich text, formulas, hyperlinks, dates, numbers, blanks', () => {
    expect(cellToString({ richText: [{ text: 'Ab' }, { text: 'c ' }] })).toBe('Abc');
    expect(cellToString({ formula: 'A1', result: 42 })).toBe('42');
    expect(cellToString({ text: 'x@y.org', hyperlink: 'mailto:x@y.org' })).toBe('x@y.org');
    expect(cellToString(new Date('2026-04-01T00:00:00Z'))).toBe('2026-04-01');
    expect(cellToString(7)).toBe('7');
    expect(cellToString(null)).toBe('');
    expect(cellToString({ error: '#N/A' })).toBe('');
  });
});

describe('readWorkbook', () => {
  it('reads rows keyed by normalised header, keeping leading-zero bibs as text', async () => {
    const buf = await makeWorkbook({
      Sheet: [
        ['Bib', { richText: [{ text: 'Athlete\n' }, { text: 'Gender' }] }, 'Name'],
        ['0398', 'F', { richText: [{ text: 'Zed ' }, { text: 'Q' }] }],
        [null, null, null],
        [12, 'M', 'Al'],
      ],
    });
    const [s] = await readWorkbook(buf);
    expect(s.headers).toEqual(['bib', 'athlete gender', 'name']);
    expect(s.rows).toEqual([
      { bib: '0398', 'athlete gender': 'F', name: 'Zed Q' },
      { bib: '12', 'athlete gender': 'M', name: 'Al' },
    ]);
  });
});

describe('detection', () => {
  const sheet = (headers: string[], name = 'Sheet') => ({ name, headers: headers.map(normalizeHeader), rows: [] });
  it('recognises each export by headers', () => {
    expect(detectSheet(sheet(ATH_HEADERS))).toBe('athletes');
    expect(detectSheet(sheet(WAG_HEADERS))).toBe('wag');
    expect(detectSheet(sheet(MAG_HEADERS))).toBe('mag');
    expect(detectSheet(sheet(TNT_HEADERS))).toBe('tnt');
    expect(detectSheet(sheet(['Club', 'Email']))).toBe('clubEmails');
    expect(detectSheet(sheet(['Item', 'Purchaser']))).toBeNull();
  });
  it('copes with odd header cells read from a real workbook', async () => {
    const buf = await makeWorkbook({
      Sheet: [[' bib ', 'FIRSTNAME', 'Last_x000d_Name'.replace('_x000d_', '_x000d_ '), 'Type', ' Club\n', 'Session']],
    });
    // "Last Name" with a space is not "lastname": must NOT be detected as athletes
    expect(detectWorkbook(await readWorkbook(buf))).toBeNull();
    const ok = await makeWorkbook({ Sheet: [[' bib ', 'FIRSTNAME', 'LastName', 'Type', ' Club\n', 'Session']] });
    expect(detectWorkbook(await readWorkbook(ok))?.kind).toBe('athletes');
  });
  it('picks the Nationals sheet of the club emails workbook, else the first', () => {
    const emails = (name: string) => sheet(['Club', 'Email'], name);
    expect(detectWorkbook([emails('2026 Fall'), emails('2026 Nationals')])?.sheet.name).toBe('2026 Nationals');
    expect(detectWorkbook([emails('A'), emails('B')])?.sheet.name).toBe('A');
  });
});
