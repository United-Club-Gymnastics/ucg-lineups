// Firestore security rules. Run with `npm run test:rules` (starts the emulator). Invented data only.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-ucg-lineups',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});
afterAll(() => env.cleanup());

const TOKEN = 'tokenAAAAAAAAAAAAAAAAAA';
const OTHER = 'tokenBBBBBBBBBBBBBBBBBB';
const LEVEL = 's1-green__L7';
const past = () => Timestamp.fromMillis(Date.now() - 3600e3);
const future = () => Timestamp.fromMillis(Date.now() + 3600e3);

async function seed(deadline: Timestamp | null = null) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/meet'), { meetName: 'Test Nationals', orderDeadline: deadline });
    for (const [t, id] of [[TOKEN, 'club-a'], [OTHER, 'club-b']] as const) {
      await setDoc(doc(db, `clubLinks/${t}`), {
        clubId: id,
        clubName: `Club ${id}`,
        sessions: [],
        levelKeys: id === 'club-a' ? [LEVEL, 's1-green__L8'] : ['s2-red__L7'],
      });
    }
    await setDoc(doc(db, 'athletes/WAG_0001'), { first: 'Ann', last: 'Example' });
    await setDoc(doc(db, 'clubs/club-a'), { name: 'Club A', token: TOKEN, emails: ['coach@example.com'] });
    await setDoc(doc(db, 'squads/s1-green'), { squads: [] });
    await setDoc(doc(db, 'sessions/s1-green'), { number: 1 });
    await setDoc(doc(db, 'emailLog/x'), { sent: true });
    await setDoc(doc(db, 'admins/helper@gmail.com'), { added: true });
  });
}

const publicDb = () => env.unauthenticatedContext().firestore();
const domainAdminDb = () => env.authenticatedContext('a', { email: 'Host@UnitedClubGymnastics.org', email_verified: true }).firestore();
const unverifiedDomainDb = () => env.authenticatedContext('u', { email: 'host@unitedclubgymnastics.org', email_verified: false }).firestore();
const outsiderDb = () => env.authenticatedContext('o', { email: 'someone@gmail.com', email_verified: true }).firestore();
const listedAdminDb = () => env.authenticatedContext('h', { email: 'Helper@Gmail.com', email_verified: true }).firestore();
const lookalikeDb = () => env.authenticatedContext('l', { email: 'x@unitedclubgymnastics.org.evil.com', email_verified: true }).firestore();

const order = (over: Record<string, unknown> = {}) => ({
  groups: [{ ids: ['WAG_0001', 'WAG_0002'] }],
  sections: { VT: [{ ids: ['WAG_0002', 'WAG_0001'] }] },
  splitDecided: false,
  updatedAt: serverTimestamp(),
  ...over,
});
const orderRef = (db: ReturnType<typeof publicDb>, token = TOKEN, level = LEVEL) => doc(db, `clubOrders/${token}/levels/${level}`);

describe('club links', () => {
  beforeEach(() => seed());

  test('anyone can get a link by token but cannot list or enumerate them', async () => {
    await assertSucceeds(getDoc(doc(publicDb(), `clubLinks/${TOKEN}`)));
    await assertFails(getDocs(collection(publicDb(), 'clubLinks')));
    await assertFails(getDocs(collection(outsiderDb(), 'clubLinks')));
    await assertSucceeds(getDocs(collection(domainAdminDb(), 'clubLinks')));
  });

  test('a wrong token reads nothing useful and cannot be created by the public', async () => {
    await assertSucceeds(getDoc(doc(publicDb(), 'clubLinks/nope'))); // get is open; the doc simply does not exist
    await assertFails(setDoc(doc(publicDb(), 'clubLinks/mine'), { clubId: 'x', clubName: 'X', sessions: [], levelKeys: [LEVEL] }));
    await assertFails(updateDoc(doc(publicDb(), `clubLinks/${TOKEN}`), { levelKeys: ['anything'] }));
    await assertFails(deleteDoc(doc(publicDb(), `clubLinks/${TOKEN}`)));
  });

  test('admins can write links', async () => {
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'clubLinks/new'), { clubId: 'x', clubName: 'X', sessions: [], levelKeys: [] }));
  });
});

