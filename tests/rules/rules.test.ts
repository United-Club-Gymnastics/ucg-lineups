// Firestore security rules. Run with `npm run test:rules` (starts the emulator). Invented data only.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, documentId, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

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
const OLD_TOKEN = 'tokenOLDAAAAAAAAAAAAAAA'; // a link in the old per-meet shape (meetId, no meets map)
const LEVEL = 's1-green__L7';
const past = () => Timestamp.fromMillis(Date.now() - 3600e3);
const future = () => Timestamp.fromMillis(Date.now() + 3600e3);

const M1 = 'nationals-ab12';
const M2 = 'regionals-cd34';
const m = (meet: string, path: string) => `meets/${meet}/${path}`;

/** Two meets: M1 (the default under test) and M2. TOKEN is club-a's ONE link, listing both meets; OTHER is club-b's, listing only M1. */
async function seed(deadline: Timestamp | null = null, deadline2: Timestamp | null = null) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, m(M1, 'settings/meet')), { meetName: 'Test Nationals', orderDeadline: deadline });
    await setDoc(doc(db, m(M2, 'settings/meet')), { meetName: 'Test Regionals', orderDeadline: deadline2 });
    await setDoc(doc(db, `meets/${M1}`), { name: 'Test Nationals' });
    await setDoc(doc(db, `meets/${M2}`), { name: 'Test Regionals' });
    const entry = (name: string, keys: string[]) => ({ meetName: name, createdAt: 1, sessions: [], levelKeys: keys });
    await setDoc(doc(db, `clubLinks/${TOKEN}`), { clubId: 'club-a', clubName: 'Club club-a', meets: { [M1]: entry('Test Nationals', [LEVEL, 's1-green__L8']), [M2]: entry('Test Regionals', [LEVEL]) } });
    await setDoc(doc(db, `clubLinks/${OTHER}`), { clubId: 'club-b', clubName: 'Club club-b', meets: { [M1]: entry('Test Nationals', ['s2-red__L7']) } });
    await setDoc(doc(db, `clubLinks/${OLD_TOKEN}`), { meetId: M1, clubId: 'club-a', clubName: 'Club club-a', sessions: [], levelKeys: [LEVEL] });
    await setDoc(doc(db, `clubTokens/club-a`), { token: TOKEN });
    await setDoc(doc(db, `clubTokens/club-b`), { token: OTHER });
    for (const meet of [M1, M2]) {
      await setDoc(doc(db, m(meet, 'athletes/WAG_0001')), { first: 'Ann', last: 'Example' });
      await setDoc(doc(db, m(meet, 'clubs/club-a')), { name: 'Club A', emails: ['coach@example.com'] });
      await setDoc(doc(db, m(meet, 'squads/s1-green')), { squads: [] });
      await setDoc(doc(db, m(meet, 'sessions/s1-green')), { number: 1 });
      await setDoc(doc(db, m(meet, 'emailLog/x')), { sent: true });
      await setDoc(doc(db, m(meet, 'nameFixes/main')), { fixes: [{ field: 'last', from: 'MurrayMetzger', to: 'Murray Metzger' }] });
    }
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
const orderRef = (db: ReturnType<typeof publicDb>, token = TOKEN, level = LEVEL, meet = M1) => doc(db, `clubOrders/${token}/meets/${meet}/levels/${level}`);
const oldOrderRef = (db: ReturnType<typeof publicDb>, token = OLD_TOKEN, level = LEVEL) => doc(db, `clubOrders/${token}/levels/${level}`);

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
    await assertFails(setDoc(doc(publicDb(), 'clubLinks/mine'), { clubId: 'x', clubName: 'X', meets: { [M1]: { levelKeys: [LEVEL] } } }));
    await assertFails(updateDoc(doc(publicDb(), `clubLinks/${TOKEN}`), { [`meets.${M1}.levelKeys`]: ['anything'] }));
    await assertFails(deleteDoc(doc(publicDb(), `clubLinks/${TOKEN}`)));
  });

  test('admins can write links', async () => {
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'clubLinks/new'), { clubId: 'x', clubName: 'X', meets: { [M1]: { meetName: 'x', createdAt: 1, sessions: [], levelKeys: [] } } }));
  });

  test("publishing one meet merges just that meet's entry: the other meets are untouched; archiving removes only that entry", async () => {
    const db = domainAdminDb();
    await assertSucceeds(setDoc(doc(db, `clubLinks/${TOKEN}`), { clubId: 'club-a', clubName: 'Club club-a', meets: { [M1]: { meetName: 'Renamed', createdAt: 5, sessions: [], levelKeys: ['x'] } } }, { merge: true }));
    let d = (await getDoc(doc(db, `clubLinks/${TOKEN}`))).data()!;
    expect(d.meets[M1]).toMatchObject({ meetName: 'Renamed', levelKeys: ['x'] });
    expect(d.meets[M2]).toMatchObject({ meetName: 'Test Regionals', levelKeys: [LEVEL] });
    await assertSucceeds(setDoc(doc(db, `clubLinks/${TOKEN}`), { meets: { [M2]: deleteField() } }, { merge: true }));
    d = (await getDoc(doc(db, `clubLinks/${TOKEN}`))).data()!;
    expect(Object.keys(d.meets)).toEqual([M1]);
  });

  test('clubTokens is admin-only: a club (or anyone) cannot read, list or write the token table', async () => {
    await assertSucceeds(getDoc(doc(domainAdminDb(), 'clubTokens/club-a')));
    await assertSucceeds(getDocs(collection(domainAdminDb(), 'clubTokens')));
    for (const db of [publicDb(), outsiderDb(), unverifiedDomainDb()]) {
      await assertFails(getDoc(doc(db, 'clubTokens/club-a')));
      await assertFails(getDocs(collection(db, 'clubTokens')));
      await assertFails(setDoc(doc(db, 'clubTokens/club-a'), { token: 'mine' }));
    }
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

  test("a club is locked by ITS meet's deadline, not another meet's, with ONE link for both", async () => {
    // M1 closed, M2 open: the same token writes M2 (same level key) but not M1.
    await seed(past(), future());
    await assertFails(setDoc(orderRef(publicDb(), TOKEN, LEVEL, M1), order()));
    await assertSucceeds(setDoc(orderRef(publicDb(), TOKEN, LEVEL, M2), order()));
    // And the other way round: M1 open, M2 closed.
    await seed(future(), past());
    await assertSucceeds(setDoc(orderRef(publicDb(), TOKEN, LEVEL, M1), order()));
    await assertFails(setDoc(orderRef(publicDb(), TOKEN, LEVEL, M2), order()));
    // Admins still write after a deadline; a deadline-passed meet is still readable.
    await assertSucceeds(setDoc(orderRef(domainAdminDb(), TOKEN, LEVEL, M2), order()));
    await assertSucceeds(getDoc(orderRef(publicDb(), TOKEN, LEVEL, M2)));
  });

  test('a meet that is not in the link cannot be written (archived or never published), even with a matching level key and open deadline', async () => {
    await assertFails(setDoc(orderRef(publicDb(), OTHER, 's2-red__L7', M2), order())); // club-b's link lists only M1
    await assertSucceeds(setDoc(orderRef(publicDb(), OTHER, 's2-red__L7', M1), order()));
    await assertFails(setDoc(orderRef(publicDb(), TOKEN, LEVEL, 'unknown-meet-0000'), order()));
    // Archiving removes the meet's entry from the link: the club can no longer write it.
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `clubLinks/${TOKEN}`), { meets: { [M2]: deleteField() } }, { merge: true }); });
    await assertFails(setDoc(orderRef(publicDb(), TOKEN, LEVEL, M2), order()));
    await assertSucceeds(setDoc(orderRef(publicDb(), TOKEN, LEVEL, M1), order()));
  });

  test("a level key must be in THAT meet's levelKeys, not just another meet's", async () => {
    // 's1-green__L8' is listed for M1 only.
    await assertSucceeds(setDoc(orderRef(publicDb(), TOKEN, 's1-green__L8', M1), order()));
    await assertFails(setDoc(orderRef(publicDb(), TOKEN, 's1-green__L8', M2), order()));
  });

  test('the old path clubOrders/{token}/levels is read-only for clubs; admins can still read and write it', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `clubOrders/${OLD_TOKEN}/levels/${LEVEL}`), { groups: [], sections: {}, splitDecided: false }); });
    await assertSucceeds(getDoc(oldOrderRef(publicDb())));
    await assertFails(setDoc(oldOrderRef(publicDb()), order()));
    await assertFails(setDoc(oldOrderRef(publicDb(), TOKEN), order())); // a new-style link does not open it either
    await assertFails(deleteDoc(oldOrderRef(publicDb())));
    await assertSucceeds(setDoc(oldOrderRef(domainAdminDb()), order()));
    await assertSucceeds(getDoc(oldOrderRef(domainAdminDb())));
  });

  test('an old-style link (meetId, no meets map) can no longer write the new path', async () => {
    await assertFails(setDoc(orderRef(publicDb(), OLD_TOKEN, LEVEL, M1), order()));
  });

  test('a made-up token cannot list orders; a token holder lists its own meet\'s orders; nobody lists links or tokens', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(orderRef(ctx.firestore()), { groups: [], sections: {}, splitDecided: false }); });
    await assertSucceeds(getDocs(collection(publicDb(), `clubOrders/${TOKEN}/meets/${M1}/levels`)));
    await assertFails(getDocs(collection(publicDb(), `clubOrders/madeUpToken/meets/${M1}/levels`)));
    await assertFails(getDocs(collection(publicDb(), 'clubOrders')));
    await assertFails(getDocs(collection(publicDb(), `clubOrders/${TOKEN}/meets`)));
  });

  test("a token holder cannot read another meet's admin data (athletes, squads, clubs, emails, name fixes) or the meets list", async () => {
    for (const meet of [M1, M2]) {
      for (const p of ['athletes/WAG_0001', 'clubs/club-a', 'squads/s1-green', 'sessions/s1-green', 'emailLog/x', 'nameFixes/main']) {
        await assertFails(getDoc(doc(publicDb(), m(meet, p))));
      }
      await assertFails(getDocs(collection(publicDb(), m(meet, 'athletes'))));
    }
    await assertFails(getDoc(doc(publicDb(), `meets/${M2}`)));
    await assertFails(getDocs(collection(publicDb(), 'meets')));
  });

  test('a meet whose settings document is missing cannot be written (fails closed)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'clubLinks/ghostMeetTokenAAAAA'), { clubId: 'x', clubName: 'X', meets: { 'ghost-0000': { meetName: 'g', createdAt: 1, sessions: [], levelKeys: [LEVEL] } } });
    });
    await assertFails(setDoc(orderRef(publicDb(), 'ghostMeetTokenAAAAA', LEVEL, 'ghost-0000'), order()));
  });

  test('no deadline set (null, missing or blank) leaves ordering open', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), m(M1, 'settings/meet')), { meetName: 'x' });
    });
    await assertSucceeds(setDoc(orderRef(publicDb()), order()));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), m(M1, 'settings/meet')), { orderDeadline: '' });
    });
    await assertSucceeds(setDoc(orderRef(publicDb()), order()));
  });

  test('outsiders without a valid link cannot read orders', async () => {
    await assertFails(getDoc(orderRef(outsiderDb(), 'madeUpToken')));
  });
});

