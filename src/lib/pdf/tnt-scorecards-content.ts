// Pure: T&T scorecards. Landscape, 10 athletes a page, per event TR, DM, TU with squads in the order they arrive (TR: A, C, B).
// Five blank rows end each squad's list, kept together on its last page with at least one athlete above them. Spec §6.
import { TNT_EVENT_NAME, TNT_EVENTS, rotationFor, squadLetter, type TntEvent } from '../tnt-squads';
import { HEAVY_KEY, type Column, type TntRow, type TntScorecardPage, type Unnumbered } from './model';
import type { TntPerson, TntSessionInput } from './session-input';

export const TNT_PAGE_ROWS = 10;
export const TNT_BLANKS = 5;

const text = (id: string, header: string, weight: number): Column => ({ id, header, kind: 'text', heavy: false, weight });
const box = (id: string, header: string, heavy: boolean): Column => ({ id, header, kind: 'box', heavy, weight: 1 });

const CHECK: Column = { id: 'scratch', header: 'Scratch?', kind: 'check', heavy: false, weight: 0.9 };
const IDENTITY: Column[] = [CHECK, text('name', 'Name / Club', 4.2), text('level', 'Level', 0.7)];

/** Trampoline: E1 E2 HD SJ ND are entered in ScoreFlippers, Final is not. */
export const TR_COLUMNS: Column[] = [...IDENTITY, box('e1', 'E1', true), box('e2', 'E2', true), box('hd', 'HD', true), box('sj', 'SJ', true), box('nd', 'ND', true), box('final', 'Final', false)];
/** Double Mini and Tumbling: E1 E2 E3 SJ ND, two rows per athlete (one per pass). */
export const PASS_COLUMNS: Column[] = [...IDENTITY, box('e1', 'E1', true), box('e2', 'E2', true), box('e3', 'E3', true), box('sj', 'SJ', true), box('nd', 'ND', true), box('final', 'Final', false)];

/** Squads in the order they reach `event` (TR: A, C, B). */
export const arrivalAt = (event: TntEvent): number[] =>
  [0, 1, 2].map((s) => ({ s, r: rotationFor(s).indexOf(event) })).sort((a, b) => a.r - b.r).map((x) => x.s);

/**
 * Split a squad's list into pages: 10 rows a page, the 5 blank rows together on the last page, and at least one athlete
 * above them. `null` is a blank row. An empty list has no pages.
 */
export function paginate<T>(list: T[], perPage = TNT_PAGE_ROWS, blanks = TNT_BLANKS): (T | null)[][] {
  if (list.length === 0) return [];
  const pages = Math.ceil((list.length + blanks) / perPage);
  const lastN = Math.max(1, list.length - perPage * (pages - 1));
  const head = list.slice(0, list.length - lastN);
  const out: (T | null)[][] = [];
  for (let i = 0; i < head.length; i += perPage) out.push(head.slice(i, i + perPage));
  out.push([...list.slice(list.length - lastN), ...Array<null>(blanks).fill(null)]);
  return out;
}

export function tntScorecardPages(input: TntSessionInput): Unnumbered<TntScorecardPage>[] {
  const { meet, session } = input;
  const sessionText = `Session ${session.number} – ${session.gym}`;
  const pages: Unnumbered<TntScorecardPage>[] = [];
  for (const event of TNT_EVENTS) {
    for (const s of arrivalAt(event)) {
      const squad = input.squads[s];
      if (!squad) continue;
      const chunks = paginate<TntPerson>(squad.order[event]);
      const rotation = rotationFor(s).indexOf(event) + 1;
      chunks.forEach((chunk, p) => {
        const rows: TntRow[] = chunk.map((a, ix) => ({
          name: a?.name ?? '',
          club: a?.clubName ?? '',
          level: a?.levels[event] ?? '',
          blank: !a,
          levelBreak: !!a && ix > 0 && !!chunk[ix - 1] && chunk[ix - 1]!.levels[event] !== a.levels[event],
        }));
        const letter = squadLetter(s);
        pages.push({
          kind: 'tnt-scorecard',
          meet,
          title: `${TNT_EVENT_NAME[event]} Score Sheet`,
          subtitle: `${sessionText} · Squad ${letter} · rotation ${rotation} · page ${p + 1} of ${chunks.length}`,
          event,
          squad: letter,
          squadPage: { n: p + 1, of: chunks.length },
          passes: event === 'TR' ? 1 : 2,
          columns: event === 'TR' ? TR_COLUMNS : PASS_COLUMNS,
          rows,
          key: HEAVY_KEY + (event === 'TR' ? '' : ' Two rows per athlete: one per pass.'),
          jump: { group: event, label: chunks.length > 1 ? `${letter}${p + 1}` : letter },
        });
      });
    }
  }
  return pages;
}
