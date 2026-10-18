// Read-only access to the Synchro partner tool's public Firestore collection
// (project ucg-nationals-tools). A second, named Firebase app; no writes are made.
import { getApp, getApps, initializeApp } from 'firebase/app';
import { collection, getDocs, getFirestore } from 'firebase/firestore';

const synchroConfig = {
  apiKey: 'AIzaSyDKIEe2is-C2y5soEnX207ChJ3jnMcAfn8',
  authDomain: 'ucg-nationals-tools.firebaseapp.com',
  projectId: 'ucg-nationals-tools',
  appId: '1:715467172013:web:caaae161f7d5a81957fe24',
};

const APP_NAME = 'synchro-source';

export interface SynchroPair {
  id: string;
  level: string;
  a1: string;
  name1: string;
  club1: string;
  a2: string;
  name2: string;
  club2: string;
  createdAt: unknown;
  source: string;
}

function synchroDb() {
  const app = getApps().some((a) => a.name === APP_NAME)
    ? getApp(APP_NAME)
    : initializeApp(synchroConfig, APP_NAME);
  return getFirestore(app);
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Dev builds only: `window.__ucgSynchroPairs = [...]` stands in for the live read (tree-shaken from production builds). */
declare global {
  interface Window { __ucgSynchroPairs?: SynchroPair[] }
}

export async function fetchSynchroPairs(): Promise<SynchroPair[]> {
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.__ucgSynchroPairs) return window.__ucgSynchroPairs;
  const snap = await getDocs(collection(synchroDb(), 'synchroPairs'));
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      level: str(x.level),
      a1: str(x.a1),
      name1: str(x.name1),
      club1: str(x.club1),
      a2: str(x.a2),
      name2: str(x.name2),
      club2: str(x.club2),
      createdAt: x.createdAt ?? null,
      source: str(x.source),
    };
  });
}
