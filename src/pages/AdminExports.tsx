import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../lib/firebase';
import { PagePreview } from '../components/PdfPreview';
import { loadExportsInput, saveCompetitionTime, saveMeetNameDate, type ExportsInput } from '../lib/data/export-store';
import { sessionFileName, sessionPages, type ExportKind } from '../lib/pdf/collate';
import { buildExportSessions, withOverrides } from '../lib/pdf/export-all';
import { allSessionsPdf, allSessionsZip, sessionPdf } from '../lib/pdf/files';
import { jumpGroups } from '../lib/pdf/model';
import './exports.css';

type Loaded = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; input: ExportsInput };

const printedOn = (): string => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function save(name: string, bytes: Blob | ArrayBuffer) {
  const url = URL.createObjectURL(new Blob([bytes], { type: name.endsWith('.zip') ? 'application/zip' : 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function AdminExports() {
  const [load, setLoad] = useState<Loaded>({ kind: 'loading' });
  const fetchInput = useCallback(() => {
    loadExportsInput(db)
      .then((input) => setLoad({ kind: 'ready', input }))
      .catch((e) => setLoad({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load the data to export.' }));
  }, []);
  useEffect(() => { fetchInput(); }, [fetchInput]);
  const refresh = () => { setLoad({ kind: 'loading' }); fetchInput(); };

  if (load.kind === 'loading') return <section className="adm-card"><p role="status">Loading sessions, squads and orders…</p></section>;
  if (load.kind === 'error') {
    return (
      <section className="adm-card">
        <div className="adm-banner err" role="alert">{load.message}</div>
        <button type="button" className="btn" onClick={refresh}>Try again</button>
      </section>
    );
  }
  return <ExportsScreen input={load.input} onReload={refresh} />;
}

export function ExportsScreen({ input, onReload }: { input: ExportsInput; onReload: () => void }) {
  const built = useMemo(() => buildExportSessions({ ...input, meet: { name: input.meet.meetName, date: input.meet.meetDate } }), [input]);

  // Meet name/date and a T&T competition time: typed here, shown in the sheets at once, saved with the Save buttons.
  const [name, setName] = useState(input.meet.meetName);
  const [date, setDate] = useState(input.meet.meetDate);
  const [meetState, setMeetState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [savedMeet, setSavedMeet] = useState({ name: input.meet.meetName, date: input.meet.meetDate });
  const meetDirty = name.trim() !== savedMeet.name || date.trim() !== savedMeet.date;
  const [times, setTimes] = useState<Record<string, string>>({});
  const [timeState, setTimeState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const sessions = useMemo(() => withOverrides(built.sessions, { meet: { name: name.trim(), date: date.trim() }, competitionTimes: times }), [built, name, date, times]);
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? '');
  const [kind, setKind] = useState<ExportKind>('scorecards');
  const selected = sessions.find((s) => s.id === sessionId) ?? sessions[0];
  const printed = useMemo(() => printedOn(), []);
  const pages = useMemo(() => (selected ? sessionPages(kind, selected.input, printed) : []), [selected, kind, printed]);
  const jump = useMemo(() => jumpGroups(pages), [pages]);

  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  async function run(label: string, work: () => Promise<{ name: string; bytes: Blob | ArrayBuffer }>) {
    setBusy(label);
    setError('');
    setNote('');
    try {
      const file = await work();
      save(file.name, file.bytes);
      setNote(`Downloaded ${file.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make the file.');
    } finally {
      setBusy('');
    }
  }

  const all = sessions.map((s) => s.input);
  const gymOrder = input.gymOrder;

  async function saveMeet() {
    setMeetState('saving');
    try { await saveMeetNameDate(db, { meetName: name, meetDate: date }); setSavedMeet({ name: name.trim(), date: date.trim() }); setMeetState('saved'); } catch { setMeetState('error'); }
  }
  async function saveTime() {
    if (!selected || selected.input.type !== 'tnt') return;
    setTimeState('saving');
    try { await saveCompetitionTime(db, selected.id, times[selected.id] ?? selected.input.input.competitionTime); setTimeState('saved'); } catch { setTimeState('error'); }
  }

  const goTo = (index: number) => {
    const el = pageRefs.current[index];
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  };

  return (
    <div className="ex">
      <section className="adm-card">
        <h2 className="display">Meet</h2>
        <p className="adm-muted">Printed in every header. Saved to the meet settings (not shown to clubs beyond the public meet page).</p>
        <div className="ex-fields">
          <label className="ex-field"><span>Meet name</span><input value={name} onChange={(e) => { setName(e.target.value); setMeetState('idle'); }} placeholder="UCG Nationals 2026" /></label>
          <label className="ex-field"><span>Meet date</span><input value={date} onChange={(e) => { setDate(e.target.value); setMeetState('idle'); }} placeholder="October 22–25, 2026" /></label>
          <button type="button" className="btn" onClick={() => void saveMeet()} disabled={!meetDirty || meetState === 'saving'}>{meetState === 'saving' ? 'Saving…' : 'Save'}</button>
        </div>
        <div className="ex-state" role="status">
          {meetState === 'saved' && !meetDirty && 'Saved.'}
          {meetState === 'error' && 'Could not save. Try again.'}
          {meetDirty && meetState !== 'saving' && meetState !== 'error' && 'Not saved yet. The sheets below already use what you typed.'}
        </div>
      </section>

      {built.warnings.length > 0 && (
        <section className="adm-card" aria-labelledby="ex-warn">
          <h2 id="ex-warn" className="display">Check before printing</h2>
          <p className="adm-muted">You can still download everything. These sheets will be missing people or pages.</p>
          <ul className="adm-warnings ex-warnings">
            {built.warnings.map((w, i) => <li key={i}><b>{w.session}:</b> {w.text}</li>)}
          </ul>
        </section>
      )}

      <section className="adm-card">
        <div className="ex-row">
          <label className="ex-field">
            <span>Session</span>
            <select value={selected?.id ?? ''} onChange={(e) => setSessionId(e.target.value)} disabled={sessions.length === 0}>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.title} ({s.session.discipline === 'TNT' ? 'T&T' : s.session.discipline})</option>)}
            </select>
          </label>
          <div className="ex-seg" role="group" aria-label="Export">
            <button type="button" aria-pressed={kind === 'scorecards'} onClick={() => setKind('scorecards')}>Scorecards</button>
            <button type="button" aria-pressed={kind === 'rotation'} onClick={() => setKind('rotation')}>Rotation sheet</button>
          </div>
          <button type="button" className="btn ghost small" onClick={onReload}>Reload data</button>
        </div>

        {selected?.input.type === 'tnt' && (
          <div className="ex-fields">
            <label className="ex-field"><span>Competition time (shown on the rotation sheet)</span>
              <input value={times[selected.id] ?? selected.input.input.competitionTime} onChange={(e) => { setTimes((t) => ({ ...t, [selected.id]: e.target.value })); setTimeState('idle'); }} placeholder="Thursday 7:30 AM" />
            </label>
            <button type="button" className="btn" onClick={() => void saveTime()} disabled={timeState === 'saving'}>{timeState === 'saving' ? 'Saving…' : 'Save time'}</button>
            <span className="ex-state" role="status">{timeState === 'saved' ? 'Saved.' : timeState === 'error' ? 'Could not save. Try again.' : ''}</span>
          </div>
        )}

        <div className="adm-actions">
          <button type="button" className="btn primary" disabled={!selected || !!busy} onClick={() => selected && void run('one', () => sessionPdf(kind, selected.input, printed))}>
            {busy === 'one' ? 'Making PDF…' : 'Download this session'}
          </button>
          <button type="button" className="btn" disabled={sessions.length === 0 || !!busy} onClick={() => void run('all', () => allSessionsPdf(kind, all, gymOrder, printed))}>
            {busy === 'all' ? 'Making PDF…' : 'All sessions, one PDF'}
          </button>
          <button type="button" className="btn" disabled={sessions.length === 0 || !!busy} onClick={() => void run('zip', () => allSessionsZip(kind, all, gymOrder, printed))}>
            {busy === 'zip' ? 'Making zip…' : 'All sessions, separate PDFs'}
          </button>
        </div>
        <p className="adm-muted">
          {selected && <>This session saves as <b>{sessionFileName(kind, selected.session)}</b>. </>}
          {kind === 'scorecards'
            ? 'One PDF for printing is collated by gym (Green, Red, Yellow, Orange, Purple), then session number. '
            : 'One PDF for printing is collated by session number: every gym’s Session 1, then Session 2, and so on. '}
          &ldquo;Separate PDFs&rdquo; is a zip with one file per session, for posting on the web.
        </p>
        <div role="status" className="ex-state">{note}</div>
        {error && <div className="adm-banner err" role="alert">{error}</div>}
      </section>

      {sessions.length === 0 && <section className="adm-card"><p className="adm-muted">No sessions yet. Import the registrations first.</p></section>}

      {selected && pages.length === 0 && (
        <section className="adm-card"><p className="adm-muted">Nothing to print for {selected.title} yet: no squads are saved, or nobody is placed in one.</p></section>
      )}

      {pages.length > 1 && (
        <nav className="ex-jump" aria-label="Jump to a page">
          <span className="ex-jump-title">Jump to</span>
          {jump.map((g) => (
            <div key={g.group} className="ex-jump-row">
              <span className="ex-jump-l">{g.group}</span>
              {g.items.map((it) => (
                <button key={it.index} type="button" className="ex-jump-b" onClick={() => goTo(it.index)} title={`Page ${it.index + 1}`} aria-label={`${g.group} ${it.label}, page ${it.index + 1}`}>{it.label}</button>
              ))}
            </div>
          ))}
        </nav>
      )}

      <div className="ex-pages">
        {pages.map((p, i) => (
          <div key={`${kind}-${selected?.id}-${i}`} ref={(el) => { pageRefs.current[i] = el; }} id={`ex-p${i + 1}`} className="ex-page" tabIndex={-1}>
            <PagePreview page={p} />
          </div>
        ))}
      </div>
    </div>
  );
}
