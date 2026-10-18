// Pure: the page models every export is described by. Content modules build these; the jsPDF renderer (render.ts) and the
// HTML preview (components/PdfPreview.tsx) both draw the SAME models, so the preview is the PDF's content. No jsPDF, no DOM.
// Printed exports are black and white only: `heavy` boxes are the values entered in ScoreFlippers.

/** US Letter in points. Landscape swaps the sides. */
export const LETTER = { w: 612, h: 792 } as const;
export const MARGIN = 36;

export const HEAVY_KEY = 'Heavy boxes are the scores entered in ScoreFlippers.';
export const SITE = 'unitedclubgymnastics.org';
export const BRAND_NAME = 'United Club Gymnastics';

export interface Meet {
  name: string;
  /** Shown as typed (e.g. "October 22–25, 2026"). */
  date: string;
}

export type ColumnKind = 'text' | 'box' | 'check';

export interface Column {
  id: string;
  header: string;
  /** Small second line under the header, e.g. "incl. ND". */
  sub?: string;
  kind: ColumnKind;
  /** Entered in ScoreFlippers: drawn with a heavy border. */
  heavy: boolean;
  /** Relative width (text columns share what the boxes leave). */
  weight: number;
}

/** Where the page sits in the preview's jump bar: one row per `group` (apparatus / event), one button per page. */
export interface JumpTarget {
  group: string;
  label: string;
}

export interface PageNumber {
  /** 1-based, within the document this page was built for (one session). */
  n: number;
  of: number;
}

export interface BasePage {
  jump: JumpTarget;
  /** Footer "Page n of m"; set by `numberPages`. */
  page: PageNumber;
  printedOn: string;
}

export interface ScoreRow {
  level: string;
  athlete: string;
  club: string;
  blank: boolean;
  /** Heavy double rule above this row (level changes). */
  levelBreak: boolean;
}

export interface ArtisticScorecardPage extends BasePage {
  kind: 'artistic-scorecard';
  meet: Meet;
  gym: string;
  session: string;
  band: {
    squad: string;
    apparatus: string;
    code: string;
    discipline: 'MAG' | 'WAG';
    rotation: number;
    /** `VT-A` when the pattern has A/B equipment, else ''. */
    equipment: string;
  };
  infinity: boolean;
  columns: Column[];
  rows: ScoreRow[];
  key: string;
}

export interface TntRow {
  name: string;
  club: string;
  level: string;
  blank: boolean;
  levelBreak: boolean;
}

export interface TntScorecardPage extends BasePage {
  kind: 'tnt-scorecard';
  meet: Meet;
  title: string;
  /** Session · Squad · rotation · page n of m. */
  subtitle: string;
  event: 'TR' | 'DM' | 'TU';
  squad: string;
  /** Page n of m of this squad's list. */
  squadPage: PageNumber;
  /** 1 pass (TR) or 2 (DM, TU): one row per pass. */
  passes: 1 | 2;
  columns: Column[];
  rows: TntRow[];
  key: string;
}

export interface SynchroPairRow {
  names: string;
  club: string;
  level: string;
  levelBreak: boolean;
}

export interface SynchroPage extends BasePage {
  kind: 'synchro';
  meet: Meet;
  title: string;
  subtitle: string;
  flight: string;
  /** Row 1 and row 2 box headers (heavy = all but the last of row 2). */
  row1: Column[];
  row2: Column[];
  pairs: SynchroPairRow[];
  key: string;
}

export interface ScheduleItem {
  label: string;
  time: string;
}

export interface RotationRow {
  label: string;
  /** Routines per column; null for an unused column. */
  counts: (number | null)[];
  levelBreak: boolean;
  alt: boolean;
}

export interface RotationSquad {
  letter: string;
  /** `Squad A`. */
  heading: string;
  /** Column headers in rotation order (`VT-A`); padded with '' to the page's column count. */
  columns: string[];
  rows: RotationRow[];
  /** Nothing placed in this squad. */
  empty: boolean;
}

