// Firestore access for a meet's name fixes: one admin-only document, `meets/{meetId}/nameFixes/main` =
// `{ fixes: [{ field, from, to }], updatedAt }`, covered by the catch-all admin rule under meets/** (not the public settings/meet).
import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { parseNameFixes, type NameFix } from '../name-fixes';
import { meetPaths } from './meet-paths';

/** A failed read throws: never show names without the fixes because the read failed. */
export async function loadNameFixes(db: Firestore, meetId: string): Promise<NameFix[]> {
  const snap = await getDoc(doc(db, meetPaths(meetId).nameFixes));
  return parseNameFixes(snap.exists() ? snap.data() : null);
}

/** Replaces the whole list (the host edits one list). */
export async function saveNameFixes(db: Firestore, meetId: string, fixes: NameFix[]): Promise<void> {
  await setDoc(doc(db, meetPaths(meetId).nameFixes), { fixes: fixes.map((f) => ({ field: f.field, from: f.from, to: f.to })), updatedAt: serverTimestamp() });
}
