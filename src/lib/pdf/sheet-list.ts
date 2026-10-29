// Pure: the list of scorecard sheets a session prints, for the scorecard photo app (scorecards.unitedclubgymnastics.org).
// Saved as `meets/{meetId}/sheetLists/{sessionId}` (public `get`, no `list`): the phone that scanned a sheet's QR reads it to
// say which sheet it is ("Session 1 – Green · Floor · Squad A"), the photo app's Storage rules accept an upload only for a key
// listed here, and admins see which sheets have no photo yet. Ids, letters and session names only: no athlete data.
import type { Discipline } from '../apparatus';
import type { Page } from './model';
import { parseSheetUrl, sheetPath } from './sheet-qr';

export interface SheetEntry {
  /** Apparatus code (FX, VT…), TR / DM / TU, or SY (synchro). */
  event: string;
  /** Squad letter; the flight name for synchro. */
  squad: string;
  /** 1-based within that squad's list for that event. */
  page: number;
  /** Pages in that squad's list for that event. */
  pages: number;
}

export interface SheetListDoc {
  name: string;
  location: string;
  discipline: Discipline;
  /** In print order. */
  sheets: SheetEntry[];
  /** `<event>/<squad>/<page>`, each part URL-encoded as in the QR link: the Storage path under the session. */
  keys: string[];
}

/** `<event>/<squad>/<page>` as the QR link and the photo app's Storage path spell it. */
export const sheetKey = (e: { event: string; squad: string; page: number }): string =>
  sheetPath({ meetId: 'm', sessionId: 's', ...e }).split('/').slice(2).join('/');

/** The sheets a session's scorecard pages carry a QR for, in print order (pages without one are skipped). */
export function sheetEntries(pages: Page[]): SheetEntry[] {
  const out: SheetEntry[] = [];
  for (const p of pages) {
    const k = p.qr ? parseSheetUrl(p.qr) : null;
    if (k) out.push({ event: k.event, squad: k.squad, page: k.page, pages: 0 });
  }
  const count = new Map<string, number>();
  for (const e of out) count.set(`${e.event}/${e.squad}`, Math.max(count.get(`${e.event}/${e.squad}`) ?? 0, e.page));
  return out.map((e) => ({ ...e, pages: count.get(`${e.event}/${e.squad}`) ?? e.page }));
}

export function sheetListDoc(session: { name: string; location: string; discipline: Discipline }, pages: Page[]): SheetListDoc {
  const sheets = sheetEntries(pages);
  return { name: session.name, location: session.location, discipline: session.discipline, sheets, keys: sheets.map(sheetKey) };
}

/** Same content as a saved list (Firestore does not keep key order, so compare field by field). */
export function sameSheetList(saved: unknown, list: SheetListDoc): boolean {
  if (!saved || typeof saved !== 'object') return false;
  const d = saved as Partial<SheetListDoc>;
  const sheets = Array.isArray(d.sheets) ? d.sheets : [];
  return d.name === list.name && d.location === list.location && d.discipline === list.discipline
    && Array.isArray(d.keys) && d.keys.join('\n') === list.keys.join('\n')
    && sheets.length === list.sheets.length
    && sheets.every((e, i) => e.event === list.sheets[i].event && e.squad === list.sheets[i].squad && e.page === list.sheets[i].page && e.pages === list.sheets[i].pages);
}
