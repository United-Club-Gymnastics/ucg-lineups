import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { PagePreview } from '../components/PdfPreview';
import { db } from '../lib/firebase';
import { loadPublicSheet } from '../lib/data/export-store';
import { formatWhen } from '../lib/pacific';
import { sessionFileName, sessionPages, type SessionExportInput } from '../lib/pdf/collate';
import { formatTime } from '../lib/schedule';
import { sessionPdf } from '../lib/pdf/files';
import { sheetKindOf, type PublicSheet, type SheetKind } from '../lib/public-sheets';
import './sheets.css';

type Loaded = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error'; message: string } | { kind: 'ready'; sheet: PublicSheet };

/** `April 9, 2027 · Open stretch 7:30 AM · Warm-ups 8:00 AM · Competition 8:45 AM` (T&T: the date and its competition time). */
function whenLine(input: SessionExportInput): string {
  if (input.type === 'tnt') return [input.input.meet.date, input.input.competitionTime].filter(Boolean).join(' · ');
  const t = input.input.schedule;
  const times: [string, string][] = [['Open stretch', t.stretch], ['Warm-ups', t.warmups], ['Competition', t.competition]];
  return [input.input.meet.date, ...times.filter(([, v]) => v).map(([l, v]) => `${l} ${formatTime(v)}`)].filter(Boolean).join(' · ');
}

const printedOn = (d: Date | null): string => (d ?? new Date()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * The public sheets page (Julia 2026-10-30): one session's rotation sheet and scorecards as last published from the Exports screen,
 * with Download PDF. No sign-in; the Session details email links here (`#/sheets/<meetId>/<sessionId>?doc=rotation|scorecards`).
 */
export default function SheetsPage() {
  const { meetId = '', sessionId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const kind: SheetKind = sheetKindOf(params.get('doc'));
  const [load, setLoad] = useState<Loaded>({ kind: 'loading' });
  useEffect(() => {
    let off = false;
    loadPublicSheet(db, meetId, sessionId).then(
      (sheet) => { if (!off) setLoad(sheet ? { kind: 'ready', sheet } : { kind: 'missing' }); },
      (e) => { if (!off) setLoad({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load the sheets.' }); },
    );
    return () => { off = true; };
  }, [meetId, sessionId]);

  const sheet = load.kind === 'ready' ? load.sheet : null;
  const printed = printedOn(sheet?.publishedAt ?? null);
  // A document this version cannot draw (shape changed, hand-edited) shows a message instead of a blank page.
  const drawn = useMemo(() => {
    if (!sheet) return { pages: [], when: '', broken: false };
    try {
      return { pages: sessionPages(kind, sheet.input, printed), when: whenLine(sheet.input), broken: false };
    } catch {
      return { pages: [], when: '', broken: true };
    }
  }, [sheet, kind, printed]);
  const pages = drawn.pages;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function download() {
    if (!sheet) return;
    setBusy(true);
    setError('');
    try {
      const file = await sessionPdf(kind, sheet.input, printed);
      const url = URL.createObjectURL(new Blob([file.bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make the PDF.');
    } finally {
      setBusy(false);
    }
  }

  if (load.kind === 'loading') return <main className="sh"><p role="status">Loading the sheets…</p></main>;
  if (load.kind === 'missing') {
    return (
      <main className="sh">
        <p className="sh-eyebrow">United Club Gymnastics</p>
        <h1 className="display">These sheets aren&rsquo;t published yet</h1>
        <p>Check back closer to the session, or use the link in your most recent email.</p>
      </main>
    );
  }
  if (load.kind === 'error') {
    return (
      <main className="sh">
        <h1 className="display">Something went wrong</h1>
        <div className="sh-banner err" role="alert">{load.message}</div>
        <button className="btn" type="button" onClick={() => window.location.reload()}>Reload</button>
      </main>
    );
  }

  const s = load.sheet;
  const inner = s.input.input;
  const when = drawn.when;
  if (drawn.broken) {
    return (
      <main className="sh">
        <h1 className="display">These sheets can&rsquo;t be shown</h1>
        <p>Please ask the meet host to publish them again.</p>
      </main>
    );
  }

  return (
    <main className="sh">
      <header className="sh-head">
        <p className="sh-eyebrow">{inner.meet.name || 'United Club Gymnastics'}</p>
        <h1 className="display">{s.title}</h1>
        {when && <p className="sh-when">{when}</p>}
        {s.publishedAt && <p className="sh-updated">Updated {formatWhen(s.publishedAt)}</p>}
      </header>
      <div className="sh-bar">
        <div className="sh-seg" role="group" aria-label="Which sheets">
          <button type="button" aria-pressed={kind === 'rotation'} onClick={() => setParams({ doc: 'rotation' }, { replace: true })}>Rotation sheet</button>
          <button type="button" aria-pressed={kind === 'scorecards'} onClick={() => setParams({ doc: 'scorecards' }, { replace: true })}>Scorecards</button>
        </div>
        <button type="button" className="btn primary" disabled={busy || pages.length === 0} onClick={() => void download()}>
          {busy ? 'Making PDF…' : 'Download PDF'}
        </button>
      </div>
      <p className="sh-note">
        {kind === 'scorecards'
          ? 'For reference only: the order athletes compete on each event. Scratches and additions are handled at the competition.'
          : 'Your event order. It may change up to the start of the session.'}
        {pages.length > 0 && <> Saves as <b>{sessionFileName(kind, s.input)}</b>.</>}
      </p>
      {error && <div className="sh-banner err" role="alert">{error}</div>}
      {pages.length === 0 ? (
        <p className="sh-note">Nothing to show for this session yet.</p>
      ) : (
        <div className="sh-pages">
          {pages.map((p, i) => <PagePreview key={`${kind}-${i}`} page={p} />)}
        </div>
      )}
    </main>
  );
}
