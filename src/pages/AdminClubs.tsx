import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth, db } from '../lib/firebase';
import ClubsTable from '../components/clubs/ClubsTable';
import ReminderPanel from '../components/clubs/ReminderPanel';
import { buildClubRows } from '../lib/club-overview';
import { loadClubsScreenData, regenerateClubLink, saveClubEmails, saveOrderDeadline, type ClubsScreenData, type EmailLogEntry } from '../lib/data/email-store';
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

  if (load.kind === 'loading') return <section className="adm-card"><p role="status">Loading clubs, orders and the send log…</p></section>;
  if (load.kind === 'error') {
    return (
      <section className="adm-card">
        <div className="adm-banner err" role="alert">{load.message}</div>
        <button type="button" className="btn" onClick={() => { setLoad({ kind: 'loading' }); fetchData(); }}>Try again</button>
      </section>
    );
  }
  return <ClubsScreen meetId={meetId} data={load.data} pauseMs={pauseMs} />;
}

export function ClubsScreen({ meetId, data, pauseMs }: { meetId: string; data: ClubsScreenData; pauseMs?: number }) {
  const [clubs, setClubs] = useState(data.clubs);
  const [log, setLog] = useState<EmailLogEntry[]>(data.log);
  const [deadline, setDeadline] = useState<Date | null>(data.deadline);
  const rows = useMemo(() => buildClubRows(data.athletes, data.sessions, clubs, data.saved, data.gymOrder), [data, clubs]);
  const linkBase = pageBase();

  return (
    <div className="cl">
      <DeadlineCard meetId={meetId} deadline={deadline} onSaved={setDeadline} />
      <ClubsTable
        rows={rows}
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
      <ReminderPanel
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
      />
    </div>
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
