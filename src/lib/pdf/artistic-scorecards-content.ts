// Pure: artistic (MAG/WAG) scorecards. Landscape, one page per squad per apparatus, apparatus in Olympic order, squads in the
// order they arrive. Exactly 15 rows. Spec §6.
import { APPARATUS } from '../apparatus';
import { arrivalOrder, rotationFor, rotationIndexOf, columnCode } from '../rotation';
import { HEAVY_KEY, type ArtisticScorecardPage, type Column, type ScoreRow, type Unnumbered } from './model';
import type { ArtisticSessionInput } from './session-input';

export const SCORECARD_ROWS = 15;
export const INFINITY_CODE = 'Inf';

const text = (id: string, header: string, weight: number): Column => ({ id, header, kind: 'text', heavy: false, weight });
const box = (id: string, header: string, heavy: boolean, sub?: string): Column => ({ id, header, sub, kind: 'box', heavy, weight: 1 });
const SCRATCH: Column = { id: 'scratch', header: 'Scratch?', kind: 'check', heavy: false, weight: 0.9 };
const IDENTITY: Column[] = [text('level', 'Level', 0.6), text('athlete', 'Athlete', 3), text('club', 'Club', 3.2)];

/** SV and Final Score are entered in ScoreFlippers. */
export const STANDARD_COLUMNS: Column[] = [
  ...IDENTITY,
  box('sv', 'SV', true), box('nd', 'ND', false), box('j1', 'J1 Score', false, 'incl. ND'), box('j2', 'J2 Score', false, 'incl. ND'), box('final', 'Final Score', true),
  SCRATCH,
];

/** Infinity: SV is 10 + D-score. */
export const INFINITY_COLUMNS: Column[] = [
  ...IDENTITY,
  box('sv', 'SV', true, '10 + D-score'), box('e', 'E-score', false, 'incl. ND'), box('nd', 'ND', false), box('final', 'Final Score', true),
  SCRATCH,
];

export function artisticScorecardPages(input: ArtisticSessionInput): Unnumbered<ArtisticScorecardPage>[] {
  const { session, pattern, meet } = input;
  const pages: Unnumbered<ArtisticScorecardPage>[] = [];
  for (const { code, name } of APPARATUS[session.discipline]) {
    for (const i of arrivalOrder(code, pattern, session.discipline)) {
      const squad = input.squads[i];
      if (!squad) continue;
      const athletes = squad.groups.flatMap((g) => (g.order[code] ?? []).map((a) => ({ a, g })));
      if (athletes.length === 0) continue; // nobody on this apparatus in this squad: nothing to judge
      const infinity = athletes.every(({ g }) => g.levelCode === INFINITY_CODE);
      const rows: ScoreRow[] = athletes.map(({ a, g }, ix) => ({
        level: g.levelCode,
        athlete: a.name,
        club: g.clubName,
        blank: false,
        // Infinity squads are single-level, so no rule is ever drawn there.
        levelBreak: !infinity && ix > 0 && athletes[ix - 1].g.levelCode !== g.levelCode,
      }));
      // Always exactly 15 rows. A squad above 15 on an apparatus still lists everyone (flagged upstream).
      while (rows.length < SCORECARD_ROWS) rows.push({ level: '', athlete: '', club: '', blank: true, levelBreak: false });
      const rot = rotationFor(i, pattern, session.discipline);
      const r = rotationIndexOf(i, code, pattern, session.discipline);
      pages.push({
        kind: 'artistic-scorecard',
        meet,
        gym: `${session.gym} Gym`,
        session: `Session ${session.number} – ${session.gym}`,
        band: {
          squad: squad.letter,
          apparatus: name,
          code,
          discipline: session.discipline,
          rotation: r + 1,
          equipment: rot[r] !== columnCode(rot[r]) ? rot[r] : '',
        },
        infinity,
        columns: infinity ? INFINITY_COLUMNS : STANDARD_COLUMNS,
        rows,
        key: HEAVY_KEY,
        jump: { group: code, label: squad.letter },
      });
    }
  }
  return pages;
}
