// Firestore access for the admin "Clubs & email" screen (admins only; see firestore.rules: meets/** is admin-only, the
// club link and club order documents are admin-writable). Nothing here sends mail.
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, Timestamp, writeBatch, type Firestore, type QuerySnapshot,
} from 'firebase/firestore';
import { fromStored } from '../club-order-model';
import type { SavedLevel } from '../club-overview';
import { parseTemplates, type Templates } from '../email-templates';
import type { StoredAthlete } from '../import/diff';
import { DEFAULT_GYM_ORDER, type Session } from '../import/types';
import { newClubToken } from '../import/token';
import type { ReminderKind } from '../reminders';
import { meetPaths } from './meet-paths';
import { chunk, type StoredClub } from './plan';
import { loadAthletes, loadClubs, loadSessions, publishClubLinks, toStoredAthlete, toStoredClub, toStoredSession } from './store';

const toMs = (v: unknown): number | null => (v && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : null);

const levelsOf = (snap: QuerySnapshot): Record<string, SavedLevel> => {
  const out: Record<string, SavedLevel> = {};
  for (const d of snap.docs) {
    const data = d.data();
    out[d.id] = { order: fromStored(data), updatedAt: toMs(data.updatedAt) };
  }
  return out;
};

/** One club's saved level orders with the time of each save. */
export async function loadLevelOrdersWithTimes(db: Firestore, token: string): Promise<Record<string, SavedLevel>> {
  return levelsOf(await getDocs(collection(db, 'clubOrders', token, 'levels')));
}

/** What the screen recomputes from while it is open. */
export interface ClubsLive {
  sessions: Session[];
  athletes: StoredAthlete[];
  clubs: StoredClub[];
  /** clubId -> level key -> saved order (a club with no token has none). */
  saved: Record<string, Record<string, SavedLevel>>;
}

export const LIVE_DEBOUNCE_MS = 300;

/**
 * Live view of the meet's clubs, athletes and sessions plus every club token's `clubOrders/{token}/levels` (one listener per
 * token; a token that appears or goes away adds or drops its listener). Nothing is reported until every listener has answered
 * once, so a half-loaded state never shows every club as "Still A–Z". Later changes are batched: `onChange` fires once,
 * `debounceMs` after the last one. A failing listener reports once through `onError` and the whole watch stops (Retry starts a
 * new one). Returns the function that stops everything.
 */
export function watchClubsLive(
  db: Firestore, meetId: string,
  handlers: { onChange: (s: ClubsLive) => void; onError: (e: Error) => void },
  debounceMs = LIVE_DEBOUNCE_MS,
): () => void {
  const p = meetPaths(meetId);
  let stopped = false;
  let sessions: Session[] | null = null;
  let athletes: StoredAthlete[] | null = null;
  let clubs: StoredClub[] | null = null;
  const levels = new Map<string, Record<string, SavedLevel>>(); // by token, once its first snapshot arrived
  const tokenStops = new Map<string, () => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let emitted = false;

  const fail = (e: unknown) => {
    if (stopped) return;
    stop();
    handlers.onError(e instanceof Error ? e : new Error('Live updates stopped.'));
  };
  const ready = () => sessions && athletes && clubs && clubs.every((c) => !c.token || levels.has(c.token));
  const emit = () => {
    timer = null;
    if (stopped || !sessions || !athletes || !clubs || !ready()) return;
    const saved: ClubsLive['saved'] = {};
    for (const c of clubs) if (c.token) saved[c.id] = levels.get(c.token) ?? {};
    emitted = true;
    handlers.onChange({ sessions, athletes, clubs, saved });
  };
  const changed = () => {
    if (stopped || !ready()) return;
    if (timer) clearTimeout(timer);
    // The first complete picture goes out at once; later changes are debounced.
    if (!emitted) emit(); else timer = setTimeout(emit, debounceMs);
  };
  const syncTokens = () => {
    const want = new Set((clubs ?? []).map((c) => c.token).filter(Boolean));
    for (const [t, off] of tokenStops) if (!want.has(t)) { off(); tokenStops.delete(t); levels.delete(t); }
    for (const t of want) {
      if (tokenStops.has(t)) continue;
      tokenStops.set(t, onSnapshot(collection(db, 'clubOrders', t, 'levels'), (snap) => { levels.set(t, levelsOf(snap)); changed(); }, fail));
    }
  };

  const offs: (() => void)[] = [];
  offs.push(
    onSnapshot(collection(db, p.sessions), (s) => { sessions = s.docs.map((d) => toStoredSession(d.id, d.data())); changed(); }, fail),
    onSnapshot(collection(db, p.athletes), (s) => { athletes = s.docs.map((d) => toStoredAthlete(d.id, d.data())); changed(); }, fail),
    onSnapshot(collection(db, p.clubs), (s) => { clubs = s.docs.map((d) => toStoredClub(d.id, d.data())); syncTokens(); changed(); }, fail),
  );
  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const off of offs) off();
    for (const off of tokenStops.values()) off();
    tokenStops.clear();
  }
  return stop;
}

export interface EmailLogEntry {
  id: string;
  /** 'az' | 'split' */
  template: ReminderKind;
  clubId: string;
  club: string;
  /** The address the message went to: a test alias in test mode. */
  to: string;
  subject: string;
  at: Date | null;
  by: string;
  mode: 'test';
}

