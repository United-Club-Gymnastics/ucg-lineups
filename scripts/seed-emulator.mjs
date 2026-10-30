// Dev only: fill the LOCAL Firestore + Auth emulators with an invented meet (no real clubs or people), so the admin screens can
// be tried in a browser. Run inside `firebase emulators:exec --only auth,firestore --project ucg-lineups '…'`; it connects to the
// emulator hosts only, signs in as an invented @unitedclubgymnastics.org admin (the emulator accepts an unsigned credential) and
// writes through the real rules.
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getFirestore, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';

const app = initializeApp({ projectId: 'ucg-lineups', apiKey: 'demo-key', authDomain: 'localhost' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8181);

await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: 'demo-admin', email: 'demo.admin@unitedclubgymnastics.org', email_verified: true })));

const M = 'demo-nationals';
const root = `meets/${M}`;
const FIRST = ['Ada', 'Bea', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal'];
const CLUBS = [
  { id: 'alpha-gymnastics', name: 'Alpha Gymnastics', emails: ['club@alpha.example'], contacts: [
    { name: 'Casey Coach', email: 'casey@alpha.example', role: 'Head Coach' },
    { name: 'Robin Assistant', email: 'robin@alpha.example', role: 'Assistant Coach' },
    { name: 'Tess Treasurer', email: 'tess@alpha.example', role: 'Treasurer' },
  ] },
  { id: 'bravo-academy', name: 'Bravo Academy', emails: ['club@bravo.example'], contacts: [
    { name: 'Sam Coach', email: 'sam@bravo.example', role: 'Head Coach' },
  ] },
  { id: 'charlie-club', name: 'Charlie Club', emails: ['club@charlie.example'], contacts: [] },
];
const sessions = {
  's1-orange': { name: 'Session 1', number: 1, location: 'Orange', gym: 'Orange', discipline: 'WAG', levelCodes: ['XS', 'XP'] },
  's2-green': { name: 'Session 2', number: 2, location: 'Green', gym: 'Green', discipline: 'MAG', levelCodes: ['Dev', 'Int'] },
};
const athletes = [];
const add = (club, sessionId, discipline, levelCode, n, withEmail) => {
  for (let i = 0; i < n; i++) {
    const first = FIRST[i];
    athletes.push({
      id: `${discipline}_${club.id}_${first.toLowerCase()}-test`, discipline, first, last: 'Test', clubId: club.id, clubName: club.name, independent: false,
      levelCode, levelName: levelCode, sessionId, apparatus: discipline === 'WAG' ? ['VT', 'UB', 'BB', 'FX'] : ['FX', 'PH', 'SR', 'VT', 'PB', 'HB'], competes: true,
      removed: false, ...(withEmail(i) ? { email: `${first.toLowerCase()}.${club.id.split('-')[0]}@example.org` } : {}),
    });
  }
};
add(CLUBS[0], 's1-orange', 'WAG', 'XS', 5, (i) => i !== 1);
add(CLUBS[1], 's1-orange', 'WAG', 'XP', 4, () => true);
add(CLUBS[2], 's1-orange', 'WAG', 'XP', 2, () => false);
add(CLUBS[0], 's2-green', 'MAG', 'Dev', 3, () => true);
athletes.push({
  id: 'WAG_independent-community-athlete_ivy-test', discipline: 'WAG', first: 'Ivy', last: 'Test', clubId: 'independent-community-athlete',
  clubName: 'Independent Community Athlete', independent: true, levelCode: 'XS', levelName: 'XS', sessionId: 's1-orange', apparatus: ['VT'], competes: true, removed: false,
  email: 'ivy.indy@example.org',
});

await setDoc(doc(db, root), { name: 'Demo Nationals (invented)', createdAt: serverTimestamp() });
await setDoc(doc(db, `${root}/settings/meet`), {
  meetName: 'Demo Nationals (invented)', meetDate: '', orderDeadline: null, gymOrder: ['Green', 'Red', 'Yellow', 'Orange', 'Purple'],
  schedule: { 1: { date: '2027-04-09', stretch: '7:30 AM', warmups: '8:00 AM', competition: '8:45 AM' }, 2: { date: '2027-04-09', competition: '1:15 PM' } },
});
const batch = writeBatch(db);
for (const [id, s] of Object.entries(sessions)) batch.set(doc(db, `${root}/sessions/${id}`), s);
for (const c of CLUBS) batch.set(doc(db, `${root}/clubs/${c.id}`), { name: c.name, emails: c.emails, contacts: c.contacts });
for (const a of athletes) batch.set(doc(db, `${root}/athletes/${a.id}`), a);
await batch.commit();
console.log(`Seeded ${root}: ${athletes.length} athletes, ${CLUBS.length} clubs, ${Object.keys(sessions).length} sessions.`);
process.exit(0);
