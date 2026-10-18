// Local-only check against the real 2026 exports. Prints COUNTS ONLY — never names, emails or DOBs.
// Run: npx tsx scripts/check-real-exports.mts <folder>  (or UCG_EXPORTS_DIR=<folder>)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assembleInput } from '../src/lib/import/assemble.ts';
import { detectWorkbook, type Detected } from '../src/lib/import/detect.ts';
import { normalizeImport } from '../src/lib/import/normalize.ts';
import { readWorkbook } from '../src/lib/import/read-workbook.ts';

const dir = process.argv[2] ?? process.env.UCG_EXPORTS_DIR;
if (!dir) throw new Error('Pass the exports folder as an argument or set UCG_EXPORTS_DIR');
const wanted = ['Athletes_Export.xlsx', 'WAG_Export.xlsx', 'MAG_Export.xlsx', 'TnT_Export.xlsx', 'Club_Emails.xlsx'];

const found: Detected[] = [];
for (const f of readdirSync(dir).filter((n) => wanted.includes(n))) {
  const buf = readFileSync(join(dir, f));
  const d = detectWorkbook(await readWorkbook(new Uint8Array(buf)));
  console.log(`${f} -> ${d ? `${d.kind} (sheet "${d.sheet.name}", ${d.sheet.rows.length} rows)` : 'NOT RECOGNISED'}`);
  if (d) found.push(d);
}
const input = assembleInput(found);
if (!input) throw new Error('No athletes export found');
const m = normalizeImport(input);

const count = <T,>(xs: T[], f: (x: T) => string) => {
  const o: Record<string, number> = {};
  for (const x of xs) o[f(x)] = (o[f(x)] ?? 0) + 1;
  return o;
};
console.log('athletes total:', m.athletes.length);
console.log('by discipline:', count(m.athletes, (a) => a.discipline));
console.log('by level:', count(m.athletes, (a) => `${a.discipline}/${a.levelCode}`));
console.log('competes:', count(m.athletes, (a) => String(a.competes)));
console.log('independents:', m.athletes.filter((a) => a.independent).length);
console.log('Infinity athletes:', m.athletes.filter((a) => a.levelCode === 'Inf').length);
console.log('no session id:', m.athletes.filter((a) => !a.sessionId).length);
console.log('sessions:', m.sessions.length, 'by discipline:', count(m.sessions, (s) => s.discipline));
console.log('clubs:', m.clubs.length, '| with emails:', m.clubs.filter((c) => c.emails.length).length,
  '| max emails on one club:', Math.max(0, ...m.clubs.map((c) => c.emails.length)));
console.log('warnings:', m.warnings.length, count(m.warnings, (w) => w.code));
