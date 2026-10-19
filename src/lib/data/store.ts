import { collection, doc, getDoc, getDocs, writeBatch, type DocumentData, type Firestore } from 'firebase/firestore';
import type { StoredAthlete } from '../import/diff';
import type { ImportModel, Session } from '../import/types';
import { buildClubLinks } from '../club-links';
import { applyNameFixesToAthletes, clubsAffectedByChange, type NameFix } from '../name-fixes';
import { meetPaths } from './meet-paths';
import { loadNameFixes, saveNameFixes } from './name-fixes-store';
import { chunk, planImport, type ImportPlan, type StoredClub } from './plan';

// One document -> one record; shared by the one-time loaders below and the live listeners (email-store.ts).
export const toStoredAthlete = (id: string, data: DocumentData): StoredAthlete => ({ ...(data as StoredAthlete), id });
export const toStoredClub = (id: string, data: DocumentData): StoredClub => {
  const x = data as Partial<StoredClub>;
  return { id, name: x.name ?? '', emails: x.emails ?? [], token: x.token ?? '' };
};
export const toStoredSession = (id: string, data: DocumentData): Session => ({ ...(data as Session), id });

export async function loadAthletes(db: Firestore, meetId: string): Promise<StoredAthlete[]> {
  const snap = await getDocs(collection(db, meetPaths(meetId).athletes));
  return snap.docs.map((d) => toStoredAthlete(d.id, d.data()));
}

/**
 * The athletes as the screens, PDFs, emails and club pages show them: the stored (export-spelled) names with the meet's name
 * fixes applied (src/lib/name-fixes.ts). Ids and everything else are unchanged. Use `loadAthletes` where the export's own
 * spelling is needed (the import's comparison with what is stored).
 */
export async function loadAthletesForDisplay(db: Firestore, meetId: string): Promise<StoredAthlete[]> {
  const [athletes, fixes] = await Promise.all([loadAthletes(db, meetId), loadNameFixes(db, meetId)]);
  return applyNameFixesToAthletes(athletes, fixes);
}

export async function loadClubs(db: Firestore, meetId: string): Promise<StoredClub[]> {
  const snap = await getDocs(collection(db, meetPaths(meetId).clubs));
  return snap.docs.map((d) => toStoredClub(d.id, d.data()));
}

export async function loadSessions(db: Firestore, meetId: string): Promise<Session[]> {
  const snap = await getDocs(collection(db, meetPaths(meetId).sessions));
  return snap.docs.map((d) => toStoredSession(d.id, d.data()));
}

export async function hasMeetSettings(db: Firestore, meetId: string): Promise<boolean> {
  return (await getDoc(doc(db, meetPaths(meetId).settings))).exists();
}

export interface StoredState {
  athletes: StoredAthlete[];
  clubs: StoredClub[];
  hasSettings: boolean;
}

export async function loadStored(db: Firestore, meetId: string): Promise<StoredState> {
  const [athletes, clubs, hasSettings] = await Promise.all([loadAthletes(db, meetId), loadClubs(db, meetId), hasMeetSettings(db, meetId)]);
  return { athletes, clubs, hasSettings };
}

/** Write an import in batches of at most 450 operations. Call `planImport` first to preview. */
export async function applyImport(db: Firestore, meetId: string, model: ImportModel, existing: StoredState): Promise<ImportPlan> {
  const plan = planImport(model, existing, meetId);
  for (const ops of chunk(plan.ops)) {
    const batch = writeBatch(db);
    for (const op of ops) batch.set(doc(db, op.path), op.data, { merge: op.merge });
    await batch.commit();
  }
  return plan;
}

/**
 * Publish the public `clubLinks/{token}` documents (roster per club, no emails/DOB/bibs), in batches.
 * Defaults to every club; pass a list to republish just some (for example after a token is regenerated).
 */
export async function publishClubLinks(db: Firestore, meetId: string, clubs?: StoredClub[]): Promise<number> {
  const [athletes, sessions, allClubs] = await Promise.all([loadAthletesForDisplay(db, meetId), loadSessions(db, meetId), loadClubs(db, meetId)]);
  const links = buildClubLinks(athletes, sessions, clubs ?? allClubs, undefined, meetId);
  for (const part of chunk(links)) {
    const batch = writeBatch(db);
    for (const l of part) batch.set(doc(db, 'clubLinks', l.token), l.doc);
    await batch.commit();
  }
  return links.length;
}

export interface NameFixesSaved {
  /** Clubs whose published page changed, by name. */
  republished: string[];
  /** Set when saving worked but republishing did not (the fixes are saved; republish to retry). */
  publishError?: string;
}

/**
 * Save the meet's name fixes, then republish the club pages of the clubs whose displayed names changed (a club page shows
 * the published roster). Fixes are display-only: nothing else is rewritten.
 */
export async function saveNameFixesAndRepublish(db: Firestore, meetId: string, before: NameFix[], after: NameFix[]): Promise<NameFixesSaved> {
  const [athletes, clubs] = await Promise.all([loadAthletes(db, meetId), loadClubs(db, meetId)]);
  const affected = new Set(clubsAffectedByChange(athletes, before, after));
  await saveNameFixes(db, meetId, after);
  const mine = clubs.filter((c) => affected.has(c.id) && c.token);
  try {
    await publishClubLinks(db, meetId, mine);
    return { republished: mine.map((c) => c.name).sort((a, b) => a.localeCompare(b)) };
  } catch (e) {
    return { republished: [], publishError: e instanceof Error ? e.message : 'unknown error' };
  }
}
