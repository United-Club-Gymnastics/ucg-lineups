// Pure planner for the one-time "Bring in earlier data" action. Before multi-meet, the work lived at top-level paths
// (settings/meet, athletes, clubs, sessions, squads, synchroSessions/main, emailSettings, emailLog) with clubLinks that had no meetId.
// This works out the writes that copy it into meets/{M}/… and attach the old club links to M. It reads nothing and deletes nothing.
import { DEFAULT_MEET_SETTINGS, type WriteOp } from './data/plan';
import { meetPaths } from './data/meet-paths';

export type LegacyData = Record<string, unknown>;

/** A legacy document. `path` is relative to the root, for example `athletes/WAG_0001` or `settings/meet`. */
export interface LegacyDoc {
  path: string;
  data: LegacyData;
}

export interface LegacySnapshot {
  /** Meet-specific documents at the top level (everything except club links). */
  docs: LegacyDoc[];
  /** `clubLinks/{token}` documents, as found (`id` is the token). */
  clubLinks: { id: string; data: LegacyData }[];
}

/** What the target meet already holds, by relative path (`athletes/WAG_0001`, `settings/meet`, …). */
export type MeetState = Map<string, LegacyData>;

export type LegacyKind = 'settings' | 'athletes' | 'clubs' | 'sessions' | 'squads' | 'synchro' | 'emailSettings' | 'emailLog';
export const KINDS: LegacyKind[] = ['settings', 'athletes', 'clubs', 'sessions', 'squads', 'synchro', 'emailSettings', 'emailLog'];
/** Kinds whose presence in the target meet counts as a conflict. */
export const CONFLICT_KINDS: LegacyKind[] = ['athletes', 'clubs', 'sessions', 'squads'];
export const KIND_LABEL: Record<LegacyKind, string> = {
  settings: 'Meet settings',
  athletes: 'Athletes',
  clubs: 'Clubs',
  sessions: 'Sessions',
  squads: 'Squads',
  synchro: 'Synchro session choices',
  emailSettings: 'Email settings',
  emailLog: 'Email log',
};
/** The top-level collection names the data layer reads. */
export const KIND_ROOT: Record<LegacyKind, string> = {
  settings: 'settings',
  athletes: 'athletes',
  clubs: 'clubs',
  sessions: 'sessions',
  squads: 'squads',
  synchro: 'synchroSessions',
  emailSettings: 'emailSettings',
  emailLog: 'emailLog',
};

export function kindOf(path: string): LegacyKind | null {
  const root = path.split('/')[0];
  return KINDS.find((k) => KIND_ROOT[k] === root) ?? null;
}

export type CopyMode = 'skip' | 'replace';

export interface KindCount {
  /** In the old data. */
  total: number;
  /** Written to the meet. */
  copy: number;
  /** Already in the meet and left alone ("skip" mode). */
  skipped: number;
  /** Already in the meet with identical content. */
  unchanged: number;
}

export interface LegacyCopyPlan {
  mode: CopyMode;
  meetId: string;
  ops: WriteOp[];
  counts: Record<LegacyKind, KindCount>;
  /** How many documents the meet already holds, per conflict kind. */
  existing: Record<(typeof CONFLICT_KINDS)[number], number>;
  /** The target meet already has athletes, clubs, sessions or squads. */
  hasConflicts: boolean;
  /** Settings fields written, and fields left as the meet had them. */
  settings: { written: string[]; kept: string[] };
  links: {
    total: number;
    /** Will get this meet's id now. */
    attach: number;
    /** Already belong to this meet (for example after an earlier run). */
    alreadyHere: number;
    /** Belong to another meet, or are not from the old data: untouched. */
    other: number;
    /** `attach + alreadyHere`: links that work for this meet. */
    working: number;
  };
  /** Old clubs whose meet copy has a different token (a club already in the meet, kept in "skip" mode). */
  tokenMismatch: number;
  /** Nothing to write: a second run changes nothing. */
  nothingToDo: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Structural equality that also understands Firestore Timestamps (isEqual) and Dates. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (isObj(a) && isObj(b) && typeof (a as { isEqual?: unknown }).isEqual === 'function') {
    return !!(a as { isEqual: (o: unknown) => boolean }).isEqual(b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && sameValue(a[k], b[k]));
  }
  return false;
}

