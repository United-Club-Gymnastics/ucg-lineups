// Pure: the QR code printed on each scorecard (Julia 2026-10-28). It holds a link that names that exact sheet, for the scorecard
// photo app at scorecards.unitedclubgymnastics.org: scanning it opens the app on that sheet, and a photo of the sheet carries it.
//   https://scorecards.unitedclubgymnastics.org/#/s/<meetId>/<sessionId>/<event>/<squad>/<page>
//   event: the apparatus code (FX, PH, VT…), TR / DM / TU, or SY for a synchro flight; squad: the squad letter (synchro: flight name);
//   page: 1-based within that squad's list for that event (T&T and synchro lists can run to more than one page; artistic is always 1).
// No athlete names or other personal data: only ids that mean nothing without admin access.
import qrcode from 'qrcode-generator';

export const SCORECARDS_ORIGIN = 'https://scorecards.unitedclubgymnastics.org';

/** Printed QR side (pt): about 1.3 pt a module for a sheet link (37 modules), readable from a phone photo of the whole page. */
export const QR_SIZE = 48;

/**
 * Densest code the printed size allows: version 5 (37 modules). Same rules as the UCG platform's scorecard page QR
 * (ucg-platform src/lib/page-qr-matrix.ts): error correction M (survives glare, a crease, moiré) while that keeps the code at
 * version 5 or lower, otherwise L (holds 106 bytes at version 5), so the squares stay as big as they can; drawn in the UCG QR
 * style (rounded dots that merge with their neighbours, pointed eyes) but black only: no logo, gradient, frame or text (those do
 * not read from a photo of the sheet at this size).
 */
export const QR_MAX_VERSION = 5;

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

const moduleCache = new Map<string, boolean[][]>();

/** The QR's dark modules (row-major, square): error correction M, or L when M would need more than version 5. No quiet zone:
 * the renderer leaves the margin. */
export function qrModules(text: string): boolean[][] {
  const hit = moduleCache.get(text);
  if (hit) return hit;
  const make = (level: 'M' | 'L') => {
    const q = qrcode(0, level);
    q.addData(text, 'Byte');
    q.make();
    return q;
  };
  let q = make('M');
  if ((q.getModuleCount() - 17) / 4 > QR_MAX_VERSION) q = make('L');
  const n = q.getModuleCount();
  const grid = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
  if (moduleCache.size > 500) moduleCache.clear();
  moduleCache.set(text, grid);
  return grid;
}

// --- drawing: the UCG dot/eye style, black only (copied from ucg-platform src/lib/page-qr-matrix.ts pageQrShapes /
// pageQrShapePath — keep in sync by hand; changed: works on qrModules' boolean grid) ------------------------------------------

/** One filled rounded rectangle of the drawn code, in module units (module = 1, origin top-left of the code). */
export interface QrShape {
  x: number; y: number; w: number; h: number;
  /** Corner radii: top-left, top-right, bottom-right, bottom-left. */
  r: [number, number, number, number];
  /** true = black ink; false = paper (the white hole inside a finder eye). */
  ink: boolean;
}

/** Corner radius of a dot's rounded corners, in modules (0.5 = a lone dot is a full circle). */
export const QR_DOT_RADIUS = 0.5;
/** Finder eye radii (ring, hole, pupil) in modules. */
export const QR_EYE_RADII = { ring: 1.8, hole: 1.1, pupil: 0.8 } as const;
/** How far a dot reaches into a dark right / lower neighbour (modules), so no viewer or printer shows a hairline seam. */
export const QR_BLEED = 0.04;

