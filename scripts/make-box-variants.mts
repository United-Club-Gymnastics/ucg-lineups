// Sample pages for choosing how the heavy "entered in ScoreFlippers" boxes are drawn: `npx tsx scripts/make-box-variants.mts <out dir>`
// Writes variant-A.pdf and variant-B.pdf (invented data): one artistic page with a level change, one T&T DM page (two rows per
// athlete) with a level change, and one synchro page with a level change. The default is HEAVY_BOX_STYLE in src/lib/pdf/model.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { sessionPages } from '../src/lib/pdf/collate.ts';
import type { Page } from '../src/lib/pdf/model.ts';
import { renderPdf } from '../src/lib/pdf/render.ts';
import { buildArtisticSessionInput, buildTntSessionInput } from '../src/lib/pdf/session-input.ts';
import { MEET, magFixture, tntFixture } from '../tests/pdf/fixtures.ts';

const out = process.argv[2];
if (!out) throw new Error('usage: make-box-variants.mts <out dir>');
mkdirSync(out, { recursive: true });
const printedOn = 'Oct 18, 2026';
const mag = magFixture();
const tnt = tntFixture();
const artistic = sessionPages('scorecards', { type: 'artistic', id: mag.session.id, number: 1, gym: 'Orange', input: buildArtisticSessionInput({ session: mag.session, athletes: mag.athletes, ordersByClub: mag.ordersByClub, stored: mag.stored, meet: MEET }) }, printedOn);
const tntPages = sessionPages('scorecards', { type: 'tnt', id: tnt.session.id, number: 1, gym: 'Purple', input: buildTntSessionInput({ session: tnt.session, athletes: tnt.athletes, stored: tnt.stored, pairs: tnt.pairs, meet: MEET }) }, printedOn);
// The fixture's flights are one level each, so build one mixed-level flight (what a host can make) for the level divide.
const tntInput = buildTntSessionInput({ session: tnt.session, athletes: tnt.athletes, stored: tnt.stored, pairs: tnt.pairs, meet: MEET });
const levels = ['NF', 'NF', 'IF', 'IF', 'IF', 'HF', 'HF'];
const mixed = { ...tntInput, flights: [{ name: 'A', pairs: levels.map((level, i) => ({ id: `p${i}`, names: `${'Ada Ben Cleo Dev Eli Fay Gus'.split(' ')[i]} Invented${i + 1}A & Hana Invented${i + 1}B`, clubs: i % 2 ? 'Jump Club Alpha' : 'Flipping Falcons', level })) }] };
const synchro = sessionPages('scorecards', { type: 'tnt', id: tnt.session.id, number: 1, gym: 'Purple', input: mixed }, printedOn).filter((p) => p.kind === 'synchro');
const breaks = (p: Page) => (p.kind === 'artistic-scorecard' || p.kind === 'tnt-scorecard' ? p.rows.some((r) => r.levelBreak) : p.kind === 'synchro' ? p.pairs.some((q) => q.levelBreak) : false);
const pick = [
  artistic.find((p) => p.kind === 'artistic-scorecard' && breaks(p)),
  tntPages.find((p) => p.kind === 'tnt-scorecard' && p.event === 'DM' && p.passes === 2 && breaks(p)),
  synchro.find((p) => breaks(p)),
];
if (pick.some((p) => !p)) throw new Error(`missing sample page: ${pick.map((p) => p?.kind ?? 'none').join(', ')}`);
for (const style of ['A', 'B'] as const) {
  const bytes = renderPdf(pick as Page[], `Heavy boxes, variant ${style}`, true, style).output('arraybuffer');
  writeFileSync(`${out}/variant-${style}.pdf`, Buffer.from(bytes));
  console.log(`variant-${style}.pdf`, pick.map((p) => p!.kind).join(' + '));
}
