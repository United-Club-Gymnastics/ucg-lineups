import { diffAthletes, type ImportDiff, type StoredAthlete } from '../import/diff';
import { assignTokens, newClubToken } from '../import/token';
import { DEFAULT_GYM_ORDER, type ImportModel } from '../import/types';

export interface StoredClub {
  id: string;
  name: string;
  emails: string[];
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
 * their token (and their emails when the import carries none); settings/meet defaults are written
 * only when it does not exist yet.
 */
export function planImport(
  model: ImportModel,
  existing: { athletes: StoredAthlete[]; clubs: StoredClub[]; hasSettings: boolean },
  makeToken: () => string = newClubToken,
): ImportPlan {
  const diff = diffAthletes(existing.athletes, model.athletes);
  const ops: WriteOp[] = [];

  for (const a of diff.added) ops.push({ path: `athletes/${a.id}`, data: { ...a, removed: false }, merge: false });
  for (const c of diff.changed) ops.push({ path: `athletes/${c.athlete.id}`, data: { ...c.athlete, removed: false }, merge: false });
  for (const id of diff.removed) ops.push({ path: `athletes/${id}`, data: { removed: true }, merge: true });

  for (const s of model.sessions) {
    ops.push({ path: `sessions/${s.id}`, data: { number: s.number, gym: s.gym, discipline: s.discipline, levelCodes: s.levelCodes }, merge: true });
  }

  const prev = new Map(existing.clubs.map((c) => [c.id, c]));
  const tokens = assignTokens(
    model.clubs.map((c) => c.id),
    Object.fromEntries(existing.clubs.map((c) => [c.id, c.token])),
    makeToken,
  );
  let newClubs = 0;
  for (const c of model.clubs) {
    const old = prev.get(c.id);
    if (!old) newClubs++;
    const emails = c.emails.length ? c.emails : (old?.emails ?? []);
    ops.push({ path: `clubs/${c.id}`, data: { name: c.name, emails, token: tokens[c.id] }, merge: true });
  }

  if (!existing.hasSettings) ops.push({ path: 'settings/meet', data: { ...DEFAULT_MEET_SETTINGS }, merge: true });

  return { diff, ops, newClubs };
}

export function chunk<T>(xs: T[], size = MAX_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