const inFinder = (n: number, r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

/**
 * The shapes to draw, in paint order: every dark module outside the three 7×7 finder zones as a 1×1 dot (a corner is round only
 * when both its adjacent sides have no dark neighbour, so touching dots merge into waves), then each finder as an eye (ring,
 * paper hole, pupil; the corner facing the code centre is sharp). `bleed` lengthens a dot towards a dark right / lower neighbour.
 */
export function qrShapes(m: boolean[][], bleed = 0): QrShape[] {
  const n = m.length;
  const on = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n && m[r][c] && !inFinder(n, r, c);
  const D = QR_DOT_RADIUS;
  const out: QrShape[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!on(r, c)) continue;
      const up = on(r - 1, c), dn = on(r + 1, c), lf = on(r, c - 1), rt = on(r, c + 1);
      out.push({
        x: c, y: r, w: 1 + (rt ? bleed : 0), h: 1 + (dn ? bleed : 0),
        r: [!up && !lf ? D : 0, !up && !rt ? D : 0, !dn && !rt ? D : 0, !dn && !lf ? D : 0], ink: true,
      });
    }
  }
  for (const corner of ['tl', 'tr', 'bl'] as const) {
    const x0 = corner === 'tr' ? n - 7 : 0;
    const y0 = corner === 'bl' ? n - 7 : 0;
    const radii = (v: number): [number, number, number, number] => (corner === 'tl' ? [v, v, 0, v] : corner === 'tr' ? [v, v, v, 0] : [v, 0, v, v]);
    out.push({ x: x0, y: y0, w: 7, h: 7, r: radii(QR_EYE_RADII.ring), ink: true });
    out.push({ x: x0 + 1, y: y0 + 1, w: 5, h: 5, r: radii(QR_EYE_RADII.hole), ink: false });
    out.push({ x: x0 + 2, y: y0 + 2, w: 3, h: 3, r: radii(QR_EYE_RADII.pupil), ink: true });
  }
  return out;
}

const K = 0.5523; // quarter circle as a cubic Bezier
const num = (v: number) => String(Number(v.toFixed(4)));

/** One shape as an SVG path `d` in module units, using only absolute M, L, C, Z (the subset `svg-path.ts` parses; no arcs). */
export function qrShapePath(s: QrShape): string {
  const [tl, tr, br, bl] = s.r;
  const { x, y, w, h } = s;
  const P = (...v: number[]) => v.map(num).join(' ');
  let d = `M ${P(x + tl, y)} L ${P(x + w - tr, y)}`;
  if (tr) d += ` C ${P(x + w - tr + K * tr, y, x + w, y + tr - K * tr, x + w, y + tr)}`;
  d += ` L ${P(x + w, y + h - br)}`;
  if (br) d += ` C ${P(x + w, y + h - br + K * br, x + w - br + K * br, y + h, x + w - br, y + h)}`;
  d += ` L ${P(x + bl, y + h)}`;
  if (bl) d += ` C ${P(x + bl - K * bl, y + h, x, y + h - bl + K * bl, x, y + h - bl)}`;
  d += ` L ${P(x, y + tl)}`;
  if (tl) d += ` C ${P(x, y + tl - K * tl, x + tl - K * tl, y, x + tl, y)}`;
  return `${d} Z`;
}

/**
 * The whole code as a few SVG paths for the on-screen preview, in paint order: consecutive shapes of one colour joined into one
 * path (dots and eye rings in black, the eye holes in white, the pupils in black). Hundreds of separate shapes per code, on
 * every page of a meet's preview, made the page crawl. Cached by text: the preview draws the same codes on every re-render.
 */
export function qrPathLayers(text: string): { d: string; ink: boolean }[] {
  const hit = layerCache.get(text);
  if (hit) return hit;
  const layers: { d: string; ink: boolean }[] = [];
  // Rings never overlap another eye's hole or pupil, so all holes can follow all rings, and all pupils the holes.
  const pass = (s: QrShape) => (s.ink ? (s.w === 3 && s.h === 3 ? 2 : 0) : 1);
  const shapes = qrShapes(qrModules(text), QR_BLEED).sort((a, b) => pass(a) - pass(b));
  for (const s of shapes) {
    const last = layers[layers.length - 1];
    if (last && last.ink === s.ink) last.d += ` ${qrShapePath(s)}`;
    else layers.push({ d: qrShapePath(s), ink: s.ink });
  }
  if (layerCache.size > 500) layerCache.clear();
  layerCache.set(text, layers);
  return layers;
}
const layerCache = new Map<string, { d: string; ink: boolean }[]>();
