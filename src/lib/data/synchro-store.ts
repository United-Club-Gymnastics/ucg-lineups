// Firestore access for the host's synchro session choices: one admin-only document, `synchroSessions/main`,
// `{ assignments: { <pairId>: <sessionId> }, updatedAt }`. Covered by the catch-all admin rule (no rules change).
import { deleteField, doc, getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { parseAssignments, type SynchroAssignments } from '../synchro-flights';

/** A failed read throws: never show or print with choices we could not read. */
export async function loadSynchroAssignments(db: Firestore): Promise<SynchroAssignments> {
  const snap = await getDoc(doc(db, 'synchroSessions', 'main'));
  return parseAssignments(snap.exists() ? snap.data() : null);
}

/**
 * Store ONE pair's session (null clears it) without rewriting the map, so two admins choosing for different pairs never
 * overwrite each other. A merge write touches only `assignments.<pairId>` (pair ids are map keys here, never parsed as field
 * paths, so dots or slashes in an id are safe) and creates the document when it does not exist yet.
 */
export async function saveSynchroAssignment(db: Firestore, pairId: string, sessionId: string | null): Promise<void> {
  await setDoc(
    doc(db, 'synchroSessions', 'main'),
    { assignments: { [pairId]: sessionId ?? deleteField() }, updatedAt: serverTimestamp() },
    { merge: true },
  );
}
