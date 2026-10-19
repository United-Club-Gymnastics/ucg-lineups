// Firestore access for the meet list (admins only; see firestore.rules). Archiving only sets a flag: nothing is ever deleted.
import { collection, doc, getDocs, serverTimestamp, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { DEFAULT_MEET_SETTINGS } from './plan';
import { meetPaths, newMeetId } from './meet-paths';

export interface MeetInfo {
  id: string;
  name: string;
  /** Milliseconds since the epoch; 0 when unknown. */
  createdAt: number;
  archived: boolean;
}

export function parseMeet(id: string, raw: unknown): MeetInfo {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const c = d.createdAt as { toMillis?: () => number } | undefined;
  return {
    id,
    name: typeof d.name === 'string' && d.name.trim() ? d.name : id,
    createdAt: c && typeof c.toMillis === 'function' ? c.toMillis() : 0,
    archived: d.archived === true,
  };
}

/** Newest first. */
export function sortMeets(meets: MeetInfo[]): MeetInfo[] {
  return [...meets].sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name));
}

/** Every meet (archived ones included; the UI hides them), newest first. */
export async function listMeets(db: Firestore): Promise<MeetInfo[]> {
  const snap = await getDocs(collection(db, 'meets'));
  return sortMeets(snap.docs.map((d) => parseMeet(d.id, d.data())));
}

/** Creates `meets/{id}` and its default settings in one batch; returns the new id. */
export async function createMeet(db: Firestore, name: string, makeId: (name: string) => string = newMeetId): Promise<string> {
  const clean = name.trim();
  if (!clean) throw new Error('Give the meet a name.');
  const id = makeId(clean);
  const p = meetPaths(id);
  const batch = writeBatch(db);
  batch.set(doc(db, p.root), { name: clean, createdAt: serverTimestamp(), archived: false });
  batch.set(doc(db, p.settings), { ...DEFAULT_MEET_SETTINGS, meetName: clean });
  await batch.commit();
  return id;
}

/** Renames the meet and its public/printed name in the settings (other settings are untouched). */
export async function renameMeet(db: Firestore, meetId: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new Error('Give the meet a name.');
  const p = meetPaths(meetId);
  const batch = writeBatch(db);
  batch.set(doc(db, p.root), { name: clean }, { merge: true });
  batch.set(doc(db, p.settings), { meetName: clean }, { merge: true });
  await batch.commit();
}

/** Hides the meet from the switcher. Its data stays where it is. */
export async function setMeetArchived(db: Firestore, meetId: string, archived: boolean): Promise<void> {
  await setDoc(doc(db, meetPaths(meetId).root), { archived }, { merge: true });
}
