// Writes sample PDFs from invented data (no real athletes) so the layout can be looked at: `npx tsx scripts/make-sample-pdfs.mts <out dir>`
import { mkdirSync, writeFileSync } from 'node:fs';
import { collate, sessionPages, type SessionExportInput } from '../src/lib/pdf/collate.ts';
import { pdfBytes } from '../src/lib/pdf/render.ts';
import { buildArtisticSessionInput, buildTntSessionInput } from '../src/lib/pdf/session-input.ts';
import { MEET, mag3WagFixture, magFixture, tntFixture, wag7Fixture, wagInfinityFixture } from '../tests/pdf/fixtures.ts';

const out = process.argv[2];
if (!out) throw new Error('usage: make-sample-pdfs.mts <out dir>');
mkdirSync(out, { recursive: true });

const mag = magFixture();
const wag = wagInfinityFixture();
const wag7 = wag7Fixture();
const mag3 = mag3WagFixture();
const tnt = tntFixture();
const sessions: SessionExportInput[] = [
  { type: 'artistic', id: mag.session.id, number: 1, gym: 'Orange', input: buildArtisticSessionInput({ session: mag.session, athletes: mag.athletes, ordersByClub: mag.ordersByClub, stored: mag.stored, meet: MEET }) },
  { type: 'artistic', id: wag.session.id, number: 2, gym: 'Green', input: buildArtisticSessionInput({ session: wag.session, athletes: wag.athletes, ordersByClub: wag.ordersByClub, stored: wag.stored, meet: MEET }) },
  { type: 'artistic', id: wag7.session.id, number: 3, gym: 'Blue', input: buildArtisticSessionInput({ session: wag7.session, athletes: wag7.athletes, ordersByClub: wag7.ordersByClub, stored: wag7.stored, meet: MEET }) },
  { type: 'artistic', id: mag3.session.id, number: 4, gym: 'Teal', input: buildArtisticSessionInput({ session: mag3.session, athletes: mag3.athletes, ordersByClub: mag3.ordersByClub, stored: mag3.stored, meet: MEET }) },
  { type: 'tnt', id: tnt.session.id, number: 1, gym: 'Purple', input: buildTntSessionInput({ session: tnt.session, athletes: tnt.athletes, stored: tnt.stored, pairs: tnt.pairs, meet: MEET }) },
];
const printedOn = 'Oct 18, 2026';
for (const kind of ['scorecards', 'rotation'] as const) {
  for (const s of sessions) {
    const pages = sessionPages(kind, s, printedOn);
    const name = `${s.type}-${s.gym}-${kind}.pdf`; // artistic-Blue = WAG 7 squads, artistic-Teal = MAG 3 squads (WAG overlap)
    writeFileSync(`${out}/${name}`, Buffer.from(pdfBytes(pages)));
    console.log(name, pages.length, 'pages');
  }
  const all = collate(kind, sessions, undefined, printedOn);
  console.log(kind, 'collation:', all.map((x) => x.file).join(' | '));
}
