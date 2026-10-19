// Firestore access for the admin Squads screen (admins only; see firestore.rules).
import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { DEFAULT_GYM_ORDER, type Session } from '../import/types';
import type { StoredAthlete } from '../import/diff';
import type { LevelOrder } from '../club-order-model';
import { parseSquadDoc, type StoredSquadDoc } from '../squad-data';
import { meetPaths } from './meet-paths';
import { loadLevelOrders } from './club-store';
import { loadAthletesForDisplay, loadClubs, loadSessions } from './store';

export interface SquadsInput {
  sessions: Session[];
  athletes: StoredAthlete[];
  gymOrder: string[];
  /** clubId -> level key -> saved order. */
  ordersByClub: Record<string, Record<string, LevelOrder>>;
}

export async function loadGymOrder(db: Firestore, meetId: string): Promise<string[]> {
  const snap = await getDoc(doc(db, meetPaths(meetId).settings));
  const v = snap.exists() ? snap.data().gymOrder : null;
  return Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length > 0 ? (v as string[]) : DEFAULT_GYM_ORDER;
}

/** Everything the screen needs except the session's own plan. A failed read throws: never show defaults for clubs we could not read. */
export async function loadSquadsInput(db: Firestore, meetId: string): Promise<SquadsInput> {
  const [sessions, athletes, clubs, gymOrder] = await Promise.all([loadSessions(db, meetId), loadAthletesForDisplay(db, meetId), loadClubs(db, meetId), loadGymOrder(db, meetId)]);
  const ordersByClub: Record<string, Record<string, LevelOrder>> = {};
  await Promise.all(clubs.filter((c) => c.token).map(async (c) => {
    ordersByClub[c.id] = await loadLevelOrders(db, c.token, meetId);
  }));
  return { sessions, athletes, gymOrder, ordersByClub };
}

export async function loadSquadDoc(db: Firestore, meetId: string, sessionId: string) {
  const snap = await getDoc(doc(db, meetPaths(meetId).squad(sessionId)));
  return snap.exists() ? parseSquadDoc(snap.data()) : null;
}

export async function saveSquadDoc(db: Firestore, meetId: string, sessionId: string, value: StoredSquadDoc): Promise<void> {
  await setDoc(doc(db, meetPaths(meetId).squad(sessionId)), { ...value, updatedAt: serverTimestamp() });
}

