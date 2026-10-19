// Pure: which sessions go in which order, what the files are called, and a whole session's pages. Spec §6.
//  - one session: `<name> - <location> - Scorecards.pdf` / `... - Rotation Sheet.pdf` (e.g. `Session 1 - Green - Scorecards.pdf`)
//  - all sessions: scorecards by location (the meet's location order) then name; rotation sheets by name (natural order), then location.
//  - "separate PDFs": a zip of the per-session files.
import { DEFAULT_GYM_ORDER } from '../import/types';
import { sessionFileBase, sortByLocation, sortByName, type SessionRef } from '../session-names';
import { artisticRotationPages } from './artistic-rotation-content';
import { artisticScorecardPages } from './artistic-scorecards-content';
import { numberPages, type Page, type UnnumberedPage } from './model';
import type { ArtisticSessionInput, TntSessionInput } from './session-input';
import { synchroPages } from './synchro-sheet-content';
import { tntRotationPages } from './tnt-rotation-content';
import { tntScorecardPages } from './tnt-scorecards-content';

export type ExportKind = 'scorecards' | 'rotation';

/** One session's export input: artistic or T&T. */
export type SessionExportInput =
  | { type: 'artistic'; id: string; name: string; location: string; input: ArtisticSessionInput }
  | { type: 'tnt'; id: string; name: string; location: string; input: TntSessionInput };

export type SessionKey = SessionRef;

/** Scorecards: every session of a location together (the meet's location order), then name in natural order. */
export function scorecardOrder<T extends SessionKey>(sessions: T[], order: string[] = DEFAULT_GYM_ORDER): T[] {
  return sortByLocation(sessions, order);
}

/** Rotation sheets: name first in natural order (every location's Session 1, then Session 2...), then the location order. */
export function rotationOrder<T extends SessionKey>(sessions: T[], order: string[] = DEFAULT_GYM_ORDER): T[] {
  return sortByName(sessions, order);
}

export const orderFor = <T extends SessionKey>(kind: ExportKind, sessions: T[], order?: string[]): T[] =>
  kind === 'scorecards' ? scorecardOrder(sessions, order) : rotationOrder(sessions, order);

const KIND_NAME: Record<ExportKind, string> = { scorecards: 'Scorecards', rotation: 'Rotation Sheet' };
const ALL_NAME: Record<ExportKind, string> = { scorecards: 'Scorecards', rotation: 'Rotation Sheets' };

/** `<name> - <location> - Scorecards.pdf`: the export's own text plus the suffix, with characters a file name cannot hold removed. */
export const sessionFileName = (kind: ExportKind, s: SessionKey): string => `${sessionFileBase(s)} - ${KIND_NAME[kind]}.pdf`;
export const allSessionsFileName = (kind: ExportKind, ext: 'pdf' | 'zip'): string => `All Sessions - ${ALL_NAME[kind]}.${ext}`;
/** The pages of one session for one kind of export, numbered within that session. T&T: its scorecards, then its synchro sheets. */
export function sessionPages(kind: ExportKind, s: SessionExportInput, printedOn: string): Page[] {
  if (s.type === 'artistic') {
    const raw: UnnumberedPage[] = kind === 'scorecards' ? artisticScorecardPages(s.input) : artisticRotationPages(s.input);
    return numberPages(raw, printedOn);
  }
  const raw: UnnumberedPage[] = kind === 'scorecards' ? [...tntScorecardPages(s.input), ...synchroPages(s.input)] : tntRotationPages(s.input);
  return numberPages(raw, printedOn);
}

/** One document per session, in collation order, with its file name. */
export function collate(
  kind: ExportKind,
  sessions: SessionExportInput[],
  gymOrder: string[] | undefined,
  printedOn: string,
): { file: string; session: SessionExportInput; pages: Page[] }[] {
  const used = new Set<string>();
  return orderFor(kind, sessions, gymOrder).map((session) => {
    // Two sessions can differ only in characters a file name drops: keep both files (zip entries must be unique).
    let file = sessionFileName(kind, session);
    for (let n = 2; used.has(file.toLowerCase()); n++) file = sessionFileName(kind, session).replace(/\.pdf$/, ` (${n}).pdf`);
    used.add(file.toLowerCase());
    return { file, session, pages: sessionPages(kind, session, printedOn) };
  });
}
