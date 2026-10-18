// Firestore access for the admin T&T screen (admins only; see firestore.rules). The plan lives in meets/{meetId}/squads/{sessionId}.
import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import type { StoredAthlete } from '../import/diff';
import type { Session } from '../import/types';
import { parseTntDoc, type StoredTntDoc } from '../tnt-data';
import { meetPaths } from './meet-paths';
import { loadGymOrder } from './squad-store';
import { loadAthletes, loadSessions } from './store';
import { loadSynchroAssignments } from './synchro-store';
import type { SynchroAssignments } from '../synchro-flights';

export interface TntInput {
  sessions: Session[];
  athletes: StoredAthlete[];
  gymOrder: string[];
  /** The host's synchro session choices (`meets/{meetId}/synchroSessions/main`). */
  assignments: SynchroAssignments;
}

/** A failed read throws: never show defaults for data we could not read. */
export async function loadTntInput(db: Firestore, meetId: string): Promise<TntInput> {
  const [sessions, athletes, gymOrder, assignments] = await Promise.all([loadSessions(db, meetId), loadAthletes(db, meetId), loadGymOrder(db, meetId), loadSynchroAssignments(db, meetId)]);
  return { sessions, athletes, gymOrder, assignments };
}

export async function loadTntDoc(db: Firestore, meetId: string, sessionId: string) {
  const snap = await getDoc(doc(db, meetPaths(meetId).squad(sessionId)));
  return snap.exists() ? parseTntDoc(snap.data()) : null;
}

export async function saveTntDoc(db: Firestore, meetId: string, sessionId: string, value: StoredTntDoc): Promise<void> {
  await setDoc(doc(db, meetPaths(meetId).squad(sessionId)), { ...value, updatedAt: serverTimestamp() });
}
