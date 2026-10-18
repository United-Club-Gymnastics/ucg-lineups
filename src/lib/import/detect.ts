import type { SheetData } from './read-workbook';
import type { ExportKind } from './types';

const has = (s: SheetData, ...hs: string[]) => hs.every((h) => s.headers.includes(h));
const hasAny = (s: SheetData, ...hs: string[]) => hs.some((h) => s.headers.includes(h));

/** Which export is this sheet from? Decided by its headers only (never the file name). */
export function detectSheet(s: SheetData): ExportKind | null {
  if (hasAny(s, 'tumbling_event_status', 'trampoline_event_status', 'dmt_event_status', 'synch_event_status')) return 'tnt';
  if (hasAny(s, 'ph_event_status', 'sr_event_status', 'hb_event_status', 'pb_event_status')) return 'mag';
  if (hasAny(s, 'bm_event_status', 'ub_event_status')) return 'wag';
  if (has(s, 'bib', 'firstname', 'lastname', 'type', 'club', 'session')) return 'athletes';
  if (has(s, 'club', 'email') && !hasAny(s, 'bib', 'firstname')) return 'clubEmails';
  return null;
}

export interface Detected {
  kind: ExportKind;
  sheet: SheetData;
}

/**
 * Pick the sheet to import from a workbook. For the club email list the first sheet whose name
 * contains "Nationals" wins, else the first matching sheet.
 */
export function detectWorkbook(sheets: SheetData[]): Detected | null {
  const found = sheets.map((sheet) => ({ sheet, kind: detectSheet(sheet) })).filter((x): x is Detected => x.kind !== null);
  if (found.length === 0) return null;
  const emails = found.filter((f) => f.kind === 'clubEmails');
  if (emails.length > 0) {
    return emails.find((f) => /nationals/i.test(f.sheet.name)) ?? emails[0];
  }
  return found[0];
}

export const KIND_LABEL: Record<ExportKind, string> = {
  athletes: 'Athletes export',
  wag: 'WAG export',
  mag: 'MAG export',
  tnt: 'T&T export',
  clubEmails: 'Club emails',
};
