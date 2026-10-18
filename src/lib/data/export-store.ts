// Firestore access for the admin Exports screen (admins only; see firestore.rules). Reads everything the sheets need and writes
// only the meet name/date (settings/meet, admin-write) and a T&T session's competition time (sessions/{id}, admin-write).
import { collection, doc, getDoc, getDocs, setDoc, type Firestore } from 'firebase/firestore';
import { DEFAULT_GYM_ORDER } from '../import/types';
import { fetchSynchroPairs, type SynchroPair } from '../synchro-source';
import { loadSquadsInput, type SquadsInput } from './squad-store';

export interface MeetSettings {
  meetName: string;
  meetDate: string;
  gymOrder: string[];
}

export function parseMeetSettings(raw: unknown): MeetSettings {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const gym = Array.isArray(d.gymOrder) && d.gymOrder.length > 0 && d.gymOrder.every((x) => typeof x === 'string') ? (d.gymOrder as string[]) : DEFAULT_GYM_ORDER;
  return { meetName: typeof d.meetName === 'string' ? d.meetName : '', meetDate: typeof d.meetDate === 'string' ? d.meetDate : '', gymOrder: gym };
}

export async function loadMeetSettings(db: Firestore): Promise<MeetSettings> {
  const snap = await getDoc(doc(db, 'settings', 'meet'));
  return parseMeetSettings(snap.exists() ? snap.data() : null);
}

/** Merge: leaves the deadline, gym order and anything else in settings/meet alone. */
export async function saveMeetNameDate(db: Firestore, value: { meetName: string; meetDate: string }): Promise<void> {
  await setDoc(doc(db, 'settings', 'meet'), { meetName: value.meetName.trim(), meetDate: value.meetDate.trim() }, { merge: true });
}

/** Merge into the session document (an import keeps it). */
export async function saveCompetitionTime(db: Firestore, sessionId: string, time: string): Promise<void> {
  await setDoc(doc(db, 'sessions', sessionId), { competitionTime: time.trim() }, { merge: true });
}

export interface ExportsInput extends SquadsInput {
  meet: MeetSettings;
  /** Raw `squads/{sessionId}` documents by session id. */
  squadDocs: Record<string, unknown>;
  /** null when the Synchro tool could not be read (T&T flights are then left out, with a warning). */
  synchroPairs: SynchroPair[] | null;
}

/** A failed read of our own data throws (never print from defaults); a failed read of the Synchro tool is reported, not fatal. */
export async function loadExportsInput(db: Firestore): Promise<ExportsInput> {
  const [base, meet, squads, synchroPairs] = await Promise.all([
    loadSquadsInput(db),
    loadMeetSettings(db),
    getDocs(collection(db, 'squads')),
    fetchSynchroPairs().catch(() => null),
  ]);
  const squadDocs: Record<string, unknown> = {};
  for (const d of squads.docs) squadDocs[d.id] = d.data();
  return { ...base, gymOrder: meet.gymOrder, meet, squadDocs, synchroPairs };
}