export interface ArtisticRotationPage extends BasePage {
  kind: 'artistic-rotation';
  meet: Meet;
  /** `<meet> – Session 1 – Orange`. */
  title: string;
  /** `MAG – Orange Gym – Dev, Int, Adv`. */
  subtitle: string;
  schedule: ScheduleItem[];
  athleteCount: number;
  columnCount: number;
  squads: RotationSquad[];
  /** Layout units this page holds (see rotation content): the renderer scales row height to fit. */
  units: number;
}

export interface TntRotationTable {
  heading: string;
  /** Column headers. */
  columns: string[];
  /** Cells per row; `alt` tints every other row. */
  rows: { cells: string[]; alt: boolean }[];
  /** A table that carries on from the previous page. */
  continued: boolean;
}

export interface TntRotationPage extends BasePage {
  kind: 'tnt-rotation';
  meet: Meet;
  /** `T&T Session 1 – Purple · Thursday 7:30 AM`. */
  title: string;
  /** `<meet> · Purple Gym · NF, IF, HF`. */
  subtitle: string;
  tables: TntRotationTable[];
  units: number;
}

export type Page = ArtisticScorecardPage | TntScorecardPage | SynchroPage | ArtisticRotationPage | TntRotationPage;

export const isLandscape = (p: Page): boolean => p.kind === 'artistic-scorecard' || p.kind === 'tnt-scorecard';

/** One row per jump group, buttons in page order. */
export function jumpGroups(pages: Page[]): { group: string; items: { index: number; label: string }[] }[] {
  const out: { group: string; items: { index: number; label: string }[] }[] = [];
  pages.forEach((p, index) => {
    let g = out.find((x) => x.group === p.jump.group);
    if (!g) { g = { group: p.jump.group, items: [] }; out.push(g); }
    g.items.push({ index, label: p.jump.label });
  });
  return out;
}

/** What a content module returns: the page without its document-level numbering. */
export type Unnumbered<T extends BasePage> = Omit<T, 'page' | 'printedOn'>;

/** Widths of `columns` across `total`, in proportion to their weights. */
export function columnWidths(columns: Pick<Column, 'weight'>[], total: number): number[] {
  const sum = columns.reduce((t, c) => t + c.weight, 0) || 1;
  return columns.map((c) => (c.weight / sum) * total);
}

/** Any page before it is numbered. */
export type UnnumberedPage =
  | Unnumbered<ArtisticScorecardPage> | Unnumbered<TntScorecardPage> | Unnumbered<SynchroPage> | Unnumbered<ArtisticRotationPage> | Unnumbered<TntRotationPage>;

/** Number pages 1..N within one document and stamp the print date. */
export function numberPages(pages: UnnumberedPage[], printedOn: string): Page[] {
  return pages.map((p, i) => ({ ...p, page: { n: i + 1, of: pages.length }, printedOn }) as Page);
}

// --- shared geometry (points): the renderer and the preview size rows the same way ---------------------------------------

/** Artistic scorecard athlete-row height for `n` rows (15 rows: 25.6). */
export const artisticRowHeight = (n: number): number => Math.min(26, (LETTER.w - 2 * MARGIN - 130 - 26) / Math.max(n, 1));
/** T&T scorecard height of one athlete (all passes). */
export const tntAthleteHeight = (n: number): number => Math.min(40, (LETTER.w - MARGIN - 34 - (MARGIN + 50) - 20) / Math.max(n, 1));
/** Artistic rotation sheet: height of one layout unit on a page holding `units`. */
export const artisticRotationUnit = (units: number): number => Math.min(15, (LETTER.h - MARGIN - 20 - (MARGIN + 44 + 34)) / Math.max(units, 1));
/** T&T rotation sheet unit. */
export const tntRotationUnit = (units: number): number => Math.min(13.5, (LETTER.h - MARGIN - 20 - (MARGIN + 44 + 4)) / Math.max(units, 1));