describe('settings', () => {
  beforeEach(() => seed());
  const settings = (meet: string) => m(meet, 'settings/meet');

  test("a meet's settings/meet is public to read, admin-only to write; other settings and the meet document are admin-only", async () => {
    await assertSucceeds(getDoc(doc(publicDb(), settings(M1))));
    await assertSucceeds(getDoc(doc(publicDb(), settings(M2))));
    await assertFails(setDoc(doc(publicDb(), settings(M1)), { orderDeadline: null }));
    await assertFails(setDoc(doc(outsiderDb(), settings(M1)), { orderDeadline: null }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), settings(M1)), { orderDeadline: future() }));
    await assertFails(getDoc(doc(publicDb(), m(M1, 'settings/other'))));
    await assertFails(getDoc(doc(publicDb(), `meets/${M1}`)));
    await assertFails(getDocs(collection(publicDb(), 'meets')));
    await assertSucceeds(getDocs(collection(domainAdminDb(), 'meets')));
  });

  test('the old top-level settings/meet is no longer public', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'settings/meet'), { meetName: 'old' }); });
    await assertFails(getDoc(doc(publicDb(), 'settings/meet')));
    await assertSucceeds(getDoc(doc(domainAdminDb(), 'settings/meet')));
  });

  test('admin creates and renames a meet; the public cannot', async () => {
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'meets/new-ef56'), { name: 'New', createdAt: serverTimestamp(), archived: false }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'meets/new-ef56'), { archived: true }, { merge: true }));
    await assertFails(setDoc(doc(publicDb(), 'meets/evil-0000'), { name: 'x' }));
    await assertFails(setDoc(doc(outsiderDb(), 'meets/evil-0000'), { name: 'x' }));
  });

  test('step 6: the Exports screen merges meet name/date (admin only) and a session schedule override', async () => {
    await assertSucceeds(setDoc(doc(domainAdminDb(), settings(M1)), { meetName: 'Test Nationals', meetDate: 'Oct 22', orderDeadline: future() }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), settings(M1)), { meetName: 'Test Nationals 2', meetDate: 'Oct 23' }, { merge: true }));
    const snap = await getDoc(doc(publicDb(), settings(M1)));
    expect(snap.data()).toMatchObject({ meetName: 'Test Nationals 2', meetDate: 'Oct 23' });
    expect(snap.data()!.orderDeadline).toBeTruthy(); // the merge left the deadline alone
    expect((await getDoc(doc(publicDb(), settings(M2)))).data()!.meetName).toBe('Test Regionals'); // the other meet is untouched
    await assertFails(setDoc(doc(publicDb(), settings(M1)), { meetName: 'x' }, { merge: true }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), m(M1, 'sessions/s1-purple')), { scheduleOverride: { competition: 'Thursday 7:30 AM' } }, { merge: true }));
    await assertFails(setDoc(doc(publicDb(), m(M1, 'sessions/s1-purple')), { scheduleOverride: { competition: 'x' } }, { merge: true }));
  });
});

