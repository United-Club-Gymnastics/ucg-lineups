// Firestore access for the admin "Clubs & email" screen (admins only; see firestore.rules: meets/** is admin-only, the
// club link and club order documents are admin-writable). Nothing here sends mail.
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, Timestamp, writeBatch, type Firestore, type QuerySnapshot,
} from 'firebase/firestore';
import { applyNameFixesToAthletes, parseNameFixes, type NameFix } from '../name-fixes';
import { fromStored } from '../club-order-model';
import type { SavedLevel } from '../club-overview';
import { parseTemplates, type Templates } from '../email-templates';
import type { ReminderTemplate } from '../email/session-reminder-email';
import { parseRows, type ScheduleRows } from '../schedule';
import { parseSessionTemplate } from '../session-details';
import type { StoredAthlete } from '../import/diff';
import { DEFAULT_GYM_ORDER, type Session } from '../import/types';
import { newClubToken } from '../import/token';
import type { ReminderKind } from '../reminders';
import { parseClubTokens, loadClubTokens, CLUB_TOKENS } from './club-tokens';
import { ordersPath } from './club-store';
import { meetPaths } from './meet-paths';
import { listMeets } from './meet-store';
import { chunk, type StoredClub } from './plan';
import { loadAthletesForDisplay, loadClubs, loadSessions, publishClubLinks, toStoredAthlete, toStoredClub, toStoredSession } from './store';

const toMs = (v: unknown): number | null => (v && typeof (v as { toMillis?: unknown }).toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : null);

const levelsOf = (snap: QuerySnapshot): Record<string, SavedLevel> => {
  const out: Record<string, SavedLevel> = {};
  for (const d of snap.docs) {
    const data = d.data();
    out[d.id] = { order: fromStored(data), updatedAt: toMs(data.updatedAt) };
  }
  return out;
};

