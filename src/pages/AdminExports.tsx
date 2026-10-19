import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../lib/firebase';
import { PagePreview } from '../components/PdfPreview';
import { loadExportsInput, runScheduleMigration, saveMeetNameDate, saveScheduleOverride, saveScheduleRow, type ExportsInput } from '../lib/data/export-store';
import { sessionFileName, sessionPages, type ExportKind } from '../lib/pdf/collate';
import { applySchedules, buildExportSessions } from '../lib/pdf/export-all';
import { EMPTY_FIELDS, SCHEDULE_KEYS, collectLegacy, formatTime, parseFields, planMigration, resolveSchedule, type ScheduleFields, type ScheduleRows } from '../lib/schedule';
import { allSessionsPdf, allSessionsZip, sessionPdf } from '../lib/pdf/files';
import { jumpGroups } from '../lib/pdf/model';
import './exports.css';

type Loaded = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; input: ExportsInput };

const trimmed = (f: ScheduleFields): ScheduleFields => ({ date: f.date.trim(), stretch: f.stretch.trim(), warmups: f.warmups.trim(), competition: f.competition.trim() });

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

export default function AdminExports({ meetId }: { meetId: string }) {
  const [load, setLoad] = useState<Loaded>({ kind: 'loading' });
  const fetchInput = useCallback(() => {
    loadExportsInput(db, meetId)
      .then((input) => setLoad({ kind: 'ready', input }))
      .catch((e) => setLoad({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load the data to export.' }));
  }, [meetId]);
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
  return <ExportsScreen meetId={meetId} input={load.input} onReload={refresh} />;
}

export function ExportsScreen({ meetId, input, onReload }: { meetId: string; input: ExportsInput; onReload: () => void }) {
  const built = useMemo(() => buildExportSessions({ ...input, meet: { name: input.meet.meetName, date: input.meet.meetDate }, schedule: input.meet.schedule }), [input]);

  // Meet name/date and a T&T competition time: typed here, shown in the sheets at once, saved with the Save buttons.
  const [name, setName] = useState(input.meet.meetName);
  const [date, setDate] = useState(input.meet.meetDate);
  const [meetState, setMeetState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [savedMeet, setSavedMeet] = useState({ name: input.meet.meetName, date: input.meet.meetDate });
  const meetDirty = name.trim() !== savedMeet.name || date.trim() !== savedMeet.date;

  // Session schedule: a row per session number + optional per-session overrides. Typed values show in the sheets at once; saved with the Save buttons.
  const numbers = useMemo(() => [...new Set(input.sessions.map((s) => s.number))].sort((x, y) => x - y), [input.sessions]);
  const full = (f: Partial<ScheduleFields> | undefined): ScheduleFields => ({ ...EMPTY_FIELDS, ...f });
  const [savedRows, setSavedRows] = useState<ScheduleRows>(input.meet.schedule);
  const [rows, setRows] = useState<Record<string, ScheduleFields>>(() => Object.fromEntries(numbers.map((n) => [String(n), full(input.meet.schedule[String(n)])])));
  const [savedOver, setSavedOver] = useState<Record<string, ScheduleFields>>(() => Object.fromEntries(input.sessions.map((s) => [s.id, full(parseFields(s.scheduleOverride))])));
  const [over, setOver] = useState<Record<string, ScheduleFields>>(savedOver);
  const [schedState, setSchedState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [overState, setOverState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const same = (a: ScheduleFields, b: ScheduleFields) => SCHEDULE_KEYS.every((k) => a[k].trim() === b[k].trim());
  const dirtyRows = numbers.filter((n) => !same(rows[String(n)], full(savedRows[String(n)])));
  const dirtyOver = input.sessions.filter((s) => !same(over[s.id], savedOver[s.id]));
  const draftRows = useMemo<ScheduleRows>(() => Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, parseFields(v)])), [rows]);
  const draftOver = useMemo(() => Object.fromEntries(Object.entries(over).map(([k, v]) => [k, parseFields(v)])), [over]);
  const [migState, setMigState] = useState<'idle' | 'running' | 'error'>('idle');
  const legacy = useMemo(() => collectLegacy(input.sessions, input.squadDocs), [input]);
  const migration = useMemo(
    () => planMigration(legacy, savedRows, Object.fromEntries(Object.entries(savedOver).map(([id, v]) => [id, parseFields(v)]))),
    [legacy, savedRows, savedOver],
  );

  const sessions = useMemo(
    () => applySchedules(built.sessions, { meet: { name: name.trim(), date: date.trim() }, rows: draftRows, overrides: draftOver }),
    [built, name, date, draftRows, draftOver],
  );
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
    try { await saveMeetNameDate(db, meetId, { meetName: name, meetDate: date }); setSavedMeet({ name: name.trim(), date: date.trim() }); setMeetState('saved'); } catch { setMeetState('error'); }
  }
  async function saveSchedule() {
    setSchedState('saving');
    try {
      for (const n of dirtyRows) await saveScheduleRow(db, meetId, n, trimmed(rows[String(n)]));
      setSavedRows(Object.fromEntries(numbers.map((n) => [String(n), parseFields(rows[String(n)])])));
      setSchedState('saved');
    } catch { setSchedState('error'); }
  }
  async function saveOverrides() {
    setOverState('saving');
    try {
      for (const s of dirtyOver) await saveScheduleOverride(db, meetId, s.id, trimmed(over[s.id]));
      setSavedOver({ ...over });
      setOverState('saved');
    } catch { setOverState('error'); }
  }
  async function migrate() {
    setMigState('running');
    try { await runScheduleMigration(db, meetId, migration); onReload(); } catch { setMigState('error'); }
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
          <label className="ex-field"><span>Meet date (only for a session with no date below)</span><input value={date} onChange={(e) => { setDate(e.target.value); setMeetState('idle'); }} placeholder="October 22–25, 2026" /></label>
          <button type="button" className="btn" onClick={() => void saveMeet()} disabled={!meetDirty || meetState === 'saving'}>{meetState === 'saving' ? 'Saving…' : 'Save'}</button>
        </div>
        <div className="ex-state" role="status">
          {meetState === 'saved' && !meetDirty && 'Saved.'}
          {meetState === 'error' && 'Could not save. Try again.'}
          {meetDirty && meetState !== 'saving' && meetState !== 'error' && 'Not saved yet. The sheets below already use what you typed.'}
        </div>
      </section>

      <section className="adm-card" aria-labelledby="ex-sched">
        <h2 id="ex-sched" className="display">Session schedule</h2>
        <p className="adm-muted">
          One row per session number: it applies to every gym&rsquo;s session with that number (artistic and T&amp;T). The date prints in each sheet&rsquo;s header;
          the times print on the rotation sheets. The sheets below already use what you type.
        </p>
        <div className="adm-tablewrap">
          <table className="adm-table ex-sched">
            <caption className="sr-only">Session schedule by session number</caption>
            <thead><tr><th scope="col">Session</th><th scope="col">Date</th><th scope="col">Open stretch</th><th scope="col">Timed warm-ups</th><th scope="col">Competition</th></tr></thead>
            <tbody>
              {numbers.map((n) => (
                <tr key={n}>
                  <th scope="row">Session {n}</th>
                  <FieldCells id={`row-${n}`} label={`Session ${n}`} value={rows[String(n)]} onChange={(v) => { setRows((r) => ({ ...r, [String(n)]: v })); setSchedState('idle'); }} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ex-fields">
          <button type="button" className="btn" disabled={dirtyRows.length === 0 || schedState === 'saving'} onClick={() => void saveSchedule()}>{schedState === 'saving' ? 'Saving…' : 'Save schedule'}</button>
          <span className="ex-state" role="status">
            {schedState === 'saved' && dirtyRows.length === 0 ? 'Saved.' : schedState === 'error' ? 'Could not save. Try again.' : dirtyRows.length > 0 ? 'Not saved yet.' : ''}
          </span>
        </div>

        <details className="ex-over">
          <summary>Session overrides ({input.sessions.filter((s) => Object.keys(parseFields(over[s.id])).length > 0).length} set)</summary>
          <p className="adm-muted">Leave a field empty to use the session number&rsquo;s value (shown faintly). Only fill in what differs for that one session.</p>
          <div className="adm-tablewrap">
            <table className="adm-table ex-sched">
              <caption className="sr-only">Per-session overrides</caption>
              <thead><tr><th scope="col">Session</th><th scope="col">Date</th><th scope="col">Open stretch</th><th scope="col">Timed warm-ups</th><th scope="col">Competition</th></tr></thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">{s.title}</th>
                    <FieldCells
                      id={`over-${s.id}`} label={s.title} value={over[s.id] ?? EMPTY_FIELDS}
                      placeholders={resolveSchedule(s.session.number, draftRows, undefined, '')}
                      onChange={(v) => { setOver((o) => ({ ...o, [s.id]: v })); setOverState('idle'); }}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ex-fields">
            <button type="button" className="btn" disabled={dirtyOver.length === 0 || overState === 'saving'} onClick={() => void saveOverrides()}>{overState === 'saving' ? 'Saving…' : 'Save overrides'}</button>
            <span className="ex-state" role="status">
              {overState === 'saved' && dirtyOver.length === 0 ? 'Saved.' : overState === 'error' ? 'Could not save. Try again.' : dirtyOver.length > 0 ? 'Not saved yet.' : ''}
            </span>
          </div>
        </details>

        {legacy.length > 0 && (
          <div className="adm-banner warn" role="status" data-testid="schedule-migration">
            <p>
              <strong>{legacy.length} session{legacy.length === 1 ? ' has' : 's have'} times saved the old way</strong> (on the Squads screen or as a T&amp;T competition time). They are not used any more.
              {' '}{migration.moved} time{migration.moved === 1 ? '' : 's'} differ{migration.moved === 1 ? 's' : ''} from the schedule above and would become that session&rsquo;s override; {migration.dropped} already match and would be dropped.
              Fill in and save the schedule first.
            </p>
            <button type="button" className="btn small" disabled={dirtyRows.length > 0 || dirtyOver.length > 0 || migState === 'running'} onClick={() => void migrate()}>
              {migState === 'running' ? 'Moving…' : 'Move existing times into the schedule'}
            </button>
            {migState === 'error' && <p role="alert">Could not move the times. Nothing old was removed before the failure; try again.</p>}
          </div>
        )}
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

/** The four schedule inputs of a row (date picker + three time boxes), each named for screen readers. */
function FieldCells({ id, label, value, onChange, placeholders }: {
  id: string;
  label: string;
  value: ScheduleFields;
  onChange: (v: ScheduleFields) => void;
  /** Shown when a field is empty (the number's value, on the override rows). */
  placeholders?: ScheduleFields;
}) {
  const cell = (k: keyof ScheduleFields, title: string, hint: string) => (
    <td data-label={title}>
      <input
        id={`${id}-${k}`} className="ex-sched-in" aria-label={`${label} ${title.toLowerCase()}`}
        type={k === 'date' ? 'date' : 'text'} value={value[k]} placeholder={placeholders?.[k] || hint}
        onChange={(e) => onChange({ ...value, [k]: e.target.value })}
        // Times tidy themselves into "7:30 AM" when you leave the box.
        onBlur={k === 'date' ? undefined : (e) => { const t = formatTime(e.target.value); if (t !== e.target.value) onChange({ ...value, [k]: t }); }}
      />
    </td>
  );
  return (
    <>
      {cell('date', 'Date', '')}
      {cell('stretch', 'Open stretch', 'e.g. 7:30 AM')}
      {cell('warmups', 'Timed warm-ups', 'e.g. 7:50 AM')}
      {cell('competition', 'Competition', 'e.g. 8:00 AM')}
    </>
  );
}
