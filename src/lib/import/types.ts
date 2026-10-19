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
  /** `s1-orange` / `mag-finals--orange`, or '' when the export had no session. */
  sessionId: string;
  /** WAG/MAG: Included apparatus codes. T&T: Included event codes (same keys as `tnt`). */
  apparatus: string[];
  /** T&T only: level code (NF/IF/HF) for each Included event. */
  tnt?: TnTLevels;
  /** Has at least one Included apparatus / event. */
  competes: boolean;
}

export interface Session {
  /** `s<N>-<location>` for a session named `Session <N>` (unchanged since the first meet); else `<name slug>--<location slug>`. */
  id: string;
  /** The session name from the export ("Session 1", "MAG Finals"). Stored sessions from before names existed have only `number`; read them with `sessionName()`. */
  name: string;
  /** Gym colour or venue ("Orange", "Dupont"); '' when the export had no separator. */
  location: string;
  /** Alias of `location`, kept so older stored sessions and callers still work; new code reads `location`. */
  gym?: string;
  /** Only when the name is exactly `Session N` (ordering; the schedule key). */
  number?: number;
  discipline: Discipline;
  levelCodes: string[];
  /** Older T&T competition time (before the session schedule); moved into `scheduleOverride` by the Exports screen's one-time action. */
  competitionTime?: string;
  /** Optional per-session overrides of its session name's schedule row (date, stretch, warmups, competition). */
  scheduleOverride?: Partial<Record<'date' | 'stretch' | 'warmups' | 'competition', string>>;
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

/** The default location order (today's gym order). A meet's own order is `settings/meet.gymOrder` and may hold any location names. */
export const DEFAULT_GYM_ORDER = ['Green', 'Red', 'Yellow', 'Orange', 'Purple'];
