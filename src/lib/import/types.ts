import type { Discipline } from '../apparatus';

export type { Discipline };

export type TnTCode = 'TR' | 'DM' | 'TU' | 'SY';
export type TnTLevels = Partial<Record<TnTCode, string>>;

export interface Athlete {
  /** `<DISC>_<club slug>_<name slug>`, e.g. `WAG_alpha-gymnastics_ada-test` (+ `_<YYYY-MM-DD>`
   *  birth date when two athletes in one club and discipline share a name). UCG doesn't use bibs. */
  id: string;
  discipline: Discipline;
  first: string;
  last: string;
  clubId: string;
  /** Full club name (the one that is always printed). */
  clubName: string;
  independent: boolean;
  levelCode: string;
  levelName: string;
  /** `s1-orange`, or '' when the export's session string could not be read. */
  sessionId: string;
  /** WAG/MAG: Included apparatus codes. T&T: Included event codes (same keys as `tnt`). */
  apparatus: string[];
  /** T&T only: level code (NF/IF/HF) for each Included event. */
  tnt?: TnTLevels;
  /** Has at least one Included apparatus / event. */
  competes: boolean;
}

export interface Session {
  id: string;
  number: number;
  gym: string;
  discipline: Discipline;
  levelCodes: string[];
  /** T&T: competition time for the rotation sheet title (typed on the Exports screen; an import keeps it). */
  competitionTime?: string;
}

export interface Club {
  /** Slug of the full club name. */
  id: string;
  name: string;
  emails: string[];
}

export interface ImportWarning {
  code: string;
  message: string;
}

export interface ImportModel {
  athletes: Athlete[];
  sessions: Session[];
  clubs: Club[];
  warnings: ImportWarning[];
}

export type Row = Record<string, string>;

export type ExportKind = 'athletes' | 'wag' | 'mag' | 'tnt' | 'clubEmails';

export const DEFAULT_GYM_ORDER = ['Green', 'Red', 'Yellow', 'Orange', 'Purple'];
