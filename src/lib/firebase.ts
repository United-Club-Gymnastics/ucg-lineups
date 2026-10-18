// Port of nationals-tools public/shared/firebase.js (same behaviour, TypeScript, npm SDK).
import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

export const ADMIN_DOMAIN = 'unitedclubgymnastics.org';

// Public web config (safe to commit; access is enforced by firestore.rules).
const firebaseConfig = {
  apiKey: 'AIzaSyCf7XdpS7QvArMdImw05PaTuVcRfxUJs8U',
  authDomain: 'ucg-lineups.firebaseapp.com',
  projectId: 'ucg-lineups',
  storageBucket: 'ucg-lineups.firebasestorage.app',
  messagingSenderId: '477552512737',
  appId: '1:477552512737:web:c8e20b2a1a79584e98b1a0',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

if (import.meta.env.VITE_USE_EMULATOR === '1') {
  connectFirestoreEmulator(db, '127.0.0.1', 8181);
  // VITE_AUTH_EMULATOR_PORT lets a second emulator suite run beside another project's (default 9099).
  connectAuthEmulator(auth, `http://127.0.0.1:${import.meta.env.VITE_AUTH_EMULATOR_PORT ?? '9099'}`, { disableWarnings: true });
}

export function signInAdmin() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: ADMIN_DOMAIN, prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}

/**
 * Asks the signed-in admin for permission to send Gmail on their behalf and returns a
 * short-lived (about 1 hour) access token. Nothing is stored.
 */
export async function connectGmail(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in first.');
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/gmail.send');
  provider.setCustomParameters({ login_hint: user.email ?? '' });
  const result = await reauthenticateWithPopup(user, provider);
  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) throw new Error('Google did not grant Gmail access.');
  return token;
}

export function signOutAdmin() {
  return signOut(auth);
}

export function onUser(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

/** Matches the domain check in firestore.rules; the rules are what actually enforce it. */
export function isDomainAdmin(user: User | null | undefined): boolean {
  return !!user?.emailVerified && !!user.email && user.email.toLowerCase().endsWith(`@${ADMIN_DOMAIN}`);
}
