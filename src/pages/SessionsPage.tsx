import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { db } from '../lib/firebase';
import { loadPublicSheet } from '../lib/data/export-store';
import { sheetWhenLine, type PublicSheet } from '../lib/public-sheets';
import { publicSheetUrl } from '../lib/session-details';
import './sheets.css';

type Row = { id: string; sheet: PublicSheet | null; when: string };
type Loaded = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; rows: Row[] };

/** At most this many sessions from the link: nobody competes in more, and it caps the reads a hand-made link can ask for. */
const MAX_SESSIONS = 6;

/**
 * Several sessions' sheets on one page (Julia 2026-10-31): the iContact athlete email has one link per contact, and an athlete
 * in two or three disciplines is in that many sessions. `#/sheets/<meetId>?s=<sessionId>,<sessionId>` lists each published
 * session with its date and times and links to its rotation sheet and scorecards. Reads the same public documents as the
 * one-session page, one `get` each.
 */
export default function SessionsPage() {
  const { meetId = '' } = useParams();
  const [params] = useSearchParams();
  const ids = [...new Set((params.get('s') ?? '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_SESSIONS);
  const key = ids.join(',');
  const [load, setLoad] = useState<Loaded>({ kind: 'loading' });
  useEffect(() => {
    let off = false;
    const list = key ? key.split(',') : [];
    Promise.all(list.map((id) => loadPublicSheet(db, meetId, id))).then(
      (sheets) => {
        if (off) return;
        // A document this version cannot read shows as not published rather than breaking the page.
        const rows = sheets.map((sheet, i) => {
          let when: string;
          try { when = sheet ? sheetWhenLine(sheet.input) : ''; } catch { when = ''; }
          return { id: list[i], sheet, when };
        });
        setLoad({ kind: 'ready', rows });
      },
      (e) => { if (!off) setLoad({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load the sheets.' }); },
    );
    return () => { off = true; };
  }, [meetId, key]);

  if (load.kind === 'loading') return <main className="sh"><p role="status">Loading your sessions…</p></main>;
  if (load.kind === 'error') {
    return (
      <main className="sh">
        <h1 className="display">Something went wrong</h1>
        <div className="sh-banner err" role="alert">{load.message}</div>
        <button className="btn" type="button" onClick={() => window.location.reload()}>Reload</button>
      </main>
    );
  }
  const rows = load.rows;
  const meetName = rows.map((r) => r.sheet?.input.input.meet.name).find(Boolean);
  const base = `${window.location.origin}${window.location.pathname}`;
  if (!rows.some((r) => r.sheet)) {
    return (
      <main className="sh">
        <p className="sh-eyebrow">{meetName || 'United Club Gymnastics'}</p>
        <h1 className="display">These sheets aren&rsquo;t published yet</h1>
        <p>Check back closer to your sessions, or use the link in your most recent email.</p>
      </main>
    );
  }
  return (
    <main className="sh">
      <header className="sh-head">
        <p className="sh-eyebrow">{meetName || 'United Club Gymnastics'}</p>
        <h1 className="display">Your sessions</h1>
        <p className="sh-note">Open a session for its rotation sheet or scorecards, with Download PDF.</p>
      </header>
      <ul className="sh-list">
        {rows.map((r) => (
          <li key={r.id} className="sh-item">
            {r.sheet ? (
              <>
                <h2 className="sh-item-title">{r.sheet.title}</h2>
                {r.when && <p className="sh-when">{r.when}</p>}
                <div className="sh-links">
                  <a className="btn primary" href={publicSheetUrl(base, meetId, r.id, 'rotation')} aria-label={`Rotation sheet for ${r.sheet.title}`}>Rotation sheet</a>
                  <a className="btn ghost" href={publicSheetUrl(base, meetId, r.id, 'scorecards')} aria-label={`Scorecards for ${r.sheet.title}`}>Scorecards</a>
                </div>
              </>
            ) : (
              <p className="sh-note">One of your sessions isn&rsquo;t published yet. Check back closer to the session.</p>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
