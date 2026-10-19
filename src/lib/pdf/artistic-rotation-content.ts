// Pure: the artistic rotation sheet. Portrait, one page per session (a very large session continues on a second page at a
// squad boundary). Per squad: header row with the apparatus in rotation order, then one row per club group with its routine
// counts. Spec §6.
import { locationLabel, sessionLocation, sessionTitle } from '../session-names';
import { APPARATUS } from '../apparatus';
import { BYE, columnCode, columnLabel, patternDef, rotationFor } from '../rotation';
import { TIMELINE_ROW_UNITS, type ArtisticRotationPage, type RotationRow, type RotationSquad, type RotationTimeline, type Unnumbered } from './model';
import type { ArtisticGroupInput, ArtisticSessionInput } from './session-input';

/** Layout units: a club row is 1, a squad header 1.5, the space between squads 0.8. A page holds up to this many. */
export const ROTATION_PAGE_UNITS = 60;
export const HEADER_UNITS = 1.5;
export const GAP_UNITS = 0.8;

export const groupLabel = (g: ArtisticGroupInput): string =>
  `${g.clubName} – ${g.levelCode}${!g.independent && g.groupCount > 1 ? ` · Group ${String.fromCharCode(65 + g.groupIndex)}` : ''}`;

interface Merged { label: string; levelCode: string; routines: Record<string, number>; athletes: string[]; indep: boolean }

/** Rows this small list their athletes by name (independents always do). */
export const NAME_ROW_MAX = 2;
/** A row with a names line is this many layout units tall (a plain row is 1). */
export const NAMES_ROW_UNITS = 1.6;

export const rowUnits = (r: RotationRow): number => (r.names ? NAMES_ROW_UNITS : 1);

/** One row per club group; an independent's athletes of one level are one row (as on the original sheet). */
function mergedRows(groups: ArtisticGroupInput[]): Merged[] {
  const out: Merged[] = [];
  for (const g of groups) {
    const last = out[out.length - 1];
    if (g.independent && last?.indep && last.levelCode === g.levelCode && last.label === groupLabel(g)) {
      for (const [c, n] of Object.entries(g.routines)) last.routines[c] = (last.routines[c] ?? 0) + n;
      last.athletes.push(...(g.athletes ?? []));
      continue;
    }
    out.push({ label: groupLabel(g), levelCode: g.levelCode, routines: { ...g.routines }, indep: g.independent, athletes: [...(g.athletes ?? [])] });
  }
  return out;
}

export function sessionLevelLine(input: ArtisticSessionInput): string {
  const present = new Set(input.squads.flatMap((s) => s.groups.map((g) => g.levelCode)));
  const ordered = input.session.levelCodes.filter((c) => present.has(c));
  const rest = [...present].filter((c) => !ordered.includes(c)).sort();
  return [...ordered, ...rest].join(', ');
}

/** Timeline: a header row plus a row per squad, each a little shorter than a club row, with a gap above. */
export const timelineUnits = (t: RotationTimeline): number => (t.rows.length + 1) * TIMELINE_ROW_UNITS + 1;

/** Equipment columns this wide (pt); names longer than 6 characters (`VT-Platform`) get a wider column. */
export const COLUMN_WIDTH = 46;
export const WIDE_COLUMN_WIDTH = 54;

export const squadUnits = (s: RotationSquad): number =>
  HEADER_UNITS + (s.rows.length === 0 ? 1 : s.rows.reduce((t, r) => t + rowUnits(r), 0)) + GAP_UNITS;

export function artisticRotationPages(input: ArtisticSessionInput): Unnumbered<ArtisticRotationPage>[] {
  const { session, pattern, meet } = input;
  const def = patternDef(pattern, session.discipline);
  const rots = input.squads.map((s) => rotationFor(s.index, pattern, session.discipline));
  const columnCount = Math.max(APPARATUS[session.discipline].length, ...rots.map((r) => r.length));
  // With BYE squads the BYE column comes first, so a squad without one starts a column later (as on the original sheets).
  const leading = def.sequences.some((q) => q.includes(BYE));
  const label = (c: string) => (c === BYE ? BYE : columnLabel(c, pattern, session.discipline));
  const pad = (cells: string[]) => {
    const gap = Array<string>(columnCount - cells.length).fill('');
    return leading ? [...gap, ...cells] : [...cells, ...gap];
  };
  const padCounts = (cells: (number | null)[]) => {
    const gap = Array<null>(columnCount - cells.length).fill(null);
    return leading ? [...gap, ...cells] : [...cells, ...gap];
  };
  const columnWidth = Object.values(def.equipment).some((n) => n.length > 6) ? WIDE_COLUMN_WIDTH : COLUMN_WIDTH;

  const squads: RotationSquad[] = input.squads.map((s, i) => {
    const merged = mergedRows(s.groups);
    const rows: RotationRow[] = merged.map((m, ix) => ({
      label: m.label,
      names: m.indep || m.athletes.length <= NAME_ROW_MAX ? [...m.athletes].sort((a, b) => a.localeCompare(b)).join(', ') : '',
      counts: padCounts(rots[i].map((c) => (c === BYE ? null : (m.routines[columnCode(c)] ?? 0)))),
      levelBreak: ix > 0 && merged[ix - 1].levelCode !== m.levelCode,
      alt: ix % 2 === 1,
    }));
    return {
      letter: s.letter,
      heading: `Squad ${s.letter}`,
      columns: pad(rots[i].map(label)),
      rows,
      empty: rows.length === 0,
      notes: def.notes?.[s.index] ?? [],
    };
  });
  const hasNotes = squads.some((s) => s.notes.length > 0);
  const timeline: RotationTimeline | null = def.timeline
    ? {
      header: Array.from({ length: Math.max(...def.timeline.map((r) => r.length)) }, (_, k) => String(k + 1)),
      rows: input.squads.map((s) => ({ letter: s.letter, cells: [...(def.timeline![s.index] ?? [])] })),
    }
    : null;

  const chunks: RotationSquad[][] = [[]];
  let used = 0;
  for (const s of squads) {
    const u = squadUnits(s);
    const cur = chunks[chunks.length - 1];
    if (cur.length > 0 && used + u > ROTATION_PAGE_UNITS) { chunks.push([]); used = 0; }
    chunks[chunks.length - 1].push(s);
    used += u;
  }
  // The timeline goes under the last squad; when it does not fit there it gets a page of its own.
  if (timeline && used + timelineUnits(timeline) > ROTATION_PAGE_UNITS && chunks[chunks.length - 1].length > 0) chunks.push([]);

  const base = {
    meet,
    title: `${meet.name} – ${sessionTitle(session)}`.replace(/^ – /, ''),
    subtitle: [session.discipline, locationLabel(sessionLocation(session)), sessionLevelLine(input)].filter(Boolean).join(' – '),
    schedule: [
      { label: 'Open Stretch', time: input.schedule.stretch },
      { label: 'Timed Warm-ups', time: input.schedule.warmups },
      { label: 'Competition', time: input.schedule.competition },
    ],
    athleteCount: input.athleteCount,
    columnCount,
    columnWidth,
    hasNotes,
  };
  return chunks.map((c, i) => {
    const last = i === chunks.length - 1;
    return {
      kind: 'artistic-rotation' as const,
      ...base,
      squads: c,
      timeline: last ? timeline : null,
      units: c.reduce((t, s) => t + squadUnits(s), 0) + (last && timeline ? timelineUnits(timeline) : 0),
      jump: { group: 'Rotation sheet', label: String(i + 1) },
    };
  });
}