describe('schedule and synchro session choices (admin-only under meets/**)', () => {
  beforeEach(() => seed());

  test('schedule rows merge by session number; overrides live on the session; the public can read the rows but write nothing', async () => {
    await assertSucceeds(setDoc(doc(domainAdminDb(), m(M1, 'settings/meet')), { schedule: { '1': { date: '2026-10-22', competition: '7:30 AM' } } }, { merge: true }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), m(M1, 'settings/meet')), { schedule: { '2': { competition: '1:00 PM' } } }, { merge: true }));
    const snap = await getDoc(doc(publicDb(), m(M1, 'settings/meet')));
    expect(Object.keys(snap.data()!.schedule).sort()).toEqual(['1', '2']);
    await assertFails(setDoc(doc(publicDb(), m(M1, 'settings/meet')), { schedule: { '1': { competition: 'x' } } }, { merge: true }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), m(M1, 'sessions/s1-purple')), { scheduleOverride: { date: '', competition: '9:00 AM' } }, { merge: true }));
    await assertFails(setDoc(doc(publicDb(), m(M1, 'sessions/s1-purple')), { scheduleOverride: { competition: 'x' } }, { merge: true }));
    await assertFails(getDoc(doc(publicDb(), m(M1, 'sessions/s1-purple'))));
  });

  test('synchroSessions/main: admin only; one pair at a time with a merge write leaves the others alone and creates the doc', async () => {
    await assertSucceeds(setDoc(doc(domainAdminDb(), m(M1, 'synchroSessions/main')), { assignments: { 'pair.1': 's1-purple' } }, { merge: true }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), m(M1, 'synchroSessions/main')), { assignments: { pair2: 's2-purple' } }, { merge: true }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), m(M1, 'synchroSessions/main')), { assignments: { 'pair.1': deleteField() } }, { merge: true }));
    const snap = await getDoc(doc(domainAdminDb(), m(M1, 'synchroSessions/main')));
    expect(snap.data()!.assignments).toEqual({ pair2: 's2-purple' });
    await assertFails(getDoc(doc(publicDb(), m(M1, 'synchroSessions/main'))));
    await assertFails(setDoc(doc(outsiderDb(), m(M1, 'synchroSessions/main')), { assignments: {} }, { merge: true }));
  });
});

