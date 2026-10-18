// Firestore access for the admin Exports screen (admins only; see firestore.rules). Reads everything the sheets need and writes
// only the meet name/date (settings/meet, admin-write) and a T&T session's competition time (sessions/{id}, admin-write).
import { collection, deleteField, doc, getDoc, getDocs, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { DEFAULT_GYM_ORDER } from '../import/types';
import { parseRows, type MigrationPlan, type ScheduleFields, type ScheduleRows } from '../schedule';
import { fetchSynchroPairs, type SynchroPair } from '../synchro-source';
import { loadSynchroAssignments } from './synchro-store';
import type { SynchroAssignments } from '../synchro-flights';
import { loadSquadsInput, type SquadsInput } from './squad-store';

export interface MeetSettings {
  meetName: string;
  meetDate: string;
  gymOrder: string[];
  /** Per session number: date and times (`settings/meet.schedule`). */
  schedule: ScheduleRows;
}

export function parseMeetSettings(raw: unknown): MeetSettings {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const gym = Array.isArray(d.gymOrder) && d.gymOrder.length > 0 && d.gymOrder.every((x) => typeof x === 'string') ? (d.gymOrder as string[]) : DEFAULT_GYM_ORDER;
  return { meetName: typeof d.meetName === 'string' ? d.meetName : '', meetDate: typeof d.meetDate === 'string' ? d.meetDate : '', gymOrder: gym, schedule: parseRows(d.schedule) };
}

export async function loadMeetSettings(db: Firestore): Promise<MeetSettings> {
  const snap = await getDoc(doc(db, 'settings', 'meet'));
  return parseMeetSettings(snap.exists() ? snap.data() : null);
}

/** Merge: leaves the deadline, gym order and anything else in settings/meet alone. */
export async function saveMeetNameDate(db: Firestore, value: { meetName: string; meetDate: string }): Promise<void> {
  await setDoc(doc(db, 'settings', 'meet'), { meetName: value.meetName.trim(), meetDate: value.meetDate.trim() }, { merge: true });
}

/** Merge one session number's row into `settings/meet.schedule` (other numbers are untouched, so two admins don't overwrite each other). */
export async function saveScheduleRow(db: Firestore, number: number, row: ScheduleFields): Promise<void> {
  await setDoc(doc(db, 'settings', 'meet'), { schedule: { [String(number)]: row } }, { merge: true });
}

/** Merge a session's override (empty strings = no override for that field; an import keeps it). */
export async function saveScheduleOverride(db: Firestore, sessionId: string, override: ScheduleFields): Promise<void> {
  await setDoc(doc(db, 'sessions', sessionId), { scheduleOverride: override }, { merge: true });
}

/**
 * The one-time move of the older per-session times into the schedule (`planMigration` decides what): write the overrides, then
 * clear `squads/{id}.schedule` and remove `sessions/{id}.competitionTime`. Overrides are written first, so a failure part-way
 * leaves the old times in place.
 */
export async function runScheduleMigration(db: Firestore, plan: MigrationPlan): Promise<void> {
  for (const [id, o] of Object.entries(plan.overrides)) {
    await setDoc(doc(db, 'sessions', id), { scheduleOverride: { date: o.date ?? '', stretch: o.stretch ?? '', warmups: o.warmups ?? '', competition: o.competition ?? '' } }, { merge: true });
  }
  for (const id of plan.clearSquadSchedule) await updateDoc(doc(db, 'squads', id), { schedule: { stretch: '', warmups: '', competition: '' } });
  for (const id of plan.clearCompetitionTime) await updateDoc(doc(db, 'sessions', id), { competitionTime: deleteField() });
}

export interface ExportsInput extends SquadsInput {
  meet: MeetSettings;
  /** Raw `squads/{sessionId}` documents by session id. */
  squadDocs: Record<string, unknown>;
  /** null when the Synchro tool could not be read (T&T flights are then left out, with a warning). */
  synchroPairs: SynchroPair[] | null;
  /** The host's synchro session choices. */
  synchroAssignments: SynchroAssignments;
}

/** A failed read of our own data throws (never print from defaults); a failed read of the Synchro tool is reported, not fatal. */
export async function loadExportsInput(db: Firestore): Promise<ExportsInput> {
  const [base, meet, squads, synchroPairs, synchroAssignments] = await Promise.all([
    loadSquadsInput(db),
    loadMeetSettings(db),
    getDocs(collection(db, 'squads')),
    fetchSynchroPairs().catch(() => null),
    loadSynchroAssignments(db),
  ]);
  const squadDocs: Record<string, unknown> = {};
  for (const d of squads.docs) squadDocs[d.id] = d.data();
  return { ...base, gymOrder: meet.gymOrder, meet, squadDocs, synchroPairs, synchroAssignments };
}
