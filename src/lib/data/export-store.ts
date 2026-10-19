// Firestore access for the admin Exports screen (admins only; see firestore.rules). Reads everything the sheets need and writes
// only the meet name/date (meets/{id}/settings/meet) and session schedule overrides (meets/{id}/sessions/{id}), all admin-write.
import { collection, deleteField, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { DEFAULT_GYM_ORDER } from '../import/types';
import { parseRows, type MigrationPlan, type ScheduleFields, type ScheduleRows } from '../schedule';
import { fetchSynchroPairs, type SynchroPair } from '../synchro-source';
import { loadSynchroDoc } from './synchro-store';
import type { SynchroAssignments, SynchroScratched } from '../synchro-flights';
import { meetPaths } from './meet-paths';
import { loadSquadsInput, type SquadsInput } from './squad-store';

export interface MeetSettings {
  meetName: string;
  meetDate: string;
  gymOrder: string[];
  /** Per session name (key: `N` or the name): date and times (`meets/{id}/settings/meet.schedule`). */
  schedule: ScheduleRows;
}

export function parseMeetSettings(raw: unknown): MeetSettings {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const gym = Array.isArray(d.gymOrder) && d.gymOrder.length > 0 && d.gymOrder.every((x) => typeof x === 'string') ? (d.gymOrder as string[]) : DEFAULT_GYM_ORDER;
  return { meetName: typeof d.meetName === 'string' ? d.meetName : '', meetDate: typeof d.meetDate === 'string' ? d.meetDate : '', gymOrder: gym, schedule: parseRows(d.schedule) };
}

export async function loadMeetSettings(db: Firestore, meetId: string): Promise<MeetSettings> {
  const snap = await getDoc(doc(db, meetPaths(meetId).settings));
  return parseMeetSettings(snap.exists() ? snap.data() : null);
}

/** Merge: leaves the deadline, gym order and anything else in the settings alone. Keeps the switcher's meet name in step. */
export async function saveMeetNameDate(db: Firestore, meetId: string, value: { meetName: string; meetDate: string }): Promise<void> {
  const p = meetPaths(meetId);
  const meetName = value.meetName.trim();
  const batch = writeBatch(db);
  batch.set(doc(db, p.settings), { meetName, meetDate: value.meetDate.trim() }, { merge: true });
  if (meetName) batch.set(doc(db, p.root), { name: meetName }, { merge: true });
  await batch.commit();
}

/** Merge one session name's row into `meets/{id}/settings/meet.schedule` (other rows are untouched, so two admins don't overwrite each other). */
export async function saveScheduleRow(db: Firestore, meetId: string, key: string, row: ScheduleFields): Promise<void> {
  await setDoc(doc(db, meetPaths(meetId).settings), { schedule: { [key]: row } }, { merge: true });
}

/** Merge a session's override (empty strings = no override for that field; an import keeps it). */
export async function saveScheduleOverride(db: Firestore, meetId: string, sessionId: string, override: ScheduleFields): Promise<void> {
  await setDoc(doc(db, meetPaths(meetId).session(sessionId)), { scheduleOverride: override }, { merge: true });
}

/**
 * The one-time move of the older per-session times into the schedule (`planMigration` decides what): write the overrides, then
 * clear `squads/{id}.schedule` and remove `sessions/{id}.competitionTime`. Overrides are written first, so a failure part-way
 * leaves the old times in place.
 */
export async function runScheduleMigration(db: Firestore, meetId: string, plan: MigrationPlan): Promise<void> {
  for (const [id, o] of Object.entries(plan.overrides)) {
    await setDoc(doc(db, meetPaths(meetId).session(id)), { scheduleOverride: { date: o.date ?? '', stretch: o.stretch ?? '', warmups: o.warmups ?? '', competition: o.competition ?? '' } }, { merge: true });
  }
  for (const id of plan.clearSquadSchedule) await updateDoc(doc(db, meetPaths(meetId).squad(id)), { schedule: { stretch: '', warmups: '', competition: '' } });
  for (const id of plan.clearCompetitionTime) await updateDoc(doc(db, meetPaths(meetId).session(id)), { competitionTime: deleteField() });
}

export interface ExportsInput extends SquadsInput {
  meet: MeetSettings;
  /** Raw `squads/{sessionId}` documents by session id. */
  squadDocs: Record<string, unknown>;
  /** null when the Synchro tool could not be read (T&T flights are then left out, with a warning). */
  synchroPairs: SynchroPair[] | null;
  /** The host's synchro session choices. */
  synchroAssignments: SynchroAssignments;
  /** Pairs the host scratched (left out of every export and warning). */
  synchroScratched: SynchroScratched;
}

/** A failed read of our own data throws (never print from defaults); a failed read of the Synchro tool is reported, not fatal. */
export async function loadExportsInput(db: Firestore, meetId: string): Promise<ExportsInput> {
  const [base, meet, squads, synchroPairs, synchroDoc] = await Promise.all([
    loadSquadsInput(db, meetId),
    loadMeetSettings(db, meetId),
    getDocs(collection(db, meetPaths(meetId).squads)),
    fetchSynchroPairs().catch(() => null),
    loadSynchroDoc(db, meetId),
  ]);
  const squadDocs: Record<string, unknown> = {};
  for (const d of squads.docs) squadDocs[d.id] = d.data();
  return { ...base, gymOrder: meet.gymOrder, meet, squadDocs, synchroPairs, synchroAssignments: synchroDoc.assignments, synchroScratched: synchroDoc.scratched };
}