describe('name fixes (admin-only under meets/**, never in the public settings)', () => {
  beforeEach(() => seed());

  test('an admin reads and replaces the list; the public, an outsider and a club token holder cannot read or write it', async () => {
    const ref = (db: ReturnType<typeof publicDb>) => doc(db, m(M1, 'nameFixes/main'));
    await assertSucceeds(setDoc(ref(domainAdminDb()), { fixes: [{ field: 'first', from: 'MaryAnn', to: 'Mary Ann' }], updatedAt: serverTimestamp() }));
    expect((await getDoc(ref(domainAdminDb()))).data()!.fixes).toHaveLength(1);
    await assertFails(getDoc(ref(publicDb())));
    await assertFails(getDoc(ref(outsiderDb())));
    await assertFails(setDoc(ref(publicDb()), { fixes: [] }));
    await assertFails(setDoc(ref(outsiderDb()), { fixes: [] }));
    // The public settings document stays readable, but holds no names.
    const settings = await getDoc(doc(publicDb(), m(M1, 'settings/meet')));
    expect(JSON.stringify(settings.data())).not.toContain('MurrayMetzger');
  });
});

describe('admin-only collections (all under meets/{meetId}/)', () => {
  beforeEach(() => seed());
  const PATHS = [
    ...[M1, M2].flatMap((meet) => ['athletes/WAG_0001', 'clubs/club-a', 'sessions/s1-green', 'squads/s1-green', 'emailLog/x', 'emailSettings/main', 'nameFixes/main'].map((p) => m(meet, p))),
    'admins/helper@gmail.com',
  ];

  test('public and outside accounts cannot read or write', async () => {
    for (const p of PATHS) {
      await assertFails(getDoc(doc(publicDb(), p)));
      await assertFails(getDoc(doc(outsiderDb(), p)));
      await assertFails(setDoc(doc(outsiderDb(), p), { x: 1 }));
    }
    await assertFails(getDocs(collection(outsiderDb(), m(M1, 'athletes'))));
    await assertFails(getDocs(collection(publicDb(), m(M2, 'clubs'))));
  });

  test('a non-admin cannot read another meet\'s athletes, even with a club link into one meet', async () => {
    // Holding a club token (a link in M1) grants nothing under meets/**.
    await assertFails(getDoc(doc(publicDb(), m(M1, 'athletes/WAG_0001'))));
    await assertFails(getDoc(doc(publicDb(), m(M2, 'athletes/WAG_0001'))));
    await assertFails(getDocs(collection(outsiderDb(), m(M2, 'athletes'))));
  });

  test('the old top-level paths are denied to everyone but admins (only clubLinks and clubOrders stay open to a token)', async () => {
    const OLD = ['athletes/WAG_0001', 'clubs/club-a', 'sessions/s1-green', 'squads/s1-green', 'emailLog/x', 'synchroSessions/main', 'settings/meet'];
    await env.withSecurityRulesDisabled(async (ctx) => { for (const p of OLD) await setDoc(doc(ctx.firestore(), p), { x: 1 }); });
    for (const p of OLD) {
      await assertFails(getDoc(doc(publicDb(), p)));
      await assertFails(getDoc(doc(outsiderDb(), p)));
      await assertFails(setDoc(doc(publicDb(), p), { x: 2 }));
    }
    await assertSucceeds(getDoc(doc(publicDb(), `clubLinks/${TOKEN}`)));
    await assertSucceeds(getDoc(orderRef(publicDb())));
  });

  test('a verified @unitedclubgymnastics.org account is an admin of every meet (case-insensitive)', async () => {
    for (const p of PATHS) await assertSucceeds(getDoc(doc(domainAdminDb(), p)));
    await assertSucceeds(setDoc(doc(domainAdminDb(), m(M1, 'athletes/WAG_0002')), { first: 'Bea' }));
    await assertSucceeds(setDoc(doc(domainAdminDb(), m(M2, 'athletes/WAG_0002')), { first: 'Cy' }));
  });

  test('unverified or look-alike domains are not admins', async () => {
    await assertFails(getDoc(doc(unverifiedDomainDb(), m(M1, 'athletes/WAG_0001'))));
    await assertFails(getDoc(doc(lookalikeDb(), m(M1, 'athletes/WAG_0001'))));
  });

  test('an admins/{email} document grants admin to an outside address', async () => {
    await assertSucceeds(getDoc(doc(listedAdminDb(), m(M1, 'athletes/WAG_0001'))));
    await assertSucceeds(setDoc(doc(listedAdminDb(), 'admins/another@gmail.com'), { added: true }));
    await assertFails(setDoc(doc(outsiderDb(), 'admins/someone@gmail.com'), { added: true }));
  });
});

