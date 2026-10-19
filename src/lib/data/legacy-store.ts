// Firestore access for "Bring in earlier data". Admin only (the rules' catch-all covers the old top-level paths, and clubLinks /
// clubOrders are admin-writable). It runs in the admin's browser, once, on request: nothing here deletes anything.
import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, startAfter, writeBatch, type DocumentData, type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import { KINDS, KIND_ROOT, type LegacyDoc, type LegacySnapshot, type MeetState } from '../legacy-copy';
import { meetPaths } from './meet-paths';
import { chunk, type WriteOp } from './plan';

const PAGE = 400;

/** Every document of a collection, one page at a time. */
async function readAll(db: Firestore, path: string): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const out: QueryDocumentSnapshot<DocumentData>[] = [];
  let last: QueryDocumentSnapshot<DocumentData> | undefined;
  for (;;) {
    const q = last
      ? query(collection(db, path), orderBy(documentId()), startAfter(last), limit(PAGE))
      : query(collection(db, path), orderBy(documentId()), limit(PAGE));
    const snap = await getDocs(q);
    out.push(...snap.docs);
    if (snap.docs.length < PAGE) return out;
    last = snap.docs[snap.docs.length - 1];
  }
}

/**
 * Cheap check for the menu: is there anything left at the old paths? One document each from athletes and clubs, and settings/meet.
 * Any failure counts as "no" (the button just does not show).
 */
export async function hasLegacyData(db: Firestore): Promise<boolean> {
  try {
    const [a, c, s] = await Promise.all([
      getDocs(query(collection(db, 'athletes'), limit(1))),
      getDocs(query(collection(db, 'clubs'), limit(1))),
      getDoc(doc(db, 'settings', 'meet')),
    ]);
    return !a.empty || !c.empty || s.exists();
  } catch {
    return false;
  }
}

/** Reads all the old documents (admin reads, in pages). A failed read throws: never plan from a partial read. */
export async function loadLegacy(db: Firestore): Promise<LegacySnapshot> {
  const docs: LegacyDoc[] = [];
  const settings = await getDoc(doc(db, 'settings', 'meet'));
  if (settings.exists()) docs.push({ path: 'settings/meet', data: settings.data() });
  for (const kind of KINDS) {
    if (kind === 'settings') continue;
    for (const d of await readAll(db, KIND_ROOT[kind])) docs.push({ path: `${KIND_ROOT[kind]}/${d.id}`, data: d.data() });
  }
  const clubLinks = (await readAll(db, 'clubLinks')).map((d) => ({ id: d.id, data: d.data() }));
  return { docs, clubLinks };
}

/** What the target meet already holds, for the same kinds (relative paths). */
export async function loadMeetState(db: Firestore, meetId: string): Promise<MeetState> {
  const p = meetPaths(meetId);
  const state: MeetState = new Map();
  const settings = await getDoc(doc(db, p.settings));
  if (settings.exists()) state.set('settings/meet', settings.data());
  for (const kind of KINDS) {
    if (kind === 'settings') continue;
    for (const d of await readAll(db, `${p.root}/${KIND_ROOT[kind]}`)) state.set(`${KIND_ROOT[kind]}/${d.id}`, d.data());
  }
  return state;
}

/** Applies the planned writes in batches of at most 450. Returns how many were written. */
export async function applyLegacyOps(db: Firestore, ops: WriteOp[], onProgress?: (done: number, total: number) => void): Promise<number> {
  let done = 0;
  for (const part of chunk(ops)) {
    const batch = writeBatch(db);
    for (const op of part) batch.set(doc(db, op.path), op.data, { merge: op.merge });
    await batch.commit();
    done += part.length;
    onProgress?.(done, ops.length);
  }
  return done;
}