/** A settings value the meet has not really set: missing, empty, or just the default a new meet starts with. */
function isBlank(key: string, v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  const def = (DEFAULT_MEET_SETTINGS as Record<string, unknown>)[key];
  return def !== undefined && sameValue(v, def);
}

const SETTINGS = 'settings/meet';
const hasMeetId = (d: LegacyData) => typeof d.meetId === 'string' && d.meetId !== '';

export function planLegacyCopy(snapshot: LegacySnapshot, meetState: MeetState, meetId: string, mode: CopyMode): LegacyCopyPlan {
  const root = meetPaths(meetId).root;
  const zero = (): KindCount => ({ total: 0, copy: 0, skipped: 0, unchanged: 0 });
  const counts = Object.fromEntries(KINDS.map((k) => [k, zero()])) as Record<LegacyKind, KindCount>;
  const ops: WriteOp[] = [];
  const settings = { written: [] as string[], kept: [] as string[] };

  for (const d of snapshot.docs) {
    const kind = kindOf(d.path);
    if (!kind) continue;
    const c = counts[kind];
    c.total++;
    const have = meetState.get(d.path);

    if (d.path === SETTINGS) {
      // Merge field by field. The meet's own name is the admin's choice and stays unless it is blank.
      const patch: LegacyData = {};
      for (const [key, value] of Object.entries(d.data)) {
        const cur = have?.[key];
        if (sameValue(cur, value)) continue;
        const overwrite = mode === 'replace' && (key !== 'meetName' || isBlank(key, cur));
        if (isBlank(key, cur) || overwrite) { patch[key] = value; settings.written.push(key); } else settings.kept.push(key);
      }
      if (Object.keys(patch).length) { ops.push({ path: `${root}/${d.path}`, data: patch, merge: true }); c.copy++; } else c.unchanged++;
      continue;
    }

    if (have) {
      if (sameValue(have, d.data)) { c.unchanged++; continue; }
      if (mode === 'skip') { c.skipped++; continue; }
    }
    ops.push({ path: `${root}/${d.path}`, data: d.data, merge: false });
    c.copy++;
  }

  // Club links: only those that belong to an old club (token match) and have no meet yet.
  const legacyTokens = new Set(
    snapshot.docs.filter((d) => kindOf(d.path) === 'clubs' && typeof d.data.token === 'string' && d.data.token !== '').map((d) => d.data.token as string),
  );
  const links = { total: snapshot.clubLinks.length, attach: 0, alreadyHere: 0, other: 0, working: 0 };
  for (const l of snapshot.clubLinks) {
    if (hasMeetId(l.data)) {
      if (l.data.meetId === meetId && legacyTokens.has(l.id)) links.alreadyHere++; else links.other++;
    } else if (legacyTokens.has(l.id)) {
      links.attach++;
      ops.push({ path: `clubLinks/${l.id}`, data: { meetId }, merge: true });
    } else links.other++;
  }
  links.working = links.attach + links.alreadyHere;

  let tokenMismatch = 0;
  for (const d of snapshot.docs) {
    if (kindOf(d.path) !== 'clubs') continue;
    const have = meetState.get(d.path);
    if (have && have.token !== d.data.token && legacyTokens.has(d.data.token as string)) tokenMismatch++;
  }
  // In "replace" mode the meet's club takes the old token, so there is no mismatch.
  if (mode === 'replace') tokenMismatch = 0;

  const existing = Object.fromEntries(
    CONFLICT_KINDS.map((k) => [k, [...meetState.keys()].filter((p) => kindOf(p) === k).length]),
  ) as LegacyCopyPlan['existing'];

  return {
    mode,
    meetId,
    ops,
    counts,
    existing,
    hasConflicts: CONFLICT_KINDS.some((k) => existing[k] > 0),
    settings,
    links,
    tokenMismatch,
    nothingToDo: ops.length === 0,
  };
}