describe('club orders', () => {
  beforeEach(() => seed());

  test('a club can write an allowed level under its own token, and read it back', async () => {
    await assertSucceeds(setDoc(orderRef(publicDb()), order()));
    await assertSucceeds(getDoc(orderRef(publicDb())));
    await assertSucceeds(setDoc(orderRef(publicDb()), order({ splitDecided: true }))); // update
  });

  test('a level key the link does not list is refused', async () => {
    await assertFails(setDoc(orderRef(publicDb(), TOKEN, 's9-red__L1'), order()));
  });

  test('another club cannot write into this token path, and a made-up token fails', async () => {
    // OTHER's link does not list LEVEL, so its holder cannot write it under either token.
    await assertFails(setDoc(orderRef(publicDb(), OTHER, LEVEL), order()));
    await assertFails(setDoc(orderRef(publicDb(), 'madeUpToken', LEVEL), order()));
    await assertFails(getDoc(orderRef(publicDb(), 'madeUpToken', LEVEL)));
  });

  test('extra fields, missing fields and wrong types are refused', async () => {
    await assertFails(setDoc(orderRef(publicDb()), order({ extra: 1 })));
    await assertFails(setDoc(orderRef(publicDb()), { groups: [], sections: {}, splitDecided: false }));
    await assertFails(setDoc(orderRef(publicDb()), order({ groups: 'nope' })));
    await assertFails(setDoc(orderRef(publicDb()), order({ sections: [] })));
    await assertFails(setDoc(orderRef(publicDb()), order({ splitDecided: 'yes' })));
    await assertFails(setDoc(orderRef(publicDb()), order({ groups: Array.from({ length: 31 }, () => ({ ids: [] })) })));
    await assertFails(setDoc(orderRef(publicDb()), order({ updatedAt: Timestamp.fromMillis(1) }))); // must be server time
  });

  test('a club cannot delete an order', async () => {
    await assertSucceeds(setDoc(orderRef(publicDb()), order()));
    await assertFails(deleteDoc(orderRef(publicDb())));
    await assertSucceeds(deleteDoc(orderRef(domainAdminDb())));
  });

  test('writes are refused after the deadline, allowed before it; admins always can', async () => {
    await seed(past());
    await assertFails(setDoc(orderRef(publicDb()), order()));
    await assertSucceeds(getDoc(orderRef(publicDb()))); // still readable
    await assertSucceeds(setDoc(orderRef(domainAdminDb()), order()));
    await seed(future());
    await assertSucceeds(setDoc(orderRef(publicDb()), order()));
  });

  test('no deadline set (null, missing or blank) leaves ordering open', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings/meet'), { meetName: 'x' });
    });
    await assertSucceeds(setDoc(orderRef(publicDb()), order()));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings/meet'), { orderDeadline: '' });
    });
    await assertSucceeds(setDoc(orderRef(publicDb()), order()));
  });

  test('outsiders without a valid link cannot read orders', async () => {
    await assertFails(getDoc(orderRef(outsiderDb(), 'madeUpToken')));
  });
});

describe('settings', () => {
  beforeEach(() => seed());

  test('settings/meet is public to read, admin-only to write; other settings are admin-only', async () => {
    await assertSucceeds(getDoc(doc(publicDb(), 'settings/meet')));
    await assertFails(setDoc(doc(publicDb(), 'settings/meet'), { orderDeadline: null }));
    await assertFails(setDoc(doc(outsiderDb(), 'settings/meet'), { orderDeadline: null }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'settings/meet'), { orderDeadline: future() }));
    await assertFails(getDoc(doc(publicDb(), 'settings/other')));
  });

  test('step 6: the Exports screen merges meet name/date (admin only) and a T&T competition time into the session', async () => {
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'settings/meet'), { meetName: 'Test Nationals', meetDate: 'Oct 22', orderDeadline: future() }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'settings/meet'), { meetName: 'Test Nationals 2', meetDate: 'Oct 23' }, { merge: true }));
    const snap = await getDoc(doc(publicDb(), 'settings/meet'));
    expect(snap.data()).toMatchObject({ meetName: 'Test Nationals 2', meetDate: 'Oct 23' });
    expect(snap.data()!.orderDeadline).toBeTruthy(); // the merge left the deadline alone
    await assertFails(setDoc(doc(publicDb(), 'settings/meet'), { meetName: 'x' }, { merge: true }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'sessions/s1-purple'), { competitionTime: 'Thursday 7:30 AM' }, { merge: true }));
    await assertFails(setDoc(doc(publicDb(), 'sessions/s1-purple'), { competitionTime: 'x' }, { merge: true }));
  });
});