/** One club's saved level orders in one meet, with the time of each save. */
export async function loadLevelOrdersWithTimes(db: Firestore, token: string, meetId: string): Promise<Record<string, SavedLevel>> {
  return levelsOf(await getDocs(collection(db, ordersPath(token, meetId))));
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
 * Live view of the meet's clubs, athletes and sessions plus every club token's `clubOrders/{token}/meets/{meetId}/levels` (one listener per
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
  let rawAthletes: StoredAthlete[] | null = null;
  let fixes: NameFix[] | null = null;
  let rawClubs: StoredClub[] | null = null;
  let tokens: Record<string, string> | null = null;
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
  const ready = () => sessions && rawAthletes && fixes && clubs && clubs.every((c) => !c.token || levels.has(c.token));
  const emit = () => {
    timer = null;
    if (stopped || !sessions || !rawAthletes || !fixes || !clubs || !ready()) return;
    const saved: ClubsLive['saved'] = {};
    for (const c of clubs) if (c.token) saved[c.id] = levels.get(c.token) ?? {};
    emitted = true;
    handlers.onChange({ sessions, athletes: applyNameFixesToAthletes(rawAthletes, fixes), clubs, saved });
  };
  const changed = () => {
    if (stopped || !ready()) return;
    if (timer) clearTimeout(timer);
    // The first complete picture goes out at once; later changes are debounced.
    if (!emitted) emit(); else timer = setTimeout(emit, debounceMs);
  };
  const syncTokens = () => {
    clubs = rawClubs && tokens ? rawClubs.map((c) => ({ ...c, token: tokens![c.id] ?? '' })) : null;
    const want = new Set((clubs ?? []).map((c) => c.token).filter(Boolean));
    for (const [t, off] of tokenStops) if (!want.has(t)) { off(); tokenStops.delete(t); levels.delete(t); }
    for (const t of want) {
      if (tokenStops.has(t)) continue;
      tokenStops.set(t, onSnapshot(collection(db, ordersPath(t, meetId)), (snap) => { levels.set(t, levelsOf(snap)); changed(); }, fail));
    }
  };

  const offs: (() => void)[] = [];
  offs.push(
    onSnapshot(collection(db, p.sessions), (s) => { sessions = s.docs.map((d) => toStoredSession(d.id, d.data())); changed(); }, fail),
    onSnapshot(collection(db, p.athletes), (s) => { rawAthletes = s.docs.map((d) => toStoredAthlete(d.id, d.data())); changed(); }, fail),
    onSnapshot(doc(db, p.nameFixes), (s) => { fixes = parseNameFixes(s.exists() ? s.data() : null); changed(); }, fail),
    onSnapshot(collection(db, p.clubs), (s) => { rawClubs = s.docs.map((d) => toStoredClub(d.id, d.data())); syncTokens(); changed(); }, fail),
    onSnapshot(collection(db, CLUB_TOKENS), (s) => { tokens = parseClubTokens(s.docs); syncTokens(); changed(); }, fail),
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

/** The club reminders plus the per-person "Session details" email. */
export type LogTemplate = ReminderKind | 'session';

export interface EmailLogEntry {
  id: string;
  /** 'az' | 'split' | 'session' */
  template: LogTemplate;
  clubId: string;
  club: string;
  /** The address the message went to: a test alias in test mode. */
  to: string;
  subject: string;
  at: Date | null;
  by: string;
  mode: 'test';
  /** Session details only: the session, and the recipient (`a:<athleteId>` / `c:<address>`) with their real address's role. */
  sessionId?: string;
  recipientKey?: string;
}

export function parseLogEntry(id: string, raw: Record<string, unknown>): EmailLogEntry {
  const at = raw.at as { toDate?: () => Date } | undefined;
  return {
    id,
    template: raw.template === 'split' || raw.template === 'session' ? raw.template : 'az',
    clubId: typeof raw.clubId === 'string' ? raw.clubId : '',
    club: typeof raw.club === 'string' ? raw.club : '',
    to: typeof raw.to === 'string' ? raw.to : '',
    subject: typeof raw.subject === 'string' ? raw.subject : '',
    at: at && typeof at.toDate === 'function' ? at.toDate() : null,
    by: typeof raw.by === 'string' ? raw.by : '',
    mode: 'test',
    ...(typeof raw.sessionId === 'string' ? { sessionId: raw.sessionId } : {}),
    ...(typeof raw.recipientKey === 'string' ? { recipientKey: raw.recipientKey } : {}),
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
  /** The "Session details" email: the saved template (the default when none), and the contact roles counted as coaches (null
   *  until the admin saves a choice). */
  sessionTemplate: ReminderTemplate;
  coachRoles: string[] | null;
  /** For the session detail emails' dates and times (the Exports screen's schedule). */
  schedule: ScheduleRows;
  meetDate: string;
  log: EmailLogEntry[];
}

/** Everything the screen needs. A failed read throws: never show defaults (every club "Still A–Z") for data we could not read. */
export async function loadClubsScreenData(db: Firestore, meetId: string): Promise<ClubsScreenData> {
  const p = meetPaths(meetId);
  const [sessions, athletes, clubs, settingsSnap, emailSnap, logSnap] = await Promise.all([
    loadSessions(db, meetId), loadAthletesForDisplay(db, meetId), loadClubs(db, meetId),
    getDoc(doc(db, p.settings)), getDoc(doc(db, p.emailSettings)), getDocs(collection(db, p.emailLog)),
  ]);
  const saved: Record<string, Record<string, SavedLevel>> = {};
  await Promise.all(clubs.filter((c) => c.token).map(async (c) => { saved[c.id] = await loadLevelOrdersWithTimes(db, c.token, meetId); }));
  const s = settingsSnap.exists() ? settingsSnap.data() : {};
  const gym = Array.isArray(s.gymOrder) && s.gymOrder.length > 0 && s.gymOrder.every((x: unknown) => typeof x === 'string') ? (s.gymOrder as string[]) : DEFAULT_GYM_ORDER;
  const dl = s.orderDeadline as { toDate?: () => Date } | null | undefined;
  const email = emailSnap.exists() ? emailSnap.data() : null;
  const roles = email?.coachRoles;
  const log = logSnap.docs.map((d) => parseLogEntry(d.id, d.data())).sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  return {
    sessions, athletes, clubs, gymOrder: gym, saved,
    meetName: typeof s.meetName === 'string' ? s.meetName : '',
    deadline: dl && typeof dl.toDate === 'function' ? dl.toDate() : null,
    templates: parseTemplates(email),
    sessionTemplate: parseSessionTemplate(email?.sessionTemplate),
    coachRoles: Array.isArray(roles) && roles.every((r: unknown) => typeof r === 'string') ? (roles as string[]) : null,
    schedule: parseRows(s.schedule),
    meetDate: typeof s.meetDate === 'string' ? s.meetDate : '',
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

export async function saveSessionTemplate(db: Firestore, meetId: string, template: ReminderTemplate): Promise<void> {
  await setDoc(doc(db, meetPaths(meetId).emailSettings), { sessionTemplate: template }, { merge: true });
}

export async function saveCoachRoles(db: Firestore, meetId: string, roles: string[]): Promise<void> {
  await setDoc(doc(db, meetPaths(meetId).emailSettings), { coachRoles: roles }, { merge: true });
}

/** "Copy text from": the session detail templates other meets have saved, newest meet first. */
export async function loadOtherSessionTemplates(db: Firestore, meetId: string): Promise<{ meetId: string; meetName: string; template: ReminderTemplate }[]> {
  const meets = (await listMeets(db)).filter((m) => m.id !== meetId).sort((a, b) => b.createdAt - a.createdAt);
  const found = await Promise.all(meets.map(async (m) => {
    const snap = await getDoc(doc(db, meetPaths(m.id).emailSettings));
    const raw = snap.exists() ? snap.data().sessionTemplate : undefined;
    return raw ? { meetId: m.id, meetName: m.name || m.id, template: parseSessionTemplate(raw) } : null;
  }));
  return found.filter((x): x is NonNullable<typeof x> => x !== null);
}

/** One row per message sent (test mode only: `mode` is always 'test'). */
export async function addEmailLog(db: Firestore, meetId: string, e: { template: LogTemplate; clubId: string; club: string; to: string; subject: string; by: string; sessionId?: string; recipientKey?: string }): Promise<void> {
  await addDoc(collection(db, meetPaths(meetId).emailLog), { ...e, mode: 'test', at: serverTimestamp() });
}

export interface RegenerateResult {
  token: string;
  /** Saved level orders carried over to the new token, across all of the club's meets. */
  copied: number;
  /** false when the old link document could not be deleted (the old link may still open). */
  oldLinkRemoved: boolean;
}

/**
 * Mint a new private link for a club (ONE token across all its meets). Order matters, so a failure part-way never loses work:
 *  1. copy every saved level order of every meet from the old token to the new one (the old ones stay put),
 *  2. write the new `clubLinks/{new}` document: a copy of the old one (all the club's meets), then this meet's part refreshed,
 *  3. point the club at the new token (`clubTokens/{clubId}`),
 *  4. delete `clubLinks/{old}` (the old link stops working).
 * Steps 1-3 throw before anything is removed; if step 4 fails the new link already works and the result says so.
 */
export async function regenerateClubLink(db: Firestore, meetId: string, club: StoredClub, makeToken: () => string = newClubToken): Promise<RegenerateResult> {
  const oldToken = club.token || (await loadClubTokens(db))[club.id] || '';
  const token = makeToken();
  if (!token || token === oldToken) throw new Error('Could not make a new token.');

  let copied = 0;
  let oldLink: Record<string, unknown> | undefined;
  if (oldToken) {
    const oldSnap = await getDoc(doc(db, 'clubLinks', oldToken));
    if (oldSnap.exists()) oldLink = oldSnap.data();
    // Every meet, archived ones too: an archived meet's orders are not in the link any more but must not be lost.
    for (const m of await listMeets(db)) {
      const old = await getDocs(collection(db, ordersPath(oldToken, m.id)));
      for (const part of chunk(old.docs)) {
        const batch = writeBatch(db);
        for (const d of part) batch.set(doc(db, ordersPath(token, m.id), d.id), d.data());
        await batch.commit();
      }
      copied += old.docs.length;
    }
  }
  if (oldLink) await setDoc(doc(db, 'clubLinks', token), oldLink);
  await setDoc(doc(db, CLUB_TOKENS, club.id), { token });
  await publishClubLinks(db, meetId, [{ ...club, token }]);

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
