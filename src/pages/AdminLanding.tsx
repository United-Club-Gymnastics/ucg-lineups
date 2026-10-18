import { lazy, Suspense, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { isDomainAdmin, onUser, signInAdmin, signOutAdmin } from '../lib/firebase';
import { Tabs } from '../components/ui';
// Lazy: pulls in ExcelJS, which is large and only admins need.
const AdminImport = lazy(() => import('./AdminImport'));
const AdminSquads = lazy(() => import('./AdminSquads'));
import './admin.css';

type Tab = 'import' | 'clubs' | 'squads' | 'tnt' | 'exports';

const TABS: { id: Tab; label: string }[] = [
  { id: 'import', label: 'Import' },
  { id: 'clubs', label: 'Clubs & email' },
  { id: 'squads', label: 'Squads' },
  { id: 'tnt', label: 'T&T' },
  { id: 'exports', label: 'Exports' },
];

function ComingNext({ label }: { label: string }) {
  return (
    <section className="adm-card">
      <h2 className="display">{label}</h2>
      <p className="adm-muted">Coming next.</p>
    </section>
  );
}

export default function AdminLanding() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('import');
  const [error, setError] = useState('');

  useEffect(() => onUser(setUser), []);

  async function signIn() {
    setError('');
    try {
      await signInAdmin();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    }
  }

  if (user === undefined) {
    return <main className="adm-gate"><p>Loading…</p></main>;
  }

  if (!isDomainAdmin(user)) {
    return (
      <main className="adm-gate">
        <h1 className="display" style={{ fontSize: 40 }}>UCG Lineups</h1>
        {user ? (
          <div className="adm-banner err" role="alert">
            Use your @unitedclubgymnastics.org account. You are signed in as {user.email}.
          </div>
        ) : (
          <p>Admins sign in with their UCG Google account.</p>
        )}
        {error && <div className="adm-banner err" role="alert">{error}</div>}
        <div className="adm-actions">
          {user && <button className="btn ghost" type="button" onClick={() => void signOutAdmin()}>Sign out</button>}
          <button className="btn primary" type="button" onClick={() => void signIn()}>
            {user ? 'Switch account' : 'Sign in with Google'}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="adm">
      <header className="adm-head">
        <h1 className="display">UCG Lineups</h1>
        <div className="adm-user">
          <span>{user!.email}</span>
          <button className="btn ghost small" type="button" onClick={() => void signOutAdmin()}>Sign out</button>
        </div>
      </header>
      <nav aria-label="Admin sections" className="adm-tabs">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </nav>
      {tab === 'import' && <Suspense fallback={<p>Loading…</p>}><AdminImport /></Suspense>}
      {tab === 'squads' && <Suspense fallback={<p>Loading…</p>}><AdminSquads /></Suspense>}
      {tab !== 'import' && tab !== 'squads' && <ComingNext label={TABS.find((t) => t.id === tab)!.label} />}
    </main>
  );
}
