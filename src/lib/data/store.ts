import { collection, doc, getDoc, getDocs, writeBatch, type Firestore } from 'firebase/firestore';
import type { StoredAthlete } from '../import/diff';
import type { ImportModel, Session } from '../import/types';
import { buildClubLinks } from '../club-links';
import { meetPaths } from './meet-paths';
import { chunk, planImport, type ImportPlan, type StoredClub } from './plan';

export async function loadAthletes(db: Firestore, meetId: string): Promise<StoredAthlete[]> {
  const snap = await getDocs(collection(db, meetPaths(meetId).athletes));
  return snap.docs.map((d) => ({ ...(d.data() as StoredAthlete), id: d.id }));
}

export async function loadClubs(db: Firestore, meetId: string): Promise<StoredClub[]> {
  const snap = await getDocs(collection(db, meetPaths(meetId).clubs));
  return snap.docs.map((d) => {
    const x = d.data() as Partial<StoredClub>;
    return { id: d.id, name: x.name ?? '', emails: x.emails ?? [], token: x.token ?? '' };
  });
}

export async function loadSessions(db: Firestore, meetId: string): Promise<Session[]> {
  const snap = await getDocs(collection(db, meetPaths(meetId).sessions));
  return snap.docs.map((d) => ({ ...(d.data() as Session), id: d.id }));
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
  const [athletes, sessions, allClubs] = await Promise.all([loadAthletes(db, meetId), loadSessions(db, meetId), loadClubs(db, meetId)]);
  const links = buildClubLinks(athletes, sessions, clubs ?? allClubs, undefined, meetId);
  for (const part of chunk(links)) {
    const batch = writeBatch(db);
    for (const l of part) batch.set(doc(db, 'clubLinks', l.token), l.doc);
    await batch.commit();
  }
  return links.length;
}
