// `clubTokens/{clubId}` (admin-only): the ONE private-link token of a club across every meet (spec §3, §8). `clubId` is the
// slug of the club's full name, the same id the club has under each meet's `clubs`.
import { collection, doc, getDocs, writeBatch, type Firestore } from 'firebase/firestore';
import { newClubToken } from '../import/token';
import { chunk } from './plan';

export const CLUB_TOKENS = 'clubTokens';

export function parseClubTokens(docs: { id: string; data: () => Record<string, unknown> | undefined }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of docs) {
    const t = d.data()?.token;
    if (typeof t === 'string' && t !== '') out[d.id] = t;
  }
  return out;
}

/** clubId -> token for every club that has one. */
export async function loadClubTokens(db: Firestore): Promise<Record<string, string>> {
  return parseClubTokens((await getDocs(collection(db, CLUB_TOKENS))).docs);
}

/**
 * The tokens of these clubs, minting (and saving) one for every club that has none yet: "created on first publish".
 * Existing tokens are never changed here (Regenerate link is the only thing that replaces one).
 */
export async function ensureClubTokens(db: Firestore, clubIds: string[], makeToken: () => string = newClubToken): Promise<Record<string, string>> {
  const have = await loadClubTokens(db);
  const out: Record<string, string> = {};
  const fresh: string[] = [];
  for (const id of new Set(clubIds)) {
    if (have[id]) out[id] = have[id];
    else { out[id] = makeToken(); fresh.push(id); }
  }
  for (const part of chunk(fresh)) {
    const batch = writeBatch(db);
    for (const id of part) batch.set(doc(db, CLUB_TOKENS, id), { token: out[id] });
    await batch.commit();
  }
  return out;
}
