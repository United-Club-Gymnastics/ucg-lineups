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
const TOKEN2 = 'tokenCCCCCCCCCCCCCCCCCC'; // the same club's link for the second meet
const LEVEL = 's1-green__L7';
const past = () => Timestamp.fromMillis(Date.now() - 3600e3);
const future = () => Timestamp.fromMillis(Date.now() + 3600e3);

const M1 = 'nationals-ab12';
const M2 = 'regionals-cd34';
const m = (meet: string, path: string) => `meets/${meet}/${path}`;

/** Two meets: M1 (the default under test) and M2. TOKEN/OTHER belong to M1; X2 belongs to M2. */
async function seed(deadline: Timestamp | null = null, deadline2: Timestamp | null = null) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, m(M1, 'settings/meet')), { meetName: 'Test Nationals', orderDeadline: deadline });
    await setDoc(doc(db, m(M2, 'settings/meet')), { meetName: 'Test Regionals', orderDeadline: deadline2 });
    await setDoc(doc(db, `meets/${M1}`), { name: 'Test Nationals' });
    await setDoc(doc(db, `meets/${M2}`), { name: 'Test Regionals' });
    for (const [t, id, meetId, keys] of [
      [TOKEN, 'club-a', M1, [LEVEL, 's1-green__L8']],
      [OTHER, 'club-b', M1, ['s2-red__L7']],
      [TOKEN2, 'club-a', M2, [LEVEL]],
    ] as const) {
      await setDoc(doc(db, `clubLinks/${t}`), { meetId, clubId: id, clubName: `Club ${id}`, sessions: [], levelKeys: keys });
    }
    for (const meet of [M1, M2]) {
      await setDoc(doc(db, m(meet, 'athletes/WAG_0001')), { first: 'Ann', last: 'Example' });
      await setDoc(doc(db, m(meet, 'clubs/club-a')), { name: 'Club A', token: TOKEN, emails: ['coach@example.com'] });
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
    await assertFails(setDoc(doc(publicDb(), 'clubLinks/mine'), { meetId: M1, clubId: 'x', clubName: 'X', sessions: [], levelKeys: [LEVEL] }));
    await assertFails(updateDoc(doc(publicDb(), `clubLinks/${TOKEN}`), { levelKeys: ['anything'] }));
    await assertFails(deleteDoc(doc(publicDb(), `clubLinks/${TOKEN}`)));
  });

  test('admins can write links', async () => {
    await assertSucceeds(setDoc(doc(domainAdminDb(), 'clubLinks/new'), { meetId: M1, clubId: 'x', clubName: 'X', sessions: [], levelKeys: [] }));
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

  test("a club is locked by ITS meet's deadline, not another meet's", async () => {
    // M1 closed, M2 open: the M1 club is locked, the M2 link (same club, same level key) still writes.
    await seed(past(), future());
    await assertFails(setDoc(orderRef(publicDb(), TOKEN), order()));
    await assertSucceeds(setDoc(orderRef(publicDb(), TOKEN2), order()));
    // And the other way round: M1 open, M2 closed.
    await seed(future(), past());
    await assertSucceeds(setDoc(orderRef(publicDb(), TOKEN), order()));
    await assertFails(setDoc(orderRef(publicDb(), TOKEN2), order()));
    // Admins still write after a deadline.
    await assertSucceeds(setDoc(orderRef(domainAdminDb(), TOKEN2), order()));
  });

  test('a link whose meet has no settings, or that has no meetId, cannot write (fails closed)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'clubLinks/noMeetIdTokenAAAAAA'), { clubId: 'x', clubName: 'X', sessions: [], levelKeys: [LEVEL] });
      await setDoc(doc(db, 'clubLinks/ghostMeetTokenAAAAA'), { meetId: 'ghost-0000', clubId: 'x', clubName: 'X', sessions: [], levelKeys: [LEVEL] });
    });
    await assertFails(setDoc(orderRef(publicDb(), 'noMeetIdTokenAAAAAA'), order()));
    await assertFails(setDoc(orderRef(publicDb(), 'ghostMeetTokenAAAAA'), order()));
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

  test('once attached, the link works again for the club: it reads its saved order and, before the deadline, writes', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `clubLinks/${LINK}`), { meetId: M2 }, { merge: true });
    });
    await assertSucceeds(getDoc(orderRef(publicDb(), LINK)));
    await assertSucceeds(setDoc(orderRef(publicDb(), LINK), order()));
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
