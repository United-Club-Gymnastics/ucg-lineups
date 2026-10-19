// Firestore access for "Start orders from another meet" (admin only). Reads both meets' rosters and the clubs' saved orders, and
// writes copied orders into the target meet's `clubOrders/{token}/meets/{target}/levels`. Nothing else is touched.
import { doc, serverTimestamp, writeBatch, type Firestore } from 'firebase/firestore';
import { buildClubLinks, type LinkSession } from '../club-links';
import { toStored } from '../club-order-model';
import type { ClubCopyInput, CopyPlan } from '../orders-copy';
import { loadClubTokens } from './club-tokens';
import { loadLevelOrders, ordersPath } from './club-store';
import { listMeets } from './meet-store';
import { assertMeetId } from './meet-paths';
import { chunk } from './plan';
import { loadAthletesForDisplay, loadClubs, loadSessions } from './store';

async function rosterFor(db: Firestore, meetId: string, name: string, createdAt: number, tokens: Record<string, string>, ids: string[]): Promise<Map<string, LinkSession[]>> {
  const [athletes, sessions, clubs] = await Promise.all([loadAthletesForDisplay(db, meetId), loadSessions(db, meetId), loadClubs(db, meetId)]);
  const byId = new Map(clubs.filter((c) => ids.includes(c.id)).map((c) => [c.id, c]));
  const built = buildClubLinks(athletes, sessions, [...byId.values()].map((c) => ({ id: c.id, name: c.name, token: tokens[c.id] ?? 'x' })), undefined, { id: meetId, name, createdAt });
  return new Map(built.map((b) => [b.doc.clubId, b.doc.meets[meetId].sessions]));
}

/** Everything the planner needs, per club that has a private link. A failed read throws: never plan from a partial read. */
export async function loadOrderCopyInput(db: Firestore, sourceMeetId: string, targetMeetId: string): Promise<ClubCopyInput[]> {
  assertMeetId(sourceMeetId);
  assertMeetId(targetMeetId);
  const [meets, tokens, srcClubs, tgtClubs] = await Promise.all([listMeets(db), loadClubTokens(db), loadClubs(db, sourceMeetId), loadClubs(db, targetMeetId)]);
  const name = (id: string) => meets.find((m) => m.id === id);
  const names = new Map([...srcClubs, ...tgtClubs].map((c) => [c.id, c.name]));
  const ids = [...names.keys()].filter((id) => tokens[id]);
  const [src, tgt] = await Promise.all([
    rosterFor(db, sourceMeetId, name(sourceMeetId)?.name ?? '', name(sourceMeetId)?.createdAt ?? 0, tokens, ids),
    rosterFor(db, targetMeetId, name(targetMeetId)?.name ?? '', name(targetMeetId)?.createdAt ?? 0, tokens, ids),
  ]);
  const out: ClubCopyInput[] = [];
  await Promise.all(ids.map(async (id) => {
    const [sourceSaved, targetSaved] = await Promise.all([loadLevelOrders(db, tokens[id], sourceMeetId), loadLevelOrders(db, tokens[id], targetMeetId)]);
    out.push({ clubId: id, token: tokens[id], clubName: names.get(id)!, source: src.get(id) ?? [], target: tgt.get(id) ?? [], sourceSaved, targetSaved });
  }));
  return out.sort((a, b) => a.clubName.localeCompare(b.clubName, 'en', { sensitivity: 'base' }));
}

/** Writes the planned orders into the target meet in batches. Returns how many level orders were written. */
export async function applyOrderCopy(db: Firestore, targetMeetId: string, plan: CopyPlan, onProgress?: (done: number, total: number) => void): Promise<number> {
  assertMeetId(targetMeetId);
  let done = 0;
  for (const part of chunk(plan.writes)) {
    const batch = writeBatch(db);
    for (const w of part) batch.set(doc(db, ordersPath(w.token, targetMeetId), w.targetKey), { ...toStored(w.order), updatedAt: serverTimestamp() });
    await batch.commit();
    done += part.length;
    onProgress?.(done, plan.writes.length);
  }
  return done;
}
