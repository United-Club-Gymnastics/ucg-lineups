import ExcelJS from 'exceljs';
import type { Row } from './types';

export interface SheetData {
  name: string;
  /** Normalised (lower-case, whitespace-collapsed) headers in column order. */
  headers: string[];
  /** Rows keyed by normalised header; every value is a trimmed string. */
  rows: Row[];
}

/** Lower-case a header, drop `_x000d_` escapes and line breaks, collapse whitespace. */
export function normalizeHeader(raw: string): string {
  return raw
    .replace(/_x000d_/gi, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Turn any ExcelJS cell value (rich text, formula, hyperlink, date, number…) into a trimmed string. */
export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.replace(/_x000d_/gi, '\n').trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return cellToString((v.richText as { text?: unknown }[]).map((t) => String(t.text ?? '')).join(''));
    }
    if ('result' in v) return cellToString(v.result);
    if ('text' in v) return cellToString(v.text);
    if ('error' in v) return '';
  }
  return '';
}

/** Read every sheet of an .xlsx into header-keyed string rows. Row 1 is the header. */
export async function readWorkbook(data: ArrayBuffer | Uint8Array): Promise<SheetData[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);
  const out: SheetData[] = [];
  for (const ws of wb.worksheets) {
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    const cols: { col: number; key: string }[] = [];
    const seen = new Set<string>();
    for (let c = 1; c <= ws.columnCount; c++) {
      const h = normalizeHeader(cellToString(headerRow.getCell(c).value));
      headers.push(h);
      if (h && !seen.has(h)) {
        seen.add(h);
        cols.push({ col: c, key: h });
      }
    }
    const rows: Row[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const rec: Row = {};
      let any = false;
      for (const { col, key } of cols) {
        const s = cellToString(row.getCell(col).value);
        rec[key] = s;
        if (s) any = true;
      }
      if (any) rows.push(rec);
    }
    out.push({ name: ws.name, headers: headers.filter(Boolean), rows });
  }
  return out;
}