describe('bring in earlier data (admin copy from the old top-level paths into a meet)', () => {
  const OLD = ['settings/meet', 'athletes/WAG_0001', 'clubs/club-a', 'sessions/s1-green', 'squads/s1-green', 'synchroSessions/main', 'emailSettings/main', 'emailLog/x'];
  const LINK = 'tokenLEGACYAAAAAAAAAAAA';
  beforeEach(async () => {
    await seed();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (const p of OLD) await setDoc(doc(db, p), { x: 1 });
      await setDoc(doc(db, `clubLinks/${LINK}`), { clubId: 'club-a', clubName: 'Club A', sessions: [], levelKeys: [LEVEL] });
      await setDoc(doc(db, `clubOrders/${LINK}/levels/${LEVEL}`), { groups: [], sections: {}, splitDecided: false });
    });
  });

  test('an admin can page-read every old collection and clubLinks, copy into a meet and attach a link, in a batch', async () => {
    const db = domainAdminDb();
    for (const c of ['athletes', 'clubs', 'sessions', 'squads', 'synchroSessions', 'emailSettings', 'emailLog', 'clubLinks']) {
      await assertSucceeds(getDocs(query(collection(db, c), orderBy(documentId()), limit(5))));
    }
    await assertSucceeds(getDoc(doc(db, 'settings/meet')));
    await assertSucceeds(getDocs(query(collection(db, 'athletes'), limit(1))));

    const batch = writeBatch(db);
    for (const p of OLD) batch.set(doc(db, `meets/${M2}/${p}`), { x: 1 });
    batch.set(doc(db, `meets/${M2}/settings/meet`), { meetDate: '2026-07-01' }, { merge: true });
    batch.set(doc(db, `clubLinks/${LINK}`), { meetId: M2 }, { merge: true });
    await assertSucceeds(batch.commit());
    expect((await getDoc(doc(db, `clubLinks/${LINK}`))).data()).toMatchObject({ meetId: M2, clubId: 'club-a' });
    // The originals are still there.
    for (const p of OLD) expect((await getDoc(doc(db, p))).exists()).toBe(true);
  });

  test('once attached, the old link still READS its saved order (so a migration can), but a club can no longer write it', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `clubLinks/${LINK}`), { meetId: M2 }, { merge: true });
    });
    await assertSucceeds(getDoc(oldOrderRef(publicDb(), LINK)));
    await assertFails(setDoc(oldOrderRef(publicDb(), LINK), order()));
    await assertFails(setDoc(orderRef(publicDb(), LINK, LEVEL, M2), order()));
  });

  test('a non-admin and a signed-out visitor can do none of it', async () => {
    for (const db of [outsiderDb(), publicDb(), unverifiedDomainDb()]) {
      for (const c of ['athletes', 'clubs', 'sessions', 'squads', 'emailLog', 'clubLinks']) {
        await assertFails(getDocs(query(collection(db, c), limit(1))));
      }
      await assertFails(getDoc(doc(db, 'settings/meet')));
      await assertFails(setDoc(doc(db, `meets/${M2}/athletes/WAG_0009`), { x: 1 }));
      await assertFails(setDoc(doc(db, `clubLinks/${LINK}`), { meetId: M2 }, { merge: true }));
      await assertFails(updateDoc(doc(db, `clubLinks/${LINK}`), { meetId: M2 }));
    }
  });
});

