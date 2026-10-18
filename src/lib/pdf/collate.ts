// Pure: which sessions go in which order, what the files are called, and a whole session's pages. Spec §6.
//  - one session: `Session 1 - Green - Scorecards.pdf` / `Session 1 - Green - Rotation Sheet.pdf`
//  - all sessions: scorecards by gym (the meet's gym order) then session number; rotation sheets by session number, then gym.
//  - "separate PDFs": a zip of the per-session files.
import { DEFAULT_GYM_ORDER } from '../import/types';
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
  | { type: 'artistic'; id: string; number: number; gym: string; input: ArtisticSessionInput }
  | { type: 'tnt'; id: string; number: number; gym: string; input: TntSessionInput };

export interface SessionKey {
  number: number;
  gym: string;
}

const rankIn = (gymOrder: string[]) => (g: string): number => {
  const i = gymOrder.findIndex((x) => x.toLowerCase() === g.toLowerCase());
  return i < 0 ? gymOrder.length : i;
};

/** Scorecards: every session of a gym together (the gym order), then session number. */
export function scorecardOrder<T extends SessionKey>(sessions: T[], gymOrder: string[] = DEFAULT_GYM_ORDER): T[] {
  const rank = rankIn(gymOrder);
  return [...sessions].sort((a, b) => rank(a.gym) - rank(b.gym) || a.gym.localeCompare(b.gym) || a.number - b.number);
}

/** Rotation sheets: session number first (every gym's Session 1, then Session 2...), then the gym order. */
export function rotationOrder<T extends SessionKey>(sessions: T[], gymOrder: string[] = DEFAULT_GYM_ORDER): T[] {
  const rank = rankIn(gymOrder);
  return [...sessions].sort((a, b) => a.number - b.number || rank(a.gym) - rank(b.gym) || a.gym.localeCompare(b.gym));
}

export const orderFor = <T extends SessionKey>(kind: ExportKind, sessions: T[], gymOrder?: string[]): T[] =>
  kind === 'scorecards' ? scorecardOrder(sessions, gymOrder) : rotationOrder(sessions, gymOrder);

const KIND_NAME: Record<ExportKind, string> = { scorecards: 'Scorecards', rotation: 'Rotation Sheet' };
const ALL_NAME: Record<ExportKind, string> = { scorecards: 'Scorecards', rotation: 'Rotation Sheets' };

export const sessionFileName = (kind: ExportKind, s: SessionKey): string => `Session ${s.number} - ${s.gym} - ${KIND_NAME[kind]}.pdf`;
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
  return orderFor(kind, sessions, gymOrder).map((session) => ({ file: sessionFileName(kind, session), session, pages: sessionPages(kind, session, printedOn) }));
}
