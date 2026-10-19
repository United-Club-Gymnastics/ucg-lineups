import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { isDomainAdmin, onUser, signInAdmin, signOutAdmin } from '../lib/firebase';
import { Tabs } from '../components/ui';
import MeetSwitcher, { FirstMeet } from '../components/MeetSwitcher';
import { db } from '../lib/firebase';
import LegacyCopyDialog from '../components/LegacyCopyDialog';
import { applyLegacyOps, hasLegacyData, loadLegacy, loadMeetState } from '../lib/data/legacy-store';
import { createMeet, listMeets, renameMeet, setMeetArchived, type MeetInfo } from '../lib/data/meet-store';
import { hasTntSessions } from '../lib/data/store';
import { pickMeet, readSelectedMeet, visibleMeets, writeSelectedMeet } from '../lib/selected-meet';
// Lazy: pulls in ExcelJS, which is large and only admins need.
const AdminImport = lazy(() => import('./AdminImport'));
const AdminSquads = lazy(() => import('./AdminSquads'));
const AdminTnt = lazy(() => import('./AdminTnt'));
const AdminExports = lazy(() => import('./AdminExports'));
const AdminClubs = lazy(() => import('./AdminClubs'));
import './admin.css';

type Tab = 'import' | 'clubs' | 'squads' | 'tnt' | 'exports';

const TABS: { id: Tab; label: string }[] = [
  // Order and names per Julia 2026-10-18; the admin lands on Artistic Squads.
  { id: 'squads', label: 'Artistic Squads' },
  { id: 'tnt', label: 'T&T Squads' },
  { id: 'exports', label: 'Exports' },
  { id: 'clubs', label: 'Clubs & Emails' },
  { id: 'import', label: 'Import' },
];

export default function AdminLanding() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('squads');
  const [error, setError] = useState('');
  const [meets, setMeets] = useState<MeetInfo[] | null>(null);
  const [meetsError, setMeetsError] = useState('');
  const [meetId, setMeetId] = useState<string | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);
  // null = not known yet (the tab shows until we know). Re-checked on each tab change so a T&T import shows it straight away.
  const [hasTnt, setHasTnt] = useState<boolean | null>(null);
  useEffect(() => {
    if (!meetId) return;
    let live = true;
    hasTntSessions(db, meetId).then((v) => { if (live) setHasTnt(v); }, () => { if (live) setHasTnt(null); });
    return () => { live = false; };
  }, [meetId, tab]);
  const tabs = hasTnt === false ? TABS.filter((t) => t.id !== 'tnt') : TABS;
  // With no T&T sessions the T&T tab is gone: show Artistic Squads instead of a missing tab.
  const shown: Tab = hasTnt === false && tab === 'tnt' ? 'squads' : tab;

  useEffect(() => onUser(setUser), []);

  const isAdmin = isDomainAdmin(user);
  const loadMeets = useCallback((prefer?: string | null) => listMeets(db).then((all) => {
    setMeetsError('');
    setMeets(all);
    const id = pickMeet(all, prefer ?? readSelectedMeet());
    setMeetId(id);
    if (id) writeSelectedMeet(id);
  }, (e) => {
    setMeetsError(e instanceof Error ? e.message : 'Could not load the meets.');
  }), []);
  useEffect(() => { if (isAdmin) void loadMeets(); }, [isAdmin, loadMeets]);
  // Cheap existence check; the button only shows when there is earlier data to bring in.
  useEffect(() => { if (isAdmin) void hasLegacyData(db).then(setLegacy); }, [isAdmin]);

  function selectMeet(id: string) {
    setMeetId(id);
    writeSelectedMeet(id);
  }
  async function onCreateMeet(name: string) {
    const id = await createMeet(db, name);
    await loadMeets(id);
  }

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
      {meetsError && (
        <div className="adm-banner err" role="alert">
          Could not load the meets: {meetsError}
          <div className="adm-actions"><button className="btn" type="button" onClick={() => void loadMeets()}>Try again</button></div>
        </div>
      )}
      {!meetsError && meets === null && <p role="status">Loading meets…</p>}
      {meets && visibleMeets(meets).length === 0 && <FirstMeet onCreate={onCreateMeet} />}
      {meets && visibleMeets(meets).length === 0 && legacy && (
        <p><button className="btn ghost" type="button" onClick={() => setLegacyOpen(true)}>Bring in earlier data</button></p>
      )}
      {meets && legacyOpen && (
        <LegacyCopyDialog
          meets={visibleMeets(meets)}
          defaultMeetId={meetId}
          api={{
            load: () => loadLegacy(db),
            loadMeet: (id) => loadMeetState(db, id),
            createMeet: (name) => createMeet(db, name),
            apply: (ops, onProgress) => applyLegacyOps(db, ops, onProgress),
          }}
          onClose={() => setLegacyOpen(false)}
          onDone={(id) => { setLegacyOpen(false); void loadMeets(id); }}
        />
      )}
      {meets && meetId && (
        <>
          <MeetSwitcher
            meets={visibleMeets(meets)}
            selectedId={meetId}
            onSelect={selectMeet}
            onCreate={onCreateMeet}
            onRename={async (name) => { await renameMeet(db, meetId, name); await loadMeets(meetId); }}
            onArchive={async () => { await setMeetArchived(db, meetId, true); await loadMeets(null); }}
            onBringInData={legacy ? () => setLegacyOpen(true) : undefined}
          />
          <nav aria-label="Admin sections" className="adm-tabs">
            <Tabs tabs={tabs} active={shown} onChange={setTab} />
          </nav>
          {/* key={meetId}: switching meets remounts the screen, so nothing from the other meet is shown or saved into this one. */}
          {shown === 'import' && <Suspense fallback={<p>Loading…</p>}><AdminImport key={meetId} meetId={meetId} /></Suspense>}
          {shown === 'squads' && <Suspense fallback={<p>Loading…</p>}><AdminSquads key={meetId} meetId={meetId} onOpenSchedule={() => setTab('exports')} /></Suspense>}
          {shown === 'tnt' && <Suspense fallback={<p>Loading…</p>}><AdminTnt key={meetId} meetId={meetId} /></Suspense>}
          {shown === 'exports' && <Suspense fallback={<p>Loading…</p>}><AdminExports key={meetId} meetId={meetId} /></Suspense>}
          {shown === 'clubs' && <Suspense fallback={<p>Loading…</p>}><AdminClubs key={meetId} meetId={meetId} /></Suspense>}
        </>
      )}
    </main>
  );
}