describe('upgrade club links (admin migration, run through the real store code against these rules)', () => {
  const T_P = 'tokenPRELIMSAAAAAAAAAA'; // Prelims (older) per-meet token of club-a
  const T_F = 'tokenFINALSAAAAAAAAAAA'; // Finals (newer) per-meet token of club-a
  const entry = (keys: string[]) => ({ sessions: [], levelKeys: keys });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, `meets/${M1}`), { name: 'Prelims', createdAt: Timestamp.fromMillis(1000), archived: false });
      await setDoc(doc(db, `meets/${M2}`), { name: 'Finals', createdAt: Timestamp.fromMillis(2000), archived: false });
      for (const id of [M1, M2]) await setDoc(doc(db, `meets/${id}/settings/meet`), { orderDeadline: null });
      await setDoc(doc(db, `clubLinks/${T_P}`), { meetId: M1, clubId: 'club-a', clubName: 'Club A', ...entry([LEVEL]) });
      await setDoc(doc(db, `clubLinks/${T_F}`), { meetId: M2, clubId: 'club-a', clubName: 'Club A', ...entry([LEVEL]) });
      await setDoc(doc(db, `clubOrders/${T_P}/levels/${LEVEL}`), { groups: [{ ids: ['x'] }], sections: {}, splitDecided: false, updatedAt: Timestamp.fromMillis(5) });
      await setDoc(doc(db, `clubOrders/${T_F}/levels/${LEVEL}`), { groups: [{ ids: ['y'] }], sections: {}, splitDecided: true, updatedAt: Timestamp.fromMillis(6) });
    });
  });

  test('previews, applies once, and a second run finds nothing to do', async () => {
    const { hasOldStyleLinks, loadUpgradePlan, applyUpgrade } = await import('../../src/lib/data/club-links-upgrade-store');
    const db = domainAdminDb() as never;
    expect(await hasOldStyleLinks(db)).toBe(true);
    const plan = await loadUpgradePlan(db);
    expect(plan.counts).toMatchObject({ clubs: 1, oldLinks: 2, ordersToCopy: 2, tokensNew: 1, linksToDelete: 1 });
    await applyUpgrade(db, plan);

    const links = await getDocs(collection(domainAdminDb(), 'clubLinks'));
    expect(links.docs.map((d) => d.id)).toEqual([T_F]); // the newest meet's token is the club's; Prelims' old link is gone
    const link = links.docs[0].data();
    expect(Object.keys(link.meets).sort()).toEqual([M1, M2].sort());
    expect(link.meetId).toBeUndefined();
    expect(link.meets[M2].meetName).toBe('Finals');
    expect((await getDoc(doc(domainAdminDb(), 'clubTokens/club-a'))).data()).toEqual({ token: T_F });
    // Orders of both meets are under the one token; the old paths are untouched.
    expect((await getDoc(orderRef(domainAdminDb(), T_F, LEVEL, M1))).data()!.groups).toEqual([{ ids: ['x'] }]);
    expect((await getDoc(orderRef(domainAdminDb(), T_F, LEVEL, M2))).data()!.splitDecided).toBe(true);
    expect((await getDoc(oldOrderRef(domainAdminDb(), T_P))).exists()).toBe(true);

    expect(await hasOldStyleLinks(db)).toBe(false);
    const again = await loadUpgradePlan(db);
    expect(again.counts).toMatchObject({ oldLinks: 0, ordersToCopy: 0, linksToDelete: 0 });
    // The club now writes both meets with the one token, and the old Prelims token is dead.
    await assertSucceeds(setDoc(orderRef(publicDb(), T_F, LEVEL, M1), order()));
    await assertSucceeds(setDoc(orderRef(publicDb(), T_F, LEVEL, M2), order()));
    await assertFails(setDoc(orderRef(publicDb(), T_P, LEVEL, M1), order()));
    expect((await getDoc(doc(publicDb(), `clubLinks/${T_P}`))).exists()).toBe(false);
  });

  test('a non-admin cannot run it: it cannot list links, read tokens or delete a link', async () => {
    await assertFails(getDocs(collection(publicDb(), 'clubLinks')));
    await assertFails(deleteDoc(doc(publicDb(), `clubLinks/${T_P}`)));
    await assertFails(setDoc(doc(outsiderDb(), 'clubTokens/club-a'), { token: 'x' }));
  });
});