export function parseLogEntry(id: string, raw: Record<string, unknown>): EmailLogEntry {
  const at = raw.at as { toDate?: () => Date } | undefined;
  return {
    id,
    template: raw.template === 'split' ? 'split' : 'az',
    clubId: typeof raw.clubId === 'string' ? raw.clubId : '',
    club: typeof raw.club === 'string' ? raw.club : '',
    to: typeof raw.to === 'string' ? raw.to : '',
    subject: typeof raw.subject === 'string' ? raw.subject : '',
    at: at && typeof at.toDate === 'function' ? at.toDate() : null,
    by: typeof raw.by === 'string' ? raw.by : '',
    mode: 'test',
  };
}

export interface ClubsScreenData {
  sessions: Session[];
  athletes: StoredAthlete[];
  clubs: StoredClub[];
  gymOrder: string[];
  saved: Record<string, Record<string, SavedLevel>>;
  meetName: string;
  deadline: Date | null;
  templates: Templates;
  log: EmailLogEntry[];
}

/** Everything the screen needs. A failed read throws: never show defaults (every club "Still A–Z") for data we could not read. */
export async function loadClubsScreenData(db: Firestore, meetId: string): Promise<ClubsScreenData> {
  const p = meetPaths(meetId);
  const [sessions, athletes, clubs, settingsSnap, emailSnap, logSnap] = await Promise.all([
    loadSessions(db, meetId), loadAthletes(db, meetId), loadClubs(db, meetId),
    getDoc(doc(db, p.settings)), getDoc(doc(db, p.emailSettings)), getDocs(collection(db, p.emailLog)),
  ]);
  const saved: Record<string, Record<string, SavedLevel>> = {};
  await Promise.all(clubs.filter((c) => c.token).map(async (c) => { saved[c.id] = await loadLevelOrdersWithTimes(db, c.token); }));
  const s = settingsSnap.exists() ? settingsSnap.data() : {};
  const gym = Array.isArray(s.gymOrder) && s.gymOrder.length > 0 && s.gymOrder.every((x: unknown) => typeof x === 'string') ? (s.gymOrder as string[]) : DEFAULT_GYM_ORDER;
  const dl = s.orderDeadline as { toDate?: () => Date } | null | undefined;
  const log = logSnap.docs.map((d) => parseLogEntry(d.id, d.data())).sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  return {
    sessions, athletes, clubs, gymOrder: gym, saved,
    meetName: typeof s.meetName === 'string' ? s.meetName : '',
    deadline: dl && typeof dl.toDate === 'function' ? dl.toDate() : null,
    templates: parseTemplates(emailSnap.exists() ? emailSnap.data() : null),
    log,
  };
}

/** Contact emails: merge, so the name and token are untouched. */
export async function saveClubEmails(db: Firestore, meetId: string, clubId: string, emails: string[]): Promise<void> {
  await setDoc(doc(db, meetPaths(meetId).club(clubId)), { emails }, { merge: true });
}

/** `meets/{id}/settings/meet.orderDeadline` as a Timestamp (null clears it). Merge: nothing else in the settings is touched. */
export async function saveOrderDeadline(db: Firestore, meetId: string, deadline: Date | null): Promise<void> {
  await setDoc(doc(db, meetPaths(meetId).settings), { orderDeadline: deadline ? Timestamp.fromDate(deadline) : null }, { merge: true });
}

export async function saveEmailTemplates(db: Firestore, meetId: string, templates: Templates): Promise<void> {
  await setDoc(doc(db, meetPaths(meetId).emailSettings), { templates }, { merge: true });
}

/** One row per message sent (test mode only: `mode` is always 'test'). */
export async function addEmailLog(db: Firestore, meetId: string, e: { template: ReminderKind; clubId: string; club: string; to: string; subject: string; by: string }): Promise<void> {
  await addDoc(collection(db, meetPaths(meetId).emailLog), { ...e, mode: 'test', at: serverTimestamp() });
}

export interface RegenerateResult {
  token: string;
  /** Saved level orders carried over to the new token. */
  copied: number;
  /** false when the old link document could not be deleted (the old link may still open). */
  oldLinkRemoved: boolean;
}

/**
 * Mint a new private link for a club. Order matters, so a failure part-way never loses work:
 *  1. copy every saved level order from the old token to the new one (the old ones stay put),
 *  2. publish the club's `clubLinks/{new}` document,
 *  3. point the club at the new token,
 *  4. delete `clubLinks/{old}` (the old link stops working).
 * Steps 1-3 throw before anything is removed; if step 4 fails the new link already works and the result says so.
 */
export async function regenerateClubLink(db: Firestore, meetId: string, club: StoredClub, makeToken: () => string = newClubToken): Promise<RegenerateResult> {
  const oldToken = club.token;
  const token = makeToken();
  if (!token || token === oldToken) throw new Error('Could not make a new token.');

  let copied = 0;
  if (oldToken) {
    const old = await getDocs(collection(db, 'clubOrders', oldToken, 'levels'));
    for (const part of chunk(old.docs)) {
      const batch = writeBatch(db);
      for (const d of part) batch.set(doc(db, 'clubOrders', token, 'levels', d.id), d.data());
      await batch.commit();
    }
    copied = old.docs.length;
  }
  await publishClubLinks(db, meetId, [{ ...club, token }]);
  await setDoc(doc(db, meetPaths(meetId).club(club.id)), { token }, { merge: true });

  let oldLinkRemoved = true;
  if (oldToken) {
    try {
      await deleteDoc(doc(db, 'clubLinks', oldToken));
    } catch {
      oldLinkRemoved = false;
    }
  }
  return { token, copied, oldLinkRemoved };
}
