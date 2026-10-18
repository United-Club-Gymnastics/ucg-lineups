// Pure: the artistic rotation sheet. Portrait, one page per session (a very large session continues on a second page at a
// squad boundary). Per squad: header row with the apparatus in rotation order, then one row per club group with its routine
// counts. Spec §6.
import { APPARATUS } from '../apparatus';
import { BYE, columnCode, rotationFor } from '../rotation';
import type { ArtisticRotationPage, RotationRow, RotationSquad, Unnumbered } from './model';
import type { ArtisticGroupInput, ArtisticSessionInput } from './session-input';

/** Layout units: a club row is 1, a squad header 1.5, the space between squads 0.8. A page holds up to this many. */
export const ROTATION_PAGE_UNITS = 60;
export const HEADER_UNITS = 1.5;
export const GAP_UNITS = 0.8;

export const groupLabel = (g: ArtisticGroupInput): string =>
  `${g.clubName} – ${g.levelCode}${!g.independent && g.groupCount > 1 ? ` · Group ${String.fromCharCode(65 + g.groupIndex)}` : ''}`;

interface Merged { label: string; levelCode: string; routines: Record<string, number> }

/** One row per club group; an independent's athletes of one level are one row (as on the original sheet). */
function mergedRows(groups: ArtisticGroupInput[]): Merged[] {
  const out: (Merged & { indep: boolean })[] = [];
  for (const g of groups) {
    const last = out[out.length - 1];
    if (g.independent && last?.indep && last.levelCode === g.levelCode && last.label === groupLabel(g)) {
      for (const [c, n] of Object.entries(g.routines)) last.routines[c] = (last.routines[c] ?? 0) + n;
      continue;
    }
    out.push({ label: groupLabel(g), levelCode: g.levelCode, routines: { ...g.routines }, indep: g.independent });
  }
  return out;
}

export function sessionLevelLine(input: ArtisticSessionInput): string {
  const present = new Set(input.squads.flatMap((s) => s.groups.map((g) => g.levelCode)));
  const ordered = input.session.levelCodes.filter((c) => present.has(c));
  const rest = [...present].filter((c) => !ordered.includes(c)).sort();
  return [...ordered, ...rest].join(', ');
}

export const squadUnits = (s: RotationSquad): number => HEADER_UNITS + Math.max(1, s.rows.length) + GAP_UNITS;

export function artisticRotationPages(input: ArtisticSessionInput): Unnumbered<ArtisticRotationPage>[] {
  const { session, pattern, meet } = input;
  const rots = input.squads.map((s) => rotationFor(s.index, pattern, session.discipline));
  const columnCount = Math.max(APPARATUS[session.discipline].length, ...rots.map((r) => r.length));

  const squads: RotationSquad[] = input.squads.map((s, i) => {
    const merged = mergedRows(s.groups);
    const rows: RotationRow[] = merged.map((m, ix) => ({
      label: m.label,
      counts: rots[i].map((c) => (c === BYE ? null : m.routines[columnCode(c)] ?? 0)),
      levelBreak: ix > 0 && merged[ix - 1].levelCode !== m.levelCode,
      alt: ix % 2 === 1,
    }));
    return {
      letter: s.letter,
      heading: `Squad ${s.letter}`,
      columns: [...rots[i], ...Array<string>(columnCount - rots[i].length).fill('')],
      rows,
      empty: rows.length === 0,
    };
  });

  const chunks: RotationSquad[][] = [[]];
  let used = 0;
  for (const s of squads) {
    const u = squadUnits(s);
    const cur = chunks[chunks.length - 1];
    if (cur.length > 0 && used + u > ROTATION_PAGE_UNITS) { chunks.push([]); used = 0; }
    chunks[chunks.length - 1].push(s);
    used += u;
  }

  const base = {
    meet,
    title: `${meet.name} – Session ${session.number} – ${session.gym}`.replace(/^ – /, ''),
    subtitle: `${session.discipline} – ${session.gym} Gym – ${sessionLevelLine(input)}`,
    schedule: [
      { label: 'Open Stretch', time: input.schedule.stretch },
      { label: 'Timed Warm-ups', time: input.schedule.warmups },
      { label: 'Competition', time: input.schedule.competition },
    ],
    athleteCount: input.athleteCount,
    columnCount,
  };
  return chunks.map((c, i) => ({
    kind: 'artistic-rotation' as const,
    ...base,
    squads: c,
    units: c.reduce((t, s) => t + squadUnits(s), 0),
    jump: { group: 'Rotation sheet', label: String(i + 1) },
  }));
}
