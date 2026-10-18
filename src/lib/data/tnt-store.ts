// Firestore access for the admin T&T screen (admins only; see firestore.rules). The plan lives in squads/{sessionId}.
import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import type { StoredAthlete } from '../import/diff';
import type { Session } from '../import/types';
import { parseTntDoc, type StoredTntDoc } from '../tnt-data';
import { loadGymOrder } from './squad-store';
import { loadAthletes, loadSessions } from './store';

export interface TntInput {
  sessions: Session[];
  athletes: StoredAthlete[];
  gymOrder: string[];
}

/** A failed read throws: never show defaults for data we could not read. */
export async function loadTntInput(db: Firestore): Promise<TntInput> {
  const [sessions, athletes, gymOrder] = await Promise.all([loadSessions(db), loadAthletes(db), loadGymOrder(db)]);
  return { sessions, athletes, gymOrder };
}

export async function loadTntDoc(db: Firestore, sessionId: string) {
  const snap = await getDoc(doc(db, 'squads', sessionId));
  return snap.exists() ? parseTntDoc(snap.data()) : null;
}

export async function saveTntDoc(db: Firestore, sessionId: string, value: StoredTntDoc): Promise<void> {
  await setDoc(doc(db, 'squads', sessionId), { ...value, updatedAt: serverTimestamp() });
}
