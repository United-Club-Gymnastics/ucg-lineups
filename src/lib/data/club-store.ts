// Firestore access for the public club page. Everything here is reachable with only the club token.
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import type { ClubLinkDoc } from '../club-links';
import { fromStored, toStored, type LevelOrder } from '../club-order-model';

export async function loadClubLink(db: Firestore, token: string): Promise<ClubLinkDoc | null> {
  const snap = await getDoc(doc(db, 'clubLinks', token));
  return snap.exists() ? (snap.data() as ClubLinkDoc) : null;
}

/** The order deadline, or null when none is set. */
export async function loadOrderDeadline(db: Firestore): Promise<Date | null> {
  const snap = await getDoc(doc(db, 'settings', 'meet'));
  const v = snap.exists() ? snap.data().orderDeadline : null;
  return v && typeof v.toDate === 'function' ? (v.toDate() as Date) : null;
}

/** All saved level orders for this token, keyed by level key. */
export async function loadLevelOrders(db: Firestore, token: string): Promise<Record<string, LevelOrder>> {
  const snap = await getDocs(collection(db, 'clubOrders', token, 'levels'));
  const out: Record<string, LevelOrder> = {};
  for (const d of snap.docs) {
    const o = fromStored(d.data());
    if (o) out[d.id] = o;
  }
  return out;
}

export async function saveLevelOrder(db: Firestore, token: string, levelKey: string, order: LevelOrder): Promise<void> {
  await setDoc(doc(db, 'clubOrders', token, 'levels', levelKey), { ...toStored(order), updatedAt: serverTimestamp() });
}
