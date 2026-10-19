// Firestore access for the public club page. Everything here is reachable with only the club token.
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import type { ClubLinkDoc } from '../club-links';
import { meetPaths } from './meet-paths';
import { fromStored, toStored, type LevelOrder } from '../club-order-model';

export async function loadClubLink(db: Firestore, token: string): Promise<ClubLinkDoc | null> {
  const snap = await getDoc(doc(db, 'clubLinks', token));
  return snap.exists() ? (snap.data() as ClubLinkDoc) : null;
}

export interface PublicMeet {
  /** The order deadline, or null when none is set. */
  deadline: Date | null;
  /** The meet name, or '' when unknown. */
  name: string;
}

/** The public facts of the link's meet (`meets/{meetId}/settings/meet`, the one public document under a meet). */
export async function loadPublicMeet(db: Firestore, meetId: string): Promise<PublicMeet> {
  const snap = await getDoc(doc(db, meetPaths(meetId).settings));
  const d = snap.exists() ? snap.data() : {};
  const v = d.orderDeadline;
  return {
    deadline: v && typeof v.toDate === 'function' ? (v.toDate() as Date) : null,
    name: typeof d.meetName === 'string' ? d.meetName : '',
  };
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
