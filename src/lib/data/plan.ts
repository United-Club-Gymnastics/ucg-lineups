import { diffAthletes, type ImportDiff, type StoredAthlete } from '../import/diff';
import { DEFAULT_GYM_ORDER, type ClubContact, type ImportModel } from '../import/types';
import { meetPaths } from './meet-paths';

export interface StoredClub {
  id: string;
  name: string;
  emails: string[];
  /** League Communications contacts (coaches and other roles); [] when none were imported. */
  contacts: ClubContact[];
  /** The club's private-link token from `clubTokens/{clubId}`; '' until its link has been published. */
  token: string;
}

export interface WriteOp {
  path: string;
  data: Record<string, unknown>;
  /** true: merge into the existing document (keeps fields this import does not own); false: replace it. */
  merge: boolean;
}

export const MAX_BATCH = 450;

export const DEFAULT_MEET_SETTINGS = {
  meetName: '',
  meetDate: '',
  /** null = no deadline; the club-order rules treat any non-timestamp as open. */
  orderDeadline: null as Date | null,
  gymOrder: DEFAULT_GYM_ORDER,
};

export interface ImportPlan {
  diff: ImportDiff;
  ops: WriteOp[];
  newClubs: number;
}

/**
 * Pure: work out every Firestore write an import needs. Unchanged athletes are not rewritten;
 * athletes missing from the import are flagged `removed: true`, never deleted; existing clubs keep
 * their emails (and contacts) when the import carries none; settings/meet defaults are written only when it does not
 * exist yet. Club tokens are NOT part of an import: a club has one token across all meets in
 * `clubTokens/{clubId}`, created the first time its link is published.
 */
export function planImport(
  model: ImportModel,
  existing: { athletes: StoredAthlete[]; clubs: StoredClub[]; hasSettings: boolean },
  meetId: string,
): ImportPlan {
  const diff = diffAthletes(existing.athletes, model.athletes);
  const p = meetPaths(meetId);
  const ops: WriteOp[] = [];

  for (const a of diff.added) ops.push({ path: p.athlete(a.id), data: { ...a, removed: false }, merge: false });
  for (const c of diff.changed) ops.push({ path: p.athlete(c.athlete.id), data: { ...c.athlete, removed: false }, merge: false });
  for (const id of diff.removed) ops.push({ path: p.athlete(id), data: { removed: true }, merge: true });

  for (const s of model.sessions) {
    ops.push({ path: p.session(s.id), data: { name: s.name, location: s.location, gym: s.location, ...(s.number !== undefined ? { number: s.number } : {}), discipline: s.discipline, levelCodes: s.levelCodes }, merge: true });
  }

  const prev = new Map(existing.clubs.map((c) => [c.id, c]));
  let newClubs = 0;
  for (const c of model.clubs) {
    const old = prev.get(c.id);
    if (!old) newClubs++;
    const emails = c.emails.length ? c.emails : (old?.emails ?? []);
    // Same rule for contacts: an import without the League Communications export (or without its other roles) keeps them.
    const contacts = c.contacts?.length ? c.contacts : (old?.contacts ?? []);
    ops.push({ path: p.club(c.id), data: { name: c.name, emails, contacts }, merge: true });
  }

  if (!existing.hasSettings) ops.push({ path: p.settings, data: { ...DEFAULT_MEET_SETTINGS }, merge: true });

  return { diff, ops, newClubs };
}

export function chunk<T>(xs: T[], size = MAX_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
