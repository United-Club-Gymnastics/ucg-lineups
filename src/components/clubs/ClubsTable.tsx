import { useMemo, useState } from 'react';
import Select from '../Select';
import { Badge, Modal } from '../ui';
import { matchesClubFilter, type ClubRow } from '../../lib/club-overview';
import { STATUS_LABEL, type SessionStatus } from '../../lib/club-status';
import { clubLinkUrl } from '../../lib/email-templates';
import { formatWhen } from '../../lib/pacific';
import { parseEmails } from '../../lib/reminders';
import type { RegenerateResult } from '../../lib/data/email-store';

const TONE: Record<SessionStatus, 'ok' | 'warn' | 'err' | 'info'> = { split: 'err', default: 'warn', custom: 'ok', none: 'info', tnt: 'info' };
const FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'All clubs' },
  { id: 'split', label: STATUS_LABEL.split },
  { id: 'default', label: STATUS_LABEL.default },
  { id: 'custom', label: STATUS_LABEL.custom },
  { id: 'none', label: STATUS_LABEL.none },
  { id: 'tnt', label: STATUS_LABEL.tnt },
  { id: 'noemail', label: 'No email' },
];

export default function ClubsTable({ rows, linkBase, onSaveEmails, onRegenerate }: {
  rows: ClubRow[];
  linkBase: string;
  onSaveEmails: (clubId: string, emails: string[]) => Promise<void>;
  onRegenerate: (row: ClubRow) => Promise<RegenerateResult>;
}) {
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [confirmRow, setConfirmRow] = useState<ClubRow | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = useMemo(() => rows.filter((r) => matchesClubFilter(r, status, search)), [rows, status, search]);

  async function regenerate(row: ClubRow) {
    setBusy(true);
    setNote(null);
    try {
      const res = await onRegenerate(row);
      setNote({
        tone: res.oldLinkRemoved ? 'ok' : 'warn',
        text: `${row.name}: new link ready. ${res.copied} saved ${res.copied === 1 ? 'order was' : 'orders were'} moved to it.${res.oldLinkRemoved ? ' The old link no longer works.' : ' The old link could not be removed and may still open; try again from the Firebase console.'}`,
      });
    } catch (e) {
      setNote({ tone: 'err', text: `${row.name}: the link was NOT changed (${e instanceof Error ? e.message : 'try again'}). Nothing was lost.` });
    } finally {
      setBusy(false);
      setConfirmRow(null);
    }
  }

  return (
    <section className="adm-card" aria-labelledby="cl-clubs-h">
      <h2 className="display" id="cl-clubs-h">Clubs</h2>
      <p className="adm-muted">
        Clubs don't submit anything: orders save as they go, and each status comes from what the club has changed.
        "Nothing to order" means every event list has at most one athlete, so that club gets no reminder.
      </p>
      <div className="cl-filters">
        <label className="cl-field">
          <span>Status</span>
          <Select aria-label="Status" value={status} onChange={setStatus} options={FILTERS.map((f) => ({ value: f.id, label: f.label }))} />
        </label>
        <label className="cl-field cl-grow">
          <span>Search clubs or emails</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Club name or email" />
        </label>
        <p className="cl-count" role="status">{shown.length} of {rows.length} clubs</p>
      </div>
      {note && <div className={`adm-banner ${note.tone}`} role={note.tone === 'err' ? 'alert' : 'status'}>{note.text}</div>}
      {rows.length === 0 ? (
        <p className="adm-muted">No clubs yet. Import the athletes first.</p>
      ) : shown.length === 0 ? (
        <p className="adm-muted">No clubs match.</p>
      ) : (
        <table className="cl-table">
          <thead>
            <tr><th scope="col">Club</th><th scope="col">Sessions, levels and status</th><th scope="col">Last change</th><th scope="col">Contact emails</th><th scope="col">Private link</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => <ClubRowView key={r.id} row={r} linkBase={linkBase} busy={busy} onSaveEmails={onSaveEmails} onAsk={setConfirmRow} onNote={setNote} />)}
          </tbody>
        </table>
      )}
      {confirmRow && (
        <Modal title="Regenerate this link?" onClose={() => { if (!busy) setConfirmRow(null); }}>
          <p><strong>{confirmRow.name}</strong> gets a new private link. The old link stops working straight away: anyone using it sees "This link isn't valid".</p>
          <p>Their saved orders are copied to the new link first, so nothing is lost. Send the club the new link (the reminder emails always use the current one).</p>
          <div className="adm-actions">
            <button type="button" className="btn ghost" onClick={() => setConfirmRow(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => void regenerate(confirmRow)} disabled={busy}>{busy ? 'Working…' : 'Regenerate link'}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function ClubRowView({ row, linkBase, busy, onSaveEmails, onAsk, onNote }: {
  row: ClubRow;
  linkBase: string;
  busy: boolean;
  onSaveEmails: (clubId: string, emails: string[]) => Promise<void>;
  onAsk: (row: ClubRow) => void;
  onNote: (n: { tone: 'ok' | 'warn' | 'err'; text: string } | null) => void;
}) {
  const saved = row.emails.join(', ');
  const [draft, setDraft] = useState(saved);
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  const url = row.token ? clubLinkUrl(linkBase, row.token) : '';

  // A new value from outside (for example after a reload) replaces the draft only when the admin is not mid-edit.
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setDraft(saved);
  }

  async function commit() {
    if (draft.trim() === saved.trim()) return;
    const { emails, invalid } = parseEmails(draft);
    if (invalid.length > 0) {
      setState({ kind: 'error', text: `Not an email address: ${invalid.join(', ')}` });
      return;
    }
    setState({ kind: 'saving' });
    try {
      await onSaveEmails(row.id, emails);
      setDraft(emails.join(', '));
      setState({ kind: 'saved', text: emails.length ? 'Saved' : 'Saved (no email)' });
    } catch (e) {
      setState({ kind: 'error', text: `Couldn't save: ${e instanceof Error ? e.message : 'try again'}` });
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onNote({ tone: 'warn', text: `Could not copy automatically. The link is ${url}` });
    }
  }

  return (
    <tr>
      <th scope="row" data-label="Club" className="cl-name">{row.name}</th>
      <td data-label="Sessions">
        {row.sessions.length === 0 ? <span className="adm-muted">No athletes competing</span> : (
          <ul className="cl-sessions">
            {row.sessions.map((s) => (
              <li key={s.sessionId}>
                <span className="cl-session">{s.label}</span>
                <span className="cl-levels">{s.discipline === 'TNT' ? `${s.athleteCount} athletes` : s.levels.map((l) => `${l.name} ${l.count}`).join(' · ')}</span>
                <Badge tone={TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </td>
      <td data-label="Last change">{row.lastChange ? formatWhen(row.lastChange) : <span className="adm-muted">No changes yet</span>}</td>
      <td data-label="Contact emails">
        <input
          className="cl-in"
          aria-label={`Contact emails for ${row.name}`}
          placeholder="Add an email (separate several with commas)"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); if (state.kind !== 'idle') setState({ kind: 'idle' }); }}
          onBlur={() => void commit()}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commit(); } }}
        />
        <div className={`cl-state${state.kind === 'error' ? ' err' : ''}`} role={state.kind === 'error' ? 'alert' : 'status'}>
          {state.kind === 'saving' ? 'Saving…' : state.text ?? ''}
        </div>
      </td>
      <td data-label="Private link">
        {url ? (
          <>
            <code className="cl-link" title={url}>…/#/c/{row.token.slice(0, 6)}…</code>
            <div className="cl-btns">
              <button type="button" className="btn ghost small" onClick={() => void copy()} aria-label={`Copy link for ${row.name}`}>{copied ? 'Copied' : 'Copy'}</button>
              <button type="button" className="btn ghost small" onClick={() => onAsk(row)} disabled={busy} aria-label={`Regenerate link for ${row.name}`}>Regenerate link</button>
            </div>
          </>
        ) : <span className="adm-muted">No link yet</span>}
      </td>
    </tr>
  );
}
