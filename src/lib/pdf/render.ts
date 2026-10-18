// jsPDF renderer: draws the page models from the content modules (nothing is laid out here except geometry). Black and white only,
// Helvetica (a PDF standard font: licensed brand fonts are never embedded). Letter size; scorecards landscape, sheets portrait.
import { jsPDF } from 'jspdf';
import { MARK_PATHS, MARK_SIZE } from './logo-mark';
import {
  BRAND_NAME, LETTER, MARGIN, SITE, TIMELINE_ROW_UNITS, artisticRotationUnit, artisticRowHeight, columnWidths, isLandscape, tntAthleteHeight, tntRotationUnit,
  type ArtisticRotationPage, type ArtisticScorecardPage, type Column, type Page, type RotationTimeline, type SynchroPage, type TntRotationPage, type TntScorecardPage,
} from './model';
import { splitPair } from './pair';
import { parsePath } from './svg-path';

type Style = 'normal' | 'bold' | 'italic' | 'bolditalic';

const THIN = 0.75;
const HEAVY = 2.4;
const TINT = 0.86;
const TINT_ALT = 0.95;
const GREY_TEXT = 0.3;

/** Standard PDF fonts only cover Latin-1 (plus a few typographic marks): strip accents we can, drop the rest to '?'. */
const ALSO: Record<string, string> = { Ł: 'L', ł: 'l', Đ: 'D', đ: 'd', ı: 'i', Ħ: 'H', ħ: 'h' };
export function pdfSafe(s: string): string {
  return s.normalize('NFC').replace(/[^\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/g, (ch) => {
    const base = ALSO[ch] ?? ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return /^[\u0020-\u007e\u00a0-\u00ff]+$/.test(base) ? base : '?';
  });
}

interface TextOpts { size?: number; style?: Style; align?: 'left' | 'center' | 'right'; maxW?: number; gray?: number }

const xsOf = (widths: number[], left: number): number[] => widths.reduce<number[]>((a, _w, i) => (a.push(i === 0 ? left : a[i - 1] + widths[i - 1]), a), []);

class Pen {
  readonly doc: jsPDF;
  constructor(doc: jsPDF) { this.doc = doc; }

  line(x1: number, y1: number, x2: number, y2: number, w = THIN, dash?: [number, number]) {
    const d = this.doc;
    d.setLineWidth(w);
    d.setDrawColor(0);
    d.setLineDashPattern(dash ?? [], 0);
    d.line(x1, y1, x2, y2);
    d.setLineDashPattern([], 0);
  }

  rect(x: number, y: number, w: number, h: number, lw = THIN, fill?: number) {
    const d = this.doc;
    d.setLineWidth(lw);
    d.setDrawColor(0);
    if (fill !== undefined) { const g = Math.round(fill * 255); d.setFillColor(g, g, g); d.rect(x, y, w, h, 'FD'); } else d.rect(x, y, w, h, 'S');
  }

  fill(x: number, y: number, w: number, h: number, gray: number) {
    const g = Math.round(gray * 255);
    this.doc.setFillColor(g, g, g);
    this.doc.rect(x, y, w, h, 'F');
  }

  fit(s: string, maxW: number): string {
    const d = this.doc;
    let t = pdfSafe(s);
    if (maxW <= 0 || d.getTextWidth(t) <= maxW) return t;
    while (t.length > 1 && d.getTextWidth(`${t}...`) > maxW) t = t.slice(0, -1);
    return `${t.trimEnd()}...`;
  }

  /** `y` is the text's vertical centre. */
  text(s: string, x: number, y: number, o: TextOpts = {}) {
    const d = this.doc;
    const size = o.size ?? 9;
    d.setFont('helvetica', o.style ?? 'normal');
    d.setFontSize(size);
    d.setTextColor(Math.round((o.gray ?? 0) * 255));
    const t = o.maxW ? this.fit(s, o.maxW) : pdfSafe(s);
    d.text(t, x, y + size * 0.35, { align: o.align ?? 'left' });
  }

  width(s: string, size: number, style: Style = 'normal'): number {
    this.doc.setFont('helvetica', style);
    this.doc.setFontSize(size);
    return this.doc.getTextWidth(pdfSafe(s));
  }

  /** The UCG mark as black vectors, `size` pt square with its top-left at (x, y). */
  mark(x: number, y: number, size: number) {
    const k = size / MARK_SIZE;
    this.doc.setFillColor(0, 0, 0);
    for (const d of MARK_PATHS) {
      const lines: number[][] = [];
      let sx = 0, sy = 0, px = 0, py = 0;
      for (const st of parsePath(d)) {
        if (st.op === 'M') { sx = st.x; sy = st.y; px = st.x; py = st.y; }
        else if (st.op === 'L') { lines.push([st.x - px, st.y - py]); px = st.x; py = st.y; }
        else if (st.op === 'C') { lines.push([st.x1 - px, st.y1 - py, st.x2 - px, st.y2 - py, st.x - px, st.y - py]); px = st.x; py = st.y; }
      }
      this.doc.lines(lines, x + sx * k, y + sy * k, [k, k], 'F', true);
    }
  }

  /** Mark + "United Club / Gymnastics" lockup anchored at its left (or right) edge. Returns its width. */
  lockup(x: number, y: number, size: number, align: 'left' | 'right' = 'left'): number {
    const words = BRAND_NAME.split(' ');
    const l1 = words.slice(0, 2).join(' ').toUpperCase();
    const l2 = words.slice(2).join(' ').toUpperCase();
    const fs = size * 0.3;
    const tw = Math.max(this.width(l1, fs, 'bold'), this.width(l2, fs, 'bold'));
    const total = size + 5 + tw;
    const x0 = align === 'right' ? x - total : x;
    this.mark(x0, y, size);
    this.text(l1, x0 + size + 5, y + size * 0.36, { size: fs, style: 'bold' });
    this.text(l2, x0 + size + 5, y + size * 0.36 + fs * 1.25, { size: fs, style: 'bold' });
    return total;
  }

  /** A "Scratch?" tick box centred on (cx, cy). */
  checkBox(cx: number, cy: number, s: number) {
    this.rect(cx - s / 2, cy - s / 2, s, s, 1.1);
  }

  /** Heavy double rule across [x1, x2] at y. */
  doubleRule(x1: number, x2: number, y: number) {
    this.line(x1, y - 1.6, x2, y - 1.6, 1.3);
    this.line(x1, y + 1.0, x2, y + 1.0, 1.3);
  }
}

function footer(p: Pen, page: Page, w: number, h: number, center = false) {
  const y = h - MARGIN + 6;
  p.text(SITE, MARGIN, y, { size: 8, gray: GREY_TEXT });
  if (center) p.lockup(w / 2 - 50, y - 9, 16);
  const printed = page.kind === 'artistic-rotation' || page.kind === 'tnt-rotation' ? ` · Printed ${page.printedOn}` : '';
  p.text(`Page ${page.page.n} of ${page.page.of}${printed}`, w - MARGIN, y, { size: 8, align: 'right', gray: GREY_TEXT });
}

function keyLine(p: Pen, x: number, y: number, text: string) {
  p.rect(x, y - 4.5, 22, 9, HEAVY);
  p.text(text, x + 30, y, { size: 8.5 });
}

// --- artistic scorecard ---------------------------------------------------------------------------------------------

function drawArtisticScorecard(p: Pen, pg: ArtisticScorecardPage, W: number, H: number) {
  const L = MARGIN;
  const R = W - MARGIN;
  const CW = R - L;
  // header: date left, meet centre, logo + gym + session right
  p.text(pg.meet.date, L, L + 6, { size: 8.5 });
  p.text(`Printed ${pg.printedOn}`, L, L + 17, { size: 7.5, style: 'italic', gray: GREY_TEXT });
  p.text(pg.meet.name, W / 2, L + 8, { size: 12, style: 'bold', align: 'center', maxW: CW * 0.5 });
  p.lockup(R, L - 4, 26, 'right');
  p.text(pg.gym, R, L + 30, { size: 10, style: 'bolditalic', align: 'right' });
  p.text(pg.session, R, L + 42, { size: 10, style: 'bolditalic', align: 'right' });

  // band: squad letter, apparatus, rotation
  const bandY = L + 52;
  const bandH = 36;
  p.rect(L, bandY, CW, bandH, HEAVY);
  p.text('Squad', L + 12, bandY + bandH / 2, { size: 12, style: 'bold' });
  const sx = L + 12 + p.width('Squad ', 12, 'bold') + 4;
  const sw = Math.max(26, p.width(pg.band.squad, 16, 'bold') + 14);
  p.rect(sx, bandY + 6, sw, bandH - 12, 1.6);
  p.text(pg.band.squad, sx + sw / 2, bandY + bandH / 2, { size: 16, style: 'bold', align: 'center' });
  p.text(pg.band.apparatus.toUpperCase(), W / 2, bandY + bandH / 2, { size: 24, style: 'bold', align: 'center' });
  p.text(`${pg.band.discipline} · Rotation ${pg.band.rotation}${pg.band.equipment ? ` · ${pg.band.equipment}` : ''}`, R - 12, bandY + bandH / 2, { size: 11, align: 'right' });

  // table
  const top = bandY + bandH + 6;
  const headH = 26;
  const n = pg.rows.length;
  const rowH = artisticRowHeight(n);
  const widths = columnWidths(pg.columns, CW);
  const xs = xsOf(widths, L);
  pg.columns.forEach((c, i) => {
    p.rect(xs[i], top, widths[i], headH, c.heavy ? HEAVY : THIN);
    const mid = c.sub ? top + headH / 2 - 4 : top + headH / 2;
    const left = c.kind === 'text';
    p.text(c.header.toUpperCase(), left ? xs[i] + 4 : xs[i] + widths[i] / 2, mid, { size: 7.5, style: 'bold', align: left ? 'left' : 'center' });
    if (c.sub) p.text(c.sub, xs[i] + widths[i] / 2, top + headH / 2 + 6, { size: 6, align: 'center' });
  });
  pg.rows.forEach((r, ri) => {
    const y = top + headH + ri * rowH;
    pg.columns.forEach((c, i) => { if (!(c.kind === 'box' && c.heavy)) p.rect(xs[i], y, widths[i], rowH, THIN); });
    pg.columns.forEach((c, i) => { if (c.kind === 'box' && c.heavy) p.rect(xs[i], y, widths[i], rowH, HEAVY); });
    const cy = y + rowH / 2;
    pg.columns.forEach((c, i) => {
      if (c.kind === 'check') p.checkBox(xs[i] + widths[i] / 2, cy, 12);
      if (r.blank || c.kind !== 'text') return;
      const v = c.id === 'level' ? r.level : c.id === 'athlete' ? r.athlete : r.club;
      p.text(v, xs[i] + 4, cy, c.id === 'level' ? { size: 8, style: 'bold', maxW: widths[i] - 6 } : c.id === 'athlete' ? { size: 10.5, maxW: widths[i] - 8 } : { size: 8, style: 'italic', maxW: widths[i] - 8 });
    });
    if (r.levelBreak) p.doubleRule(L, R, y);
  });
  keyLine(p, L, top + headH + n * rowH + 14, pg.key);
  footer(p, pg, W, H);
}

// --- T&T scorecard ----------------------------------------------------------------------------------------------------

function sheetHeader(p: Pen, title: string, subtitle: string, meetName: string, meetDate: string, printedOn: string, W: number) {
  const L = MARGIN;
  const R = W - MARGIN;
  p.lockup(L, L - 4, 28);
  p.text(title, W / 2, L + 8, { size: 18, style: 'bold', align: 'center', maxW: (R - L) * 0.55 });
  p.text(subtitle, W / 2, L + 26, { size: 10, style: 'bold', align: 'center', maxW: (R - L) * 0.6 });
  p.text(meetName, R, L + 4, { size: 9, style: 'bold', align: 'right', maxW: (R - L) * 0.25 });
  p.text(meetDate, R, L + 15, { size: 8.5, align: 'right' });
  p.text(`Printed ${printedOn}`, R, L + 26, { size: 7.5, style: 'italic', align: 'right', gray: GREY_TEXT });
}

function drawTntScorecard(p: Pen, pg: TntScorecardPage, W: number, H: number) {
  const L = MARGIN;
  const R = W - MARGIN;
  const CW = R - L;
  sheetHeader(p, pg.title, pg.subtitle, pg.meet.name, pg.meet.date, pg.printedOn, W);
  const top = L + 50;
  const headH = 20;
  const n = pg.rows.length;
  const athleteH = tntAthleteHeight(n);
  const subH = athleteH / pg.passes;
  const widths = columnWidths(pg.columns, CW);
  const xs = xsOf(widths, L);
  pg.columns.forEach((c, i) => {
    p.rect(xs[i], top, widths[i], headH, c.heavy ? HEAVY : THIN);
    const left = c.id === 'name';
    p.text(c.header, left ? xs[i] + 4 : xs[i] + widths[i] / 2, top + headH / 2, { size: 8.5, align: left ? 'left' : 'center', style: c.heavy ? 'bold' : 'normal' });
  });
  pg.rows.forEach((r, ri) => {
    const y = top + headH + ri * athleteH;
    pg.columns.forEach((c, i) => {
      if (c.kind === 'box') {
        for (let k = 0; k < pg.passes; k++) p.rect(xs[i], y + k * subH, widths[i], subH, c.heavy ? HEAVY : THIN);
      } else p.rect(xs[i], y, widths[i], athleteH, THIN);
    });
    pg.columns.forEach((c, i) => {
      if (c.kind === 'check') p.checkBox(xs[i] + widths[i] / 2, y + athleteH / 2, 12);
      if (c.id === 'name' && !r.blank) {
        p.text(r.name, xs[i] + 4, y + athleteH / 2 - 6, { size: 11, style: 'bold', maxW: widths[i] - 8 });
        p.text(r.club, xs[i] + 4, y + athleteH / 2 + 7, { size: 8.5, style: 'italic', maxW: widths[i] - 8 });
      }
      if (c.id === 'level' && !r.blank) p.text(r.level, xs[i] + widths[i] / 2, y + athleteH / 2, { size: 10, style: 'bold', align: 'center' });
    });
    if (r.levelBreak) p.doubleRule(L, R, y);
  });
  keyLine(p, L, top + headH + n * athleteH + 14, pg.key);
  footer(p, pg, W, H);
}

// --- synchro ----------------------------------------------------------------------------------------------------------

function drawSynchro(p: Pen, pg: SynchroPage, W: number, H: number) {
  const L = MARGIN;
  const R = W - MARGIN;
  const CW = R - L;
  sheetHeader(p, pg.title, pg.subtitle, pg.meet.name, pg.meet.date, pg.printedOn, W);
  const top = L + 62;
  p.text('Scratch?', L, top - 8, { size: 7.5 });
  const chkW = 34;
  const nameW = 170;
  const lvW = 42;
  const boxW = (CW - chkW - nameW - lvW) / 5;
  const hh = 13;
  const bh = 22;
  const blockH = hh + bh + hh + bh;
  const gap = Math.min(10, (H - MARGIN - 52 - top - 7 * blockH) / 7);
  pg.pairs.forEach((q, i) => {
    const y = top + i * (blockH + gap);
    const bx = L + chkW + nameW + lvW;
    p.checkBox(L + chkW / 2, y + blockH / 2, 13);
    // the name and level cells span the header row and both box rows
    p.rect(L + chkW, y, nameW, hh, THIN);
    p.text('Pair / Club', L + chkW + 4, y + hh / 2, { size: 7.5 });
    p.rect(L + chkW + nameW, y, lvW, hh, THIN);
    p.text('Level', L + chkW + nameW + lvW / 2, y + hh / 2, { size: 7.5, align: 'center' });
    p.rect(L + chkW, y + hh, nameW, blockH - hh, THIN);
    const [n1, n2] = splitPair(q.names);
    const mid = y + hh + (blockH - hh) / 2;
    p.text(n2 ? `${n1} &` : n1, L + chkW + 4, mid - 15, { size: 10, style: 'bold', maxW: nameW - 8 });
    if (n2) p.text(n2, L + chkW + 4, mid - 3, { size: 10, style: 'bold', maxW: nameW - 8 });
    p.text(q.club, L + chkW + 4, mid + 13, { size: 8, style: 'italic', maxW: nameW - 8 });
    p.rect(L + chkW + nameW, y + hh, lvW, blockH - hh, THIN);
    p.text(q.level, L + chkW + nameW + lvW / 2, y + hh + (blockH - hh) / 2, { size: 11, style: 'bold', align: 'center' });
    const row = (cols: Column[], yy: number, h: number, label: boolean) => cols.forEach((c, k) => {
      p.rect(bx + k * boxW, yy, boxW, h, c.heavy ? HEAVY : THIN);
      if (label) p.text(c.header, bx + k * boxW + boxW / 2, yy + h / 2, { size: 7.5, align: 'center', style: c.heavy ? 'bold' : 'normal' });
    });
    row(pg.row1, y, hh, true);
    row(pg.row1, y + hh, bh, false);
    row(pg.row2, y + hh + bh, hh, true);
    row(pg.row2, y + hh + bh + hh, bh, false);
    if (q.levelBreak) p.doubleRule(L, R, y - gap / 2);
  });
  keyLine(p, L, H - MARGIN - 18, pg.key);
  footer(p, pg, W, H);
}

// --- rotation sheets ------------------------------------------------------------------------------------------------

function titleBlock(p: Pen, title: string, subtitle: string, W: number): number {
  p.text(title, W / 2, MARGIN + 10, { size: 16, style: 'bold', align: 'center', maxW: W - 2 * MARGIN });
  p.text(subtitle, W / 2, MARGIN + 30, { size: 10.5, style: 'bolditalic', align: 'center', maxW: W - 2 * MARGIN });
  return MARGIN + 44;
}

function drawArtisticRotation(p: Pen, pg: ArtisticRotationPage, W: number, H: number) {
  const L = MARGIN;
  const R = W - MARGIN;
  const CW = R - L;
  let y = titleBlock(p, pg.title, pg.subtitle, W);
  p.text('Schedule', L, y + 6, { size: 9, style: 'bold' });
  p.line(L, y + 11, L + p.width('Schedule', 9, 'bold'), y + 11, 0.6);
  p.text(`Session athlete count: ${pg.athleteCount}`, R, y + 6, { size: 9, style: 'bolditalic', align: 'right' });
  let sx = L;
  for (const it of pg.schedule) {
    const t = it.time || '--';
    p.text(t, sx, y + 21, { size: 9, style: 'bold' });
    const tw = p.width(t, 9, 'bold') + 5;
    p.text(it.label, sx + tw, y + 21, { size: 9 });
    sx += tw + p.width(it.label, 9) + 22;
  }
  y += 34;
  const unit = artisticRotationUnit(pg.units);
  const colW = pg.columnWidth;
  // Notes (when the pattern has them) sit to the right of each squad, so the table gets narrower.
  const noteW = pg.hasNotes ? 128 : 0;
  const TW = CW - (pg.hasNotes ? noteW + 6 : 0);
  const labelW = TW - pg.columnCount * colW;
  const fs = Math.min(9, unit * 0.62);
  for (const s of pg.squads) {
    const hh = unit * 1.5;
    const top = y;
    p.rect(L, y, TW, hh, HEAVY, TINT);
    p.text(s.heading.toUpperCase(), L + labelW / 2, y + hh / 2, { size: Math.min(11, hh * 0.6), style: 'bold', align: 'center' });
    s.columns.forEach((c, k) => {
      const x = L + labelW + k * colW;
      p.line(x, y, x, y + hh, 1.2);
      // Long names (VT-Platform) shrink to the column instead of running into the next one.
      const size = Math.min(fs, (fs * (colW - 4)) / Math.max(p.width(c, fs, 'bold'), 1));
      p.text(c, x + colW / 2, y + hh / 2, { size, style: 'bold', align: 'center' });
    });
    y += hh;
    if (s.empty) {
      p.rect(L, y, TW, unit, THIN);
      p.text('No club groups placed', L + 6, y + unit / 2, { size: fs, style: 'italic', gray: GREY_TEXT });
      y += unit;
    }
    s.rows.forEach((r) => {
      if (r.alt) p.fill(L, y, TW, unit, TINT_ALT);
      p.rect(L, y, TW, unit, THIN);
      p.line(L + labelW, y, L + labelW, y + unit, THIN);
      p.text(r.label, L + 5, y + unit / 2, { size: fs, style: 'bold', maxW: labelW - 8 });
      r.counts.forEach((v, k) => {
        const x = L + labelW + k * colW;
        if (k > 0) p.line(x, y, x, y + unit, THIN);
        if (v !== null) p.text(String(v), x + colW / 2, y + unit / 2, { size: fs, style: v ? 'bold' : 'normal', align: 'center', gray: v ? 0 : GREY_TEXT });
      });
      if (r.levelBreak) p.line(L, y, L + TW, y, 1, [3, 2]);
      y += unit;
    });
    if (s.notes.length > 0) {
      const nfs = Math.min(7.5, unit * 0.55);
      let ny = top + unit * 0.45 + nfs * 0.5;
      for (const note of s.notes) {
        for (const line of wrapText(p, note, noteW, nfs, 'italic')) {
          p.text(line, L + TW + 6, ny, { size: nfs, style: 'italic' });
          ny += nfs * 1.25;
        }
      }
    }
    y += unit * 0.8;
  }
  if (pg.timeline) drawTimeline(p, pg.timeline, L, y + unit * 0.4, Math.min(CW, 500), unit * TIMELINE_ROW_UNITS);
  footer(p, pg, W, H, true);
}

/** Greedy word wrap to `maxW` pt. */
function wrapText(p: Pen, text: string, maxW: number, size: number, style: Style): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && p.width(next, size, style) > maxW) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** The slot-by-slot warm-up / competition grid. Competing cells (C, W/C) are bold; black and white only. */
function drawTimeline(p: Pen, t: RotationTimeline, x: number, y: number, w: number, rh: number) {
  const letterW = 16;
  const cw = (w - letterW) / t.header.length;
  const fs = Math.min(7, rh * 0.62);
  p.rect(x, y, w, rh, THIN, TINT);
  t.header.forEach((h, k) => p.text(h, x + letterW + k * cw + cw / 2, y + rh / 2, { size: fs, style: 'bold', align: 'center' }));
  y += rh;
  for (const r of t.rows) {
    p.rect(x, y, w, rh, THIN);
    p.text(r.letter, x + letterW / 2, y + rh / 2, { size: fs, style: 'bold', align: 'center' });
    r.cells.forEach((cell, k) => {
      const cx = x + letterW + k * cw;
      p.line(cx, y, cx, y + rh, THIN);
      const compete = /^\((C|W\/C)\)/.test(cell);
      p.text(cell, cx + cw / 2, y + rh / 2, { size: fs, style: compete ? 'bold' : 'normal', align: 'center', maxW: cw - 2 });
    });
    y += rh;
  }
  p.line(x + letterW, y - rh * (t.rows.length + 1), x + letterW, y, 1.2);
}