describe('one link across meets, end to end (real store code against these rules)', () => {
  const P = 'prelims-ab12';
  const F = 'finals-cd34';
  const NAMES = ['ann', 'bea', 'cy', 'dee', 'eve', 'fay'];
  const athlete = (meet: string, first: string, sessionId: string) => ({
    id: `WAG_club-a_${first}`, discipline: 'WAG', first, last: 'Test', clubId: 'club-a', clubName: 'Club A', independent: false,
    levelCode: 'XP', levelName: 'Platinum XP', sessionId, apparatus: ['VT', 'UB', 'BB', 'FX'], competes: true, meet,
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, `meets/${P}`), { name: 'Prelims', createdAt: Timestamp.fromMillis(1000), archived: false });
      await setDoc(doc(db, `meets/${F}`), { name: 'Finals', createdAt: Timestamp.fromMillis(2000), archived: false });
      for (const id of [P, F]) await setDoc(doc(db, `meets/${id}/settings/meet`), { meetName: id, orderDeadline: null });
      await setDoc(doc(db, `meets/${P}/sessions/p-s1`), { name: 'Prelims 1', location: 'Green', discipline: 'WAG', levelCodes: ['XP'] });
      await setDoc(doc(db, `meets/${F}/sessions/f-s1`), { name: 'Finals 1', location: 'Green', discipline: 'WAG', levelCodes: ['XP'] });
      for (const n of NAMES) await setDoc(doc(db, `meets/${P}/athletes/WAG_club-a_${n}`), athlete(P, n, 'p-s1'));
      for (const n of NAMES.slice(0, 5)) await setDoc(doc(db, `meets/${F}/athletes/WAG_club-a_${n}`), athlete(F, n, 'f-s1')); // fay did not make Finals
      for (const id of [P, F]) await setDoc(doc(db, `meets/${id}/clubs/club-a`), { name: 'Club A', emails: [] });
    });
  });

  test('publish both meets (one token, one merged link), the club orders Prelims, the admin copies to Finals, regenerate keeps everything', async () => {
    const { publishClubLinks } = await import('../../src/lib/data/store');
    const { loadOrderCopyInput, applyOrderCopy } = await import('../../src/lib/data/orders-copy-store');
    const { planOrderCopy } = await import('../../src/lib/orders-copy');
    const { regenerateClubLink } = await import('../../src/lib/data/email-store');
    const admin = domainAdminDb() as never;

    await publishClubLinks(admin, P);
    await publishClubLinks(admin, F);
    const tokens = await getDocs(collection(domainAdminDb(), 'clubTokens'));
    expect(tokens.docs).toHaveLength(1);
    const token = tokens.docs[0].data().token as string;
    const link = (await getDoc(doc(publicDb(), `clubLinks/${token}`))).data()!;
    expect(Object.keys(link.meets).sort()).toEqual([F, P]); // one link, both meets, the second publish did not drop the first
    expect(link.meets[P].levelKeys).toEqual(['p-s1__XP']);
    expect(link.meets[F].levelKeys).toEqual(['f-s1__XP']);
    expect(link.meets[F].sessions[0].levels[0].athletes).toHaveLength(5);

    // The club (no sign-in) sets its Prelims order: reversed.
    const rev = NAMES.map((n) => `WAG_club-a_${n}`).reverse();
    await assertSucceeds(setDoc(orderRef(publicDb(), token, 'p-s1__XP', P), order({ groups: [{ ids: rev }], sections: { VT: [{ ids: rev }], UB: [{ ids: rev }], BB: [{ ids: rev }], FX: [{ ids: rev }] } })));

    // Admin copies Prelims -> Finals.
    const input = await loadOrderCopyInput(admin, P, F);
    const plan = planOrderCopy(input, { replace: false });
    expect(plan).toMatchObject({ clubs: 1, levels: 1, athletes: 5, skippedSet: 0 });
    await applyOrderCopy(admin, F, plan);
    const copied = (await getDoc(orderRef(publicDb(), token, 'f-s1__XP', F))).data()!;
    expect(copied.groups).toEqual([{ ids: rev.filter((id) => !id.endsWith('_fay')) }]); // Fay is not in Finals
    expect(copied.sections.VT).toEqual([{ ids: rev.filter((id) => !id.endsWith('_fay')) }]);
    // A second run does not overwrite what is now set in Finals.
    const again = planOrderCopy(await loadOrderCopyInput(admin, P, F), { replace: false });
    expect(again).toMatchObject({ levels: 0, skippedSet: 1 });

    // The club can still change Finals (open deadline) with the same token.
    await assertSucceeds(setDoc(orderRef(publicDb(), token, 'f-s1__XP', F), order()));

    // Regenerate: new token, all meets' orders copied, link has both meets, old link gone.
    const club = { id: 'club-a', name: 'Club A', emails: [], token };
    const res = await regenerateClubLink(admin, F, club, () => 'brandNewTokenBBBBBBBBB');
    expect(res).toEqual({ token: 'brandNewTokenBBBBBBBBB', copied: 2, oldLinkRemoved: true });
    const fresh = (await getDoc(doc(publicDb(), 'clubLinks/brandNewTokenBBBBBBBBB'))).data()!;
    expect(Object.keys(fresh.meets).sort()).toEqual([F, P]);
    expect((await getDoc(doc(publicDb(), `clubLinks/${token}`))).exists()).toBe(false);
    await assertSucceeds(getDoc(orderRef(publicDb(), 'brandNewTokenBBBBBBBBB', 'p-s1__XP', P)));
    await assertSucceeds(setDoc(orderRef(publicDb(), 'brandNewTokenBBBBBBBBB', 'p-s1__XP', P), order()));
    await assertFails(setDoc(orderRef(publicDb(), token, 'p-s1__XP', P), order())); // the old link is dead
    expect((await getDoc(doc(domainAdminDb(), 'clubTokens/club-a'))).data()).toEqual({ token: 'brandNewTokenBBBBBBBBB' });

    // Archiving Prelims removes it from the link: no more writes there, Finals still open.
    const { unpublishMeetFromLinks } = await import('../../src/lib/data/store');
    await unpublishMeetFromLinks(admin, P);
    await assertFails(setDoc(orderRef(publicDb(), 'brandNewTokenBBBBBBBBB', 'p-s1__XP', P), order()));
    await assertSucceeds(setDoc(orderRef(publicDb(), 'brandNewTokenBBBBBBBBB', 'f-s1__XP', F), order()));
  });
});
