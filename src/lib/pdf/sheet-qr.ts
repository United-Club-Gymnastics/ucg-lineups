// Pure: the QR code printed on each scorecard (Julia 2026-10-28). It holds a link that names that exact sheet, for the scorecard
// photo app at scorecards.unitedclubgymnastics.org: scanning it opens the app on that sheet, and a photo of the sheet carries it.
//   https://scorecards.unitedclubgymnastics.org/#/s/<meetId>/<sessionId>/<event>/<squad>/<page>
//   event: the apparatus code (FX, PH, VT…), TR / DM / TU, or SY for a synchro flight; squad: the squad letter (synchro: flight name);
//   page: 1-based within that squad's list for that event (T&T and synchro lists can run to more than one page; artistic is always 1).
// No athlete names or other personal data: only ids that mean nothing without admin access.
import qrcode from 'qrcode-generator';

export const SCORECARDS_ORIGIN = 'https://scorecards.unitedclubgymnastics.org';

/** Printed QR side (pt): about 1.2 pt a module for a sheet link, readable from a phone photo of the whole page. */
export const QR_SIZE = 48;

export interface SheetKey {
  meetId: string;
  sessionId: string;
  event: string;
  squad: string;
  page: number;
}

const enc = (s: string) => encodeURIComponent(s);

/** The `<meetId>/<sessionId>/<event>/<squad>/<page>` path; each part URL-encoded. */
export const sheetPath = (k: SheetKey): string => [k.meetId, k.sessionId, k.event, k.squad, String(k.page)].map(enc).join('/');

export const sheetUrl = (k: SheetKey): string => `${SCORECARDS_ORIGIN}/#/s/${sheetPath(k)}`;

/** Reads a sheet link (or just its path) back; null when it is not one. For the photo app. */
export function parseSheetUrl(text: string): SheetKey | null {
  const m = /(?:#\/s\/|^)([^/#?\s]+)\/([^/#?\s]+)\/([^/#?\s]+)\/([^/#?\s]+)\/(\d+)$/.exec(text.trim());
  if (!m) return null;
  try {
    const [meetId, sessionId, event, squad] = m.slice(1, 5).map(decodeURIComponent);
    const page = Number(m[5]);
    return page >= 1 ? { meetId, sessionId, event, squad, page } : null;
  } catch {
    return null;
  }
}

/** The sheet's link, or undefined when the meet or session id is not known (samples, tests without ids): no QR is printed then. */
export const sheetQr = (meetId: string | undefined, sessionId: string | undefined, event: string, squad: string, page: number): string | undefined =>
  meetId && sessionId ? sheetUrl({ meetId, sessionId, event, squad, page }) : undefined;

/** The QR's dark modules (row-major, square), error correction M. No quiet zone: the renderer leaves the margin. */
export function qrModules(text: string): boolean[][] {
  const q = qrcode(0, 'M');
  q.addData(text, 'Byte');
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}
