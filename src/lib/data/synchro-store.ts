// Firestore access for the host's synchro session choices: one admin-only document, `synchroSessions/main`,
// `{ assignments: { <pairId>: <sessionId> }, updatedAt }`. Covered by the catch-all admin rule (no rules change).
import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { parseAssignments, type SynchroAssignments } from '../synchro-flights';

/** A failed read throws: never show or print with choices we could not read. */
export async function loadSynchroAssignments(db: Firestore): Promise<SynchroAssignments> {
  const snap = await getDoc(doc(db, 'synchroSessions', 'main'));
  return parseAssignments(snap.exists() ? snap.data() : null);
}

export async function saveSynchroAssignments(db: Firestore, assignments: SynchroAssignments): Promise<void> {
  await setDoc(doc(db, 'synchroSessions', 'main'), { assignments, updatedAt: serverTimestamp() });
}