describe('schedule and synchro session choices (catch-all admin rule, no rule change)', () => {
  beforeEach(() => seed());

  test('schedule rows merge by session number; overrides live on the session; the public can read the rows but write nothing', async () => {
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'settings/meet'), { schedule: { '1': { date: '2026-10-22', competition: '7:30 AM' } } }, { merge: true }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'settings/meet'), { schedule: { '2': { competition: '1:00 PM' } } }, { merge: true }));
    const snap = await getDoc(doc(publicDb(), 'settings/meet'));
    expect(Object.keys(snap.data()!.schedule).sort()).toEqual(['1', '2']);
    await assertFails(setDoc(doc(publicDb(), 'settings/meet'), { schedule: { '1': { competition: 'x' } } }, { merge: true }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'sessions/s1-purple'), { scheduleOverride: { date: '', competition: '9:00 AM' } }, { merge: true }));
    await assertFails(setDoc(doc(publicDb(), 'sessions/s1-purple'), { scheduleOverride: { competition: 'x' } }, { merge: true }));
    await assertFails(getDoc(doc(publicDb(), 'sessions/s1-purple')));
  });

  test('synchroSessions/main: admin only; one pair at a time with a merge write leaves the others alone and creates the doc', async () => {
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'synchroSessions/main'), { assignments: { 'pair.1': 's1-purple' } }, { merge: true }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'synchroSessions/main'), { assignments: { pair2: 's2-purple' } }, { merge: true }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'synchroSessions/main'), { assignments: { 'pair.1': deleteField() } }, { merge: true }));
    const snap = await getDoc(doc(domainAdminDb(), 'synchroSessions/main'));
    expect(snap.data()!.assignments).toEqual({ pair2: 's2-purple' });
    await assertFails(getDoc(doc(publicDb(), 'synchroSessions/main')));
    await assertFails(setDoc(doc(outsiderDb(), 'synchroSessions/main'), { assignments: {} }, { merge: true }));
  });
});

describe('admin-only collections', () => {
  beforeEach(() => seed());
  const PATHS = ['athletes/WAG_0001', 'clubs/club-a', 'sessions/s1-green', 'squads/s1-green', 'emailLog/x', 'emailSettings/main', 'admins/helper@gmail.com'];

  test('public and outside accounts cannot read or write', async () => {
    for (const p of PATHS) {
      await assertFails(getDoc(doc(publicDb(), p)));
      await assertFails(getDoc(doc(outsiderDb(), p)));
      await assertFails(setDoc(doc(outsiderDb(), p), { x: 1 }));
    }
    await assertFails(getDocs(collection(outsiderDb(), 'athletes')));
  });

  test('a verified @unitedclubgymnastics.org account is an admin (case-insensitive)', async () => {
    for (const p of PATHS) await assertSucceeds(getDoc(doc(domainAdminDb(), p)));
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'athletes/WAG_0002'), { first: 'Bea' }));
  });

  test('unverified or look-alike domains are not admins', async () => {
    await assertFails(getDoc(doc(unverifiedDomainDb(), 'athletes/WAG_0001')));
    await assertFails(getDoc(doc(lookalikeDb(), 'athletes/WAG_0001')));
  });

  test('an admins/{email} document grants admin to an outside address', async () => {
    await assertSucceeds(getDoc(doc(listedAdminDb(), 'athletes/WAG_0001')));
    await assertSucceeds(setDoc(doc(listedAdminDb(), 'admins/another@gmail.com'), { added: true }));
    await assertFails(setDoc(doc(outsiderDb(), 'admins/someone@gmail.com'), { added: true }));
  });
});