function drawTntRotation(p: Pen, pg: TntRotationPage, W: number, H: number) {
  const L = MARGIN;
  const R = W - MARGIN;
  const CW = R - L;
  let y = titleBlock(p, pg.title, pg.subtitle, W) + 4;
  const unit = tntRotationUnit(pg.units);
  const fs = Math.min(8.5, unit * 0.65);
  for (const t of pg.tables) {
    p.text(t.continued ? `${t.heading} (continued)` : t.heading, L, y + unit * 0.7, { size: Math.min(11, unit * 0.85), style: 'bolditalic' });
    y += unit * 1.4;
    const wide = t.columns.length === 7;
    const weights = wide ? [3.4, 4.2, 0.8, 0.8, 0.8, 0.8, 0.8] : [1.2, 4, 4.6, 1];
    const widths = columnWidths(weights.map((weight) => ({ weight })), CW);
    const xs = xsOf(widths, L);
    const numeric = (i: number) => (wide ? i >= 2 : i === 3);
    t.columns.forEach((c, i) => {
      p.rect(xs[i], y, widths[i], unit, THIN, TINT);
      p.text(c, numeric(i) ? xs[i] + widths[i] / 2 : xs[i] + 4, y + unit / 2, { size: fs, style: 'bold', align: numeric(i) ? 'center' : 'left' });
    });
    y += unit;
    for (const r of t.rows) {
      if (r.alt) p.fill(L, y, CW, unit, TINT_ALT);
      p.rect(L, y, CW, unit, THIN);
      r.cells.forEach((v, i) => {
        if (i > 0) p.line(xs[i], y, xs[i], y + unit, THIN);
        p.text(v, numeric(i) ? xs[i] + widths[i] / 2 : xs[i] + 4, y + unit / 2, { size: fs, align: numeric(i) ? 'center' : 'left', maxW: widths[i] - 6 });
      });
      y += unit;
    }
    y += unit * 0.8;
  }
  footer(p, pg, W, H, true);
}

