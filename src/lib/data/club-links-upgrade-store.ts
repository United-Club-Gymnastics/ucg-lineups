// Firestore access for "Upgrade club links" (admin only). Runs in the admin's browser, once, on request. It is idempotent: it
// never overwrites an order that is already at the new path, and a re-run after a part-way failure finishes the job.
import { collection, deleteDoc, doc, getDoc, getDocs, limit, query, where, writeBatch, type Firestore } from 'firebase/firestore';
import { isNewLink, isOldLink, type ClubLinkDoc } from '../club-links';
import { pickClubTokens, planUpgrade, type OldLink, type UpgradeInput, type UpgradePlan } from '../club-links-upgrade';
import { CLUB_TOKENS, loadClubTokens } from './club-tokens';
import { ordersPath } from './club-store';
import { listMeets } from './meet-store';
import { chunk } from './plan';

/** Cheap check for the menu: is there any link in the old per-meet shape? Any failure counts as "no". */
export async function hasOldStyleLinks(db: Firestore): Promise<boolean> {
  try {
    return !(await getDocs(query(collection(db, 'clubLinks'), where('meetId', '!=', ''), limit(1)))).empty;
  } catch {
    return false;
  }
}

/** Reads everything the planner needs. A failed read throws: never plan from a partial read. */
export async function loadUpgradeInput(db: Firestore): Promise<UpgradeInput> {
  const [links, meets, clubTokens] = await Promise.all([getDocs(collection(db, 'clubLinks')), listMeets(db), loadClubTokens(db)]);
  const oldLinks: OldLink[] = [];
  const newLinks: Record<string, ClubLinkDoc> = {};
  for (const d of links.docs) {
    const data = d.data();
    if (isOldLink(data)) oldLinks.push({ token: d.id, data });
    else if (isNewLink(data)) newLinks[d.id] = data;
  }
  const upMeets = meets.map((m) => ({ id: m.id, name: m.name, createdAt: m.createdAt, archived: m.archived }));
  const oldOrders: Record<string, string[]> = {};
  await Promise.all(oldLinks.map(async (l) => {
    oldOrders[l.token] = (await getDocs(collection(db, 'clubOrders', l.token, 'levels'))).docs.map((d) => d.id);
  }));
  const chosen = pickClubTokens(oldLinks.filter((l) => upMeets.some((m) => m.id === l.data.meetId)), upMeets, clubTokens);
  const existingOrders: Record<string, string[]> = {};
  await Promise.all(oldLinks.map(async (l) => {
    const token = chosen[l.data.clubId];
    const key = `${token}|${l.data.meetId}`;
    if (!token || key in existingOrders) return;
    existingOrders[key] = (await getDocs(collection(db, ordersPath(token, l.data.meetId)))).docs.map((d) => d.id);
  }));
  return { oldLinks, newLinks, meets: upMeets, clubTokens, oldOrders, existingOrders };
}

export async function loadUpgradePlan(db: Firestore): Promise<UpgradePlan> {
  return planUpgrade(await loadUpgradeInput(db));
}

/**
 * Applies a plan in an order that is safe to stop and re-run:
 *  1. `clubTokens` for clubs that have none, 2. the orders (copied as they are, `updatedAt` kept), 3. the combined link documents,
 *  4. the other old link documents are deleted. The old `clubOrders/{oldToken}/levels/*` documents are left in place.
 * Returns the number of writes and deletes.
 */
export async function applyUpgrade(db: Firestore, plan: UpgradePlan, onProgress?: (done: number, total: number) => void): Promise<number> {
  const total = plan.newTokens.length + plan.orderCopies.length + plan.links.length + plan.deleteLinks.length;
  let done = 0;
  const tick = (n: number) => { done += n; onProgress?.(done, total); };

  for (const part of chunk(plan.newTokens)) {
    const batch = writeBatch(db);
    for (const t of part) batch.set(doc(db, CLUB_TOKENS, t.clubId), { token: t.token });
    await batch.commit();
    tick(part.length);
  }
  for (const part of chunk(plan.orderCopies, 200)) {
    const snaps = await Promise.all(part.map((c) => getDoc(doc(db, 'clubOrders', c.fromToken, 'levels', c.levelKey))));
    const batch = writeBatch(db);
    part.forEach((c, i) => { if (snaps[i].exists()) batch.set(doc(db, ordersPath(c.toToken, c.meetId), c.levelKey), snaps[i].data()!); });
    await batch.commit();
    tick(part.length);
  }
  for (const part of chunk(plan.links)) {
    const batch = writeBatch(db);
    for (const l of part) batch.set(doc(db, 'clubLinks', l.token), l.doc); // whole document: the old shape's fields go
    await batch.commit();
    tick(part.length);
  }
  for (const token of plan.deleteLinks) {
    await deleteDoc(doc(db, 'clubLinks', token));
    tick(1);
  }
  return done;
}
