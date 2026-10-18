// Firestore access for the host's synchro session choices: one admin-only document per meet, `meets/{meetId}/synchroSessions/main`,
// `{ assignments: { <pairId>: <sessionId> }, updatedAt }`. Covered by the admin-only rule under `meets/**`.
import { deleteField, doc, getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { meetPaths } from './meet-paths';
import { parseAssignments, type SynchroAssignments } from '../synchro-flights';

/** A failed read throws: never show or print with choices we could not read. */
export async function loadSynchroAssignments(db: Firestore, meetId: string): Promise<SynchroAssignments> {
  const snap = await getDoc(doc(db, meetPaths(meetId).synchro));
  return parseAssignments(snap.exists() ? snap.data() : null);
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