// --- document -------------------------------------------------------------------------------------------------------

function drawPage(p: Pen, page: Page, W: number, H: number) {
  switch (page.kind) {
    case 'artistic-scorecard': return drawArtisticScorecard(p, page, W, H);
    case 'tnt-scorecard': return drawTntScorecard(p, page, W, H);
    case 'synchro': return drawSynchro(p, page, W, H);
    case 'artistic-rotation': return drawArtisticRotation(p, page, W, H);
    case 'tnt-rotation': return drawTntRotation(p, page, W, H);
  }
}

/** Draw every page, in order, into one document. */
export function renderPdf(pages: Page[], title = 'UCG Lineups', compress = true): jsPDF {
  const first = pages[0];
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: first && isLandscape(first) ? 'landscape' : 'portrait', compress });
  doc.setProperties({ title, creator: 'UCG Lineups' });
  const p = new Pen(doc);
  pages.forEach((page, i) => {
    const land = isLandscape(page);
    if (i > 0) doc.addPage('letter', land ? 'landscape' : 'portrait');
    drawPage(p, page, land ? LETTER.h : LETTER.w, land ? LETTER.w : LETTER.h);
  });
  if (pages.length === 0) doc.text('No pages.', MARGIN, MARGIN);
  return doc;
}

export const pdfBytes = (pages: Page[], title?: string): ArrayBuffer => renderPdf(pages, title).output('arraybuffer');
