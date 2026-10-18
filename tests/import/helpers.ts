import ExcelJS from 'exceljs';

type Cell = string | number | ExcelJS.CellValue;

/** Build an in-memory workbook from synthetic data. `sheets`: name -> rows (first row = header). */
export async function makeWorkbook(sheets: Record<string, Cell[][]>): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const r of rows) ws.addRow(r as ExcelJS.CellValue[]);
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

export const ATH_HEADERS = ['Bib', 'FirstName', 'LastName', 'Level', 'Type', 'Club', 'Session', 'SquadName', 'LevelShortName', 'DOB'];

export function athRow(o: { bib: string; first: string; last: string; level: string; short?: string; type: string; club: string; session: string; dob?: string }) {
  return [o.bib, o.first, o.last, o.level, o.type, o.club, o.session, 'IGNORED', o.short ?? '', o.dob ?? ''];
}

export const WAG_HEADERS = ['FirstName', 'LastName', 'Bib', 'CompLevel', 'VT_Event_Status', 'UB_Event_Status', 'BM_Event_Status', 'FX_Event_Status', 'Club_Name', 'DOB'];
export const MAG_HEADERS = ['FirstName', 'LastName', 'Bib', 'FX_Event_Status', 'PH_Event_Status', 'SR_Event_Status', 'VT_Event_Status', 'PB_Event_Status', 'HB_Event_Status'];
export const TNT_HEADERS = [
  'FirstName', 'LastName', 'Bib', 'Club_Name',
  'Tumbling_Level', 'Tumbling_Event_Status', 'Trampoline_Level', 'Trampoline_Event_Status',
  'Synch_Trampoline_Level', 'Synch_Event_Status', 'DMT_Level', 'DMT_Event_Status',
];
