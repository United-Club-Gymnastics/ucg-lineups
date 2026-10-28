// Pure: the synchro score sheet. Portrait, 7 pairs a page, by flight. Row 1: A1-E1 A1-E2 A1-HD SJ ND; row 2: A2-E1 A2-E2 A2-HD
// Sync Final. Heavy = everything but Final. Heavy double rule where the level changes. Spec §6.
import { sessionTitle } from '../session-names';
import { HEAVY_KEY, type Column, type SynchroPage, type Unnumbered } from './model';
import type { TntSessionInput } from './session-input';
import { sheetQr } from './sheet-qr';

export const SYNCHRO_PAIRS_PER_PAGE = 7;

const box = (id: string, header: string, heavy: boolean): Column => ({ id, header, kind: 'box', heavy, weight: 1 });
export const ROW1: Column[] = [box('a1e1', 'A1 - E1', true), box('a1e2', 'A1 - E2', true), box('a1hd', 'A1 - HD', true), box('sj', 'SJ', true), box('nd', 'ND', true)];
export const ROW2: Column[] = [box('a2e1', 'A2 - E1', true), box('a2e2', 'A2 - E2', true), box('a2hd', 'A2 - HD', true), box('sync', 'Sync', true), box('final', 'Final', false)];

export function synchroPages(input: TntSessionInput): Unnumbered<SynchroPage>[] {
  const { meet, session } = input;
  const pages: Unnumbered<SynchroPage>[] = [];
  for (const [fi, flight] of input.flights.entries()) {
    const n = Math.max(1, Math.ceil(flight.pairs.length / SYNCHRO_PAIRS_PER_PAGE));
    for (let p = 0; p < n; p++) {
      const chunk = flight.pairs.slice(p * SYNCHRO_PAIRS_PER_PAGE, (p + 1) * SYNCHRO_PAIRS_PER_PAGE);
      pages.push({
        kind: 'synchro',
        meet,
        title: 'Synchro Score Sheet',
        subtitle: `${sessionTitle(session)} · Flight ${flight.name} · page ${p + 1} of ${n}`,
        flight: flight.name,
        row1: ROW1,
        row2: ROW2,
        pairs: chunk.map((q, ix) => ({
          names: q.names, club: q.clubs, level: q.level,
          levelBreak: ix > 0 && chunk[ix - 1].level !== q.level,
        })),
        key: HEAVY_KEY,
        jump: { group: 'SY', label: n > 1 ? `${flight.name}${p + 1}` : flight.name || String(fi + 1) },
        qr: sheetQr(meet.id, session.id, 'SY', flight.name || String(fi + 1), p + 1),
      });
    }
  }
  return pages;
}
