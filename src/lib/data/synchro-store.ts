// Firestore access for the host's synchro session choices: one admin-only document per meet, `meets/{meetId}/synchroSessions/main`,
// `{ assignments: { <pairId>: <sessionId> }, scratched: { <pairId>: true }, updatedAt }`. Covered by the admin-only rule under `meets/**`.
import { deleteField, doc, getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { meetPaths } from './meet-paths';
import { parseAssignments, parseScratched, type SynchroAssignments, type SynchroScratched } from '../synchro-flights';

/** A failed read throws: never show or print with choices we could not read. */
export async function loadSynchroDoc(db: Firestore, meetId: string): Promise<{ assignments: SynchroAssignments; scratched: SynchroScratched }> {
  const snap = await getDoc(doc(db, meetPaths(meetId).synchro));
  const raw = snap.exists() ? snap.data() : null;
  return { assignments: parseAssignments(raw), scratched: parseScratched(raw) };
}

export async function loadSynchroAssignments(db: Firestore, meetId: string): Promise<SynchroAssignments> {
  return (await loadSynchroDoc(db, meetId)).assignments;
}

/**
 * Scratch (`true`) or restore (`false`) ONE pair: a merge write of `scratched.<pairId>` only, `true` or deleteField(), the same
 * pattern as `saveSynchroAssignment` (map key, never a field path; doc created if missing; other pairs untouched).
 */
export async function saveSynchroScratch(db: Firestore, meetId: string, pairId: string, scratched: boolean): Promise<void> {
  await setDoc(
    doc(db, meetPaths(meetId).synchro),
    { scratched: { [pairId]: scratched ? true : deleteField() }, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/**
 * Store ONE pair's session (null clears it) without rewriting the map, so two admins choosing for different pairs never
 * overwrite each other. A merge write touches only `assignments.<pairId>` (pair ids are map keys here, never parsed as field
 * paths, so dots or slashes in an id are safe) and creates the document when it does not exist yet.
 */
export async function saveSynchroAssignment(db: Firestore, meetId: string, pairId: string, sessionId: string | null): Promise<void> {
  await setDoc(
    doc(db, meetPaths(meetId).synchro),
    { assignments: { [pairId]: sessionId ?? deleteField() }, updatedAt: serverTimestamp() },
    { merge: true },
  );
}
