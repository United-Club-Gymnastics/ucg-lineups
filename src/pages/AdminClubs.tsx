import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth, db } from '../lib/firebase';
import { Tabs } from '../components/ui';
import ClubsTable from '../components/clubs/ClubsTable';
import ReminderPanel, { type ClubsView } from '../components/clubs/ReminderPanel';
import OrderCopyDialog from '../components/OrderCopyDialog';
import { listMeets, type MeetInfo } from '../lib/data/meet-store';
import { applyOrderCopy, loadOrderCopyInput } from '../lib/data/orders-copy-store';
import { buildClubRows } from '../lib/club-overview';
import { loadClubsScreenData, regenerateClubLink, saveClubEmails, saveOrderDeadline, watchClubsLive, type ClubsLive, type ClubsScreenData, type EmailLogEntry } from '../lib/data/email-store';
import { dateToPacific, formatDeadline, pacificToDate } from '../lib/pacific';
import './clubs.css';

type Loaded = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: ClubsScreenData };

/** The page address without a hash: where the club links point (the admin is on the same site the clubs will use). */
const pageBase = () => `${window.location.origin}${window.location.pathname}`;

export default function AdminClubs({ meetId, pauseMs }: { meetId: string; pauseMs?: number }) {
  const [load, setLoad] = useState<Loaded>({ kind: 'loading' });
  const fetchData = useCallback(() => {
    loadClubsScreenData(db, meetId)
      .then((data) => setLoad({ kind: 'ready', data }))
      .catch((e) => setLoad({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load the clubs.' }));
  }, [meetId]);
  useEffect(() => { fetchData(); }, [fetchData]);

  // Live updates: after the first load, the clubs, athletes, sessions and every club's saved orders are listened to, so a club
  // changing its order shows here without a refresh. `attempt` restarts the listeners (Retry).
  const loaded = load.kind === 'ready';
  const [live, setLive] = useState<ClubsLive | null>(null);
  const [liveError, setLiveError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!loaded) return;
    return watchClubsLive(db, meetId, {
      onChange: (s) => { setLive(s); setLiveError(''); },
      onError: (e) => setLiveError(e.message || 'Live updates stopped.'),
    });
  }, [loaded, meetId, attempt]);

  if (load.kind === 'loading') return <section className="adm-card"><p role="status">Loading clubs, orders and the send log…</p></section>;
  if (load.kind === 'error') {
    return (
      <section className="adm-card">
        <div className="adm-banner err" role="alert">{load.message}</div>
        <button type="button" className="btn" onClick={() => { setLoad({ kind: 'loading' }); fetchData(); }}>Try again</button>
      </section>
    );
  }
  return (
    <ClubsScreen
      meetId={meetId} data={load.data} live={live} pauseMs={pauseMs}
      liveStatus={liveError ? { error: liveError } : live ? 'live' : 'connecting'}
      onRetryLive={() => { setLiveError(''); setAttempt((n) => n + 1); }}
    />
  );
}

const VIEWS: { id: ClubsView; label: string }[] = [
  { id: 'clubs', label: 'Clubs' },
  { id: 'email', label: 'Who to email' },
  { id: 'message', label: 'Message & preview' },
];

export function ClubsScreen({ meetId, data, live = null, liveStatus = 'connecting', onRetryLive, pauseMs }: {
  meetId: string;
  data: ClubsScreenData;
  /** The live picture once the listeners have answered; until then (and if they fail) the one-time load is shown. */
  live?: ClubsLive | null;
  liveStatus?: 'connecting' | 'live' | { error: string };
  onRetryLive?: () => void;
  pauseMs?: number;
}) {
  const [view, setView] = useState<ClubsView>('clubs');
  const [localClubs, setClubs] = useState(data.clubs);
  const [log, setLog] = useState<EmailLogEntry[]>(data.log);
  const [deadline, setDeadline] = useState<Date | null>(data.deadline);
  const clubs = live?.clubs ?? localClubs;
  const athletes = live?.athletes ?? data.athletes;
  const sessions = live?.sessions ?? data.sessions;
  const saved = live?.saved ?? data.saved;
  const rows = useMemo(() => buildClubRows(athletes, sessions, clubs, saved, data.gymOrder), [athletes, sessions, clubs, saved, data.gymOrder]);
  const linkBase = pageBase();
  const [copyMeets, setCopyMeets] = useState<MeetInfo[] | null>(null);
  const [copyError, setCopyError] = useState('');
  const copyApi = useMemo(() => ({
    load: (sourceId: string, targetId: string) => loadOrderCopyInput(db, sourceId, targetId),
    apply: (plan: Parameters<typeof applyOrderCopy>[2], onProgress: (d: number, t: number) => void) => applyOrderCopy(db, meetId, plan, onProgress),
  }), [meetId]);

  return (
    <div className="cl">
      <LiveStatus status={liveStatus} onRetry={onRetryLive} />
      <Tabs pill tabs={VIEWS} active={view} onChange={setView} />
      <div hidden={view !== 'clubs'} className="cl-view">
      <DeadlineCard meetId={meetId} deadline={deadline} onSaved={setDeadline} />
      {copyError && <div className="adm-banner err" role="alert">{copyError}</div>}
      <ClubsTable
        rows={rows}
        onStartFromMeet={() => {
          setCopyError('');
          listMeets(db).then((all) => setCopyMeets(all.filter((m) => !m.archived)), (e) => setCopyError(`Could not load the meets: ${e instanceof Error ? e.message : 'try again'}`));
        }}
        linkBase={linkBase}
        onSaveEmails={async (clubId, emails) => {
          await saveClubEmails(db, meetId, clubId, emails);
          setClubs((prev) => prev.map((c) => (c.id === clubId ? { ...c, emails } : c)));
        }}
        onRegenerate={async (row) => {
          const club = clubs.find((c) => c.id === row.id);
          if (!club) throw new Error('Club not found.');
          const res = await regenerateClubLink(db, meetId, club);
          setClubs((prev) => prev.map((c) => (c.id === row.id ? { ...c, token: res.token } : c)));
          return res;
        }}
      />
      </div>
      {copyMeets && copyMeets.find((m) => m.id === meetId) && (
        <OrderCopyDialog
          target={copyMeets.find((m) => m.id === meetId)!}
          meets={copyMeets}
          api={copyApi}
          onClose={() => setCopyMeets(null)}
          onDone={() => setCopyMeets(null)}
        />
      )}
      <ReminderPanel
        view={view}
        onView={setView}
        meetId={meetId}
        rows={rows}
        templates={data.templates}
        meetName={data.meetName}
        deadline={deadline}
        linkBase={linkBase}
        adminEmail={auth.currentUser?.email ?? ''}
        log={log}
        onLogged={(e) => setLog((prev) => [e, ...prev])}
        pauseMs={pauseMs}
        details={{
          sessions, athletes, clubs, gymOrder: data.gymOrder,
          schedule: data.schedule, meetDate: data.meetDate, sessionTemplate: data.sessionTemplate, coachRoles: data.coachRoles,
        }}
      />
    </div>
  );
}

function LiveStatus({ status, onRetry }: { status: 'connecting' | 'live' | { error: string }; onRetry?: () => void }) {
  if (typeof status === 'object') {
    return (
      <div className="adm-banner err cl-live-err" role="alert">
        <span>Live updates stopped ({status.error}). What you see may be out of date.</span>
        {onRetry && <button type="button" className="btn small" onClick={onRetry}>Retry</button>}
      </div>
    );
  }
  return (
    <p className={`cl-live ${status}`} role="status">
      <span className="cl-live-dot" aria-hidden="true" />
      {status === 'live' ? 'Live: changes from clubs appear here by themselves' : 'Connecting to live updates…'}
    </p>
  );
}

function DeadlineCard({ meetId, deadline, onSaved }: { meetId: string; deadline: Date | null; onSaved: (d: Date | null) => void }) {
  const initial = deadline ? dateToPacific(deadline) : { date: '', time: '23:59' };
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ kind: 'idle' });
  const parsed = pacificToDate(date, time);
  const dirty = (deadline?.getTime() ?? null) !== (parsed?.getTime() ?? null);

  async function save(next: Date | null) {
    setState({ kind: 'saving' });
    try {
      await saveOrderDeadline(db, meetId, next);
      onSaved(next);
      setState({ kind: 'saved', text: next ? 'Saved' : 'Deadline removed' });
    } catch (e) {
      setState({ kind: 'error', text: `Couldn't save: ${e instanceof Error ? e.message : 'try again'}` });
    }
  }

  return (
    <section className="adm-card" aria-labelledby="cl-dl-h">
      <h2 className="display" id="cl-dl-h">Order deadline</h2>
      <p className="adm-muted">Clubs can change their orders until this time (Pacific). Reminder emails say it as {'{deadline}'}.</p>
      <div className="cl-filters">
        <label className="cl-field"><span>Date</span><input type="date" value={date} onChange={(e) => { setDate(e.target.value); setState({ kind: 'idle' }); }} /></label>
        <label className="cl-field"><span>Time (Pacific)</span><input type="time" value={time} onChange={(e) => { setTime(e.target.value); setState({ kind: 'idle' }); }} /></label>
        <button type="button" className="btn" disabled={!parsed || !dirty || state.kind === 'saving'} onClick={() => void save(parsed)}>Save deadline</button>
        {deadline && <button type="button" className="btn ghost" disabled={state.kind === 'saving'} onClick={() => { setDate(''); void save(null); }}>Remove deadline</button>}
      </div>
      <p className={`cl-state${state.kind === 'error' ? ' err' : ''}`} role={state.kind === 'error' ? 'alert' : 'status'}>
        {state.text ?? (deadline ? `Saved deadline: ${formatDeadline(deadline)}` : 'No deadline set: clubs can change their orders any time.')}
      </p>
    </section>
  );
}
