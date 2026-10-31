import { useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { loadExportsInput, loadPublishedSheets, publishSheets, unpublishSheets } from '../lib/data/export-store';
import { formatWhen } from '../lib/pacific';
import { buildExportSessions } from '../lib/pdf/export-all';
import { publicSheetDoc } from '../lib/public-sheets';
import { publicSheetUrl } from '../lib/session-details';
import './public-sheets-card.css';

/**
 * Publish sheets: the public page per session that the Session details email links to (Julia 2026-10-30). Shown on Exports and
 * as the Publish sheets step of Session reminders (laid out like the UCG platform's, Julia 2026-10-31). Publishing reads the
 * saved squads, orders and schedule again first, so it always publishes what is saved.
 */
export default function PublicSheetsCard({ meetId, sessions, unsaved = false, headingId = 'ps-h' }: {
  meetId: string;
  /** The meet's sessions in display order, for the per-session links. */
  sessions: { id: string; title: string }[];
  /** Exports: the meet name or schedule has unsaved edits, so publishing waits. */
  unsaved?: boolean;
  headingId?: string;
}) {
  const [published, setPublished] = useState<Record<string, Date | null> | null>(null);
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'err'; text?: string }>({ kind: 'idle' });
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [manual, setManual] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState('');
  useEffect(() => {
    let off = false;
    Promise.resolve().then(() => loadPublishedSheets(db, meetId)).then((x) => { if (!off) setPublished(x); }, () => { if (!off) setPublished(null); });
    return () => { off = true; };
  }, [meetId]);
  const count = published ? Object.keys(published).length : 0;
  const last = published ? Object.values(published).reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null) : null;
  const base = `${window.location.origin}${window.location.pathname}`;

  async function publish() {
    setState({ kind: 'busy' });
    try {
      // Read everything again first: squads and club orders may have changed since this screen opened.
      const fresh = await loadExportsInput(db, meetId);
      const now = buildExportSessions({ ...fresh, meet: { id: meetId, name: fresh.meet.meetName, date: fresh.meet.meetDate }, schedule: fresh.meet.schedule }).sessions;
      await publishSheets(db, meetId, Object.fromEntries(now.map((s) => [s.id, publicSheetDoc(s.title, s.input)])));
      const at = new Date();
      setPublished(Object.fromEntries(now.map((s) => [s.id, at])));
      setState({ kind: 'ok', text: `Published ${now.length} session${now.length === 1 ? '' : 's'}.` });
    } catch (e) {
      setState({ kind: 'err', text: `Could not publish: ${e instanceof Error ? e.message : 'try again'}` });
    }
  }
  async function unpublish() {
    setConfirmUnpublish(false);
    setState({ kind: 'busy' });
    try {
      const n = await unpublishSheets(db, meetId);
      setPublished({});
      setState({ kind: 'ok', text: `Unpublished ${n} session${n === 1 ? '' : 's'}. Their links now say the sheets aren't published.` });
    } catch (e) {
      setState({ kind: 'err', text: `Could not unpublish: ${e instanceof Error ? e.message : 'try again'}` });
    }
  }
  async function copyLink(id: string) {
    const url = publicSheetUrl(base, meetId, id, 'rotation');
    try {
      await navigator.clipboard.writeText(url);
      setManual(null);
      setCopied(id);
    } catch {
      setCopied('');
      setManual({ id, url });
    }
  }

  return (
    <section className="adm-card" aria-labelledby={headingId}>
      <h2 id={headingId} className="display">Publish sheets</h2>
      <p className="adm-muted">
        The Session details email links to a page per session showing its rotation sheet and scorecards, with Download PDF. Anyone with the link can see every club&rsquo;s athletes and order in that session.
        It shows what was published: <b>publish again after squads, orders or the schedule change.</b>
      </p>
      <p className="ps-state" role="status">
        {published === null
          ? 'Checking what is published…'
          : count === 0
            ? <>Sheets are <strong>not published</strong>. The links in the emails show &ldquo;not published yet&rdquo; until you publish.</>
            : <>Sheets are <strong>published</strong>: {count} of {sessions.length} session{sessions.length === 1 ? '' : 's'}{last ? `, last ${formatWhen(last)}` : ''}.</>}
      </p>
      <div className="adm-actions">
        <button type="button" className="btn primary" disabled={sessions.length === 0 || unsaved || state.kind === 'busy'} onClick={() => void publish()}>
          {state.kind === 'busy' ? 'Working…' : count > 0 ? 'Publish sheets again' : 'Publish sheets'}
        </button>
        {count > 0 && <button type="button" className="btn ghost" disabled={state.kind === 'busy'} onClick={() => setConfirmUnpublish(true)}>Unpublish</button>}
      </div>
      {unsaved && <p className="adm-muted">Save the meet name and schedule above first: the page shows what is saved.</p>}
      {state.kind === 'ok' && <div className="adm-banner ok" role="status">{state.text}</div>}
      {state.kind === 'err' && <div className="adm-banner err" role="alert">{state.text}</div>}
      {confirmUnpublish && (
        <div className="adm-banner warn" role="alertdialog" aria-label="Unpublish the sheets?">
          <p>Unpublish every session? Links already emailed will say the sheets aren&rsquo;t published until you publish again.</p>
          <div className="adm-actions">
            <button type="button" className="btn ghost small" onClick={() => setConfirmUnpublish(false)}>Cancel</button>
            <button type="button" className="btn small" onClick={() => void unpublish()}>Unpublish</button>
          </div>
        </div>
      )}
      {count > 0 && sessions.length > 0 && (
        <ul className="ps-list" aria-label="Session sheet pages">
          {sessions.map((s) => (
            <li key={s.id}>
              <span className="ps-name">{s.title}</span>
              {published?.[s.id] === undefined ? (
                <span className="adm-muted">Not published</span>
              ) : (
                <span className="ps-links">
                  <a className="btn ghost small" href={publicSheetUrl(base, meetId, s.id, 'rotation')} target="_blank" rel="noopener noreferrer" aria-label={`Open the sheets page for ${s.title}`}>Open sheets page</a>
                  <button type="button" className="btn ghost small" aria-label={`Copy link for ${s.title}`} onClick={() => void copyLink(s.id)}>{copied === s.id ? 'Copied' : 'Copy link'}</button>
                </span>
              )}
              {manual?.id === s.id && (
                <label className="ps-manual">
                  <span>Copy this link by hand</span>
                  <input readOnly value={manual.url} onFocus={(e) => e.currentTarget.select()} />
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
