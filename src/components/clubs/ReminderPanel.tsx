import { useMemo, useState, type ReactNode } from 'react';
import Select from '../Select';
import { Modal } from '../ui';
import { connectGmail, db } from '../../lib/firebase';
import type { ClubRow } from '../../lib/club-overview';
import { addEmailLog, saveEmailTemplates, type EmailLogEntry, type LogTemplate } from '../../lib/data/email-store';
import type { StoredClub } from '../../lib/data/plan';
import type { StoredAthlete } from '../../lib/import/diff';
import type { Session } from '../../lib/import/types';
import type { ReminderTemplate } from '../../lib/email/session-reminder-email';
import type { ScheduleRows } from '../../lib/schedule';
import { LINEUPS_SESSION_TEMPLATE } from '../../lib/session-details';
import SessionDetailsPanel from './SessionDetailsPanel';
import { clubLinkUrl, DEFAULT_TEMPLATES, PLACEHOLDERS, renderReminder, type MessageContext, type Templates } from '../../lib/email-templates';
import { FROM, sendTestBatch, SEND_MODE, testAlias, type FetchLike, type SendResult, type TestWho } from '../../lib/email-send';
import { formatDeadline, formatWhen, pacificDay } from '../../lib/pacific';
import { buildReminders, REMINDER_LABEL, type ReminderEntry, type ReminderKind } from '../../lib/reminders';

const KINDS: ReminderKind[] = ['az', 'split'];
const LOG_LABEL: Record<LogTemplate, string> = { ...REMINDER_LABEL, session: 'Session details' };

/** What the Session details email needs beyond the club rows. Optional so older callers (and tests) still render. */
export interface SessionDetailsData {
  sessions: Session[];
  athletes: StoredAthlete[];
  clubs: StoredClub[];
  gymOrder: string[];
  schedule?: ScheduleRows;
  meetDate?: string;
  sessionTemplate?: ReminderTemplate;
  sessionTemplateSaved?: boolean;
  coachRoles?: string[] | null;
}

/** Dev builds only (stripped from production): lets the browser check skip Google's consent popup. Never set by the app. */
function devGmailToken(): string | undefined {
  return import.meta.env.DEV ? (window as unknown as { __ucgGmailToken?: string }).__ucgGmailToken : undefined;
}

/** The page's pills (Julia 2026-10-18; Session reminders 2026-10-31). The panel stays mounted across them so ticks, choice and
 * preview survive. */
export type ClubsView = 'clubs' | 'email' | 'message' | 'session';

export default function ReminderPanel({ meetId, rows: liveRows, templates: savedTemplates, meetName, deadline, linkBase, adminEmail, log: liveLog, onLogged, pauseMs, view = 'email', onView, details }: {
  details?: SessionDetailsData;
  /** Which pill is showing: 'email' shows the lists, Send and the log; 'message' the wording and preview; 'session' Session reminders. */
  view?: ClubsView;
  onView?: (v: ClubsView) => void;
  meetId: string;
  rows: ClubRow[];
  templates: Templates;
  meetName: string;
  deadline: Date | null;
  linkBase: string;
  adminEmail: string;
  log: EmailLogEntry[];
  onLogged: (e: EmailLogEntry) => void;
  pauseMs?: number;
}) {
  // While the admin confirms and sends, the lists stay exactly as they were when they pressed Send: a club changing its order
  // (the table is live) or a log row being added by this very send must not change who gets the email or what the preview shows.
  const [frozen, setFrozen] = useState<{ rows: ClubRow[]; log: EmailLogEntry[] } | null>(null);
  const rows = frozen?.rows ?? liveRows;
  const log = frozen?.log ?? liveLog;
  const reminders = useMemo(() => buildReminders(rows), [rows]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // The club reminder whose list and wording show. Session details has its own pill, Session reminders (Julia 2026-10-31).
  const [kind, setKind] = useState<ReminderKind>('az');
  const [sessionOpened, setSessionOpened] = useState(view === 'session');
  if (view === 'session' && !sessionOpened) setSessionOpened(true);
  const [templates, setTemplates] = useState<Templates>(savedTemplates);
  const [stored, setStored] = useState<Templates>(savedTemplates);
  const [tplState, setTplState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [previewId, setPreviewId] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // "Preview" on a club line shows that club's message and jumps down to it (focus moves there for keyboard users).
  const showPreview = (clubId: string) => {
    setPreviewId(clubId);
    jumpToPreview('cl-prev-h');
  };
  const jumpToPreview = (headingId: string) => {
    onView?.('message');
    // Two frames: the Message & preview pill has to be shown before it can scroll into view.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const h = document.getElementById(headingId);
      h?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      h?.focus({ preventScroll: true });
    }));
  };
  const [skipToday, setSkipToday] = useState(true);
  const [who, setWho] = useState<TestWho>('jz');
  const [gmailToken, setGmailToken] = useState<string | null>(null);
  const [gmailError, setGmailError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<SendResult[]>([]);
  const [summary, setSummary] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  const list = reminders[kind];
  const missing = reminders.noEmail[kind];
  const today = pacificDay(new Date());
  const sentToday = useMemo(
    () => new Set(log.filter((e) => e.template === kind && e.mode === 'test' && e.at && pacificDay(e.at) === today).map((e) => e.clubId)),
    [log, kind, today],
  );
  const targets = list.filter((e) => !excluded.has(e.clubId) && !(skipToday && sentToday.has(e.clubId)));
  const skippedSent = list.filter((e) => !excluded.has(e.clubId) && skipToday && sentToday.has(e.clubId)).length;

  const preview: ReminderEntry | undefined = list.find((e) => e.clubId === previewId) ?? list[0];
  const deadlineText = deadline ? formatDeadline(deadline) : 'the order deadline';
  const ctxFor = (e: ReminderEntry): MessageContext => ({ meetName: meetName || 'UCG', deadline: deadlineText, link: clubLinkUrl(linkBase, rowById.get(e.clubId)?.token ?? '') });
  const rendered = preview ? renderReminder(templates[kind], preview, ctxFor(preview)) : null;

  const tplDirty = KINDS.some((k) => templates[k].subject !== stored[k].subject || templates[k].body !== stored[k].body);
  function setTpl(field: 'subject' | 'body', value: string) {
    setTemplates((t) => ({ ...t, [kind]: { ...t[kind], [field]: value } }));
    setTplState('idle');
  }
  async function saveTemplates() {
    setTplState('saving');
    try {
      await saveEmailTemplates(db, meetId, templates);
      setStored(templates);
      setTplState('saved');
    } catch {
      setTplState('error');
    }
  }

  async function connect() {
    setGmailError('');
    try {
      setGmailToken(devGmailToken() ?? (await connectGmail()));
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') setGmailError(`Couldn't connect Gmail: ${e instanceof Error ? e.message : 'try again'}`);
    }
  }

  async function send() {
    if (!gmailToken) return;
    setConfirm(false);
    setSending(true);
    setFrozen((f) => f ?? { rows: liveRows, log: liveLog });
    setSummary(null);
    setResults([]);
    setProgress({ done: 0, total: targets.length });
    const sendKind = kind;
    const messages = targets.map((e) => ({ clubId: e.clubId, clubName: e.clubName, ...renderReminder(templates[sendKind], e, ctxFor(e)) }));
    const out = await sendTestBatch({
      token: gmailToken,
      who,
      messages,
      pauseMs,
      fetchImpl: globalThis.fetch as unknown as FetchLike,
      onSent: async (res, msg) => {
        const entry = { template: sendKind, clubId: res.clubId, club: res.clubName, to: res.to, subject: msg.subject, by: adminEmail };
        await addEmailLog(db, meetId, entry);
        onLogged({ id: `local-${Date.now()}-${res.clubId}`, ...entry, at: new Date(), mode: SEND_MODE });
      },
      onProgress: (done, total, r) => {
        setProgress({ done, total });
        setResults((prev) => [r, ...prev]);
      },
    });
    setSending(false);
    setFrozen(null);
    const ok = out.filter((r) => r.ok).length;
    const expired = out.length < messages.length;
    setSummary({
      tone: ok === messages.length ? 'ok' : 'warn',
      text: `Sent ${ok} of ${messages.length} test email${messages.length === 1 ? '' : 's'}.${expired ? ` Stopped early: ${messages.length - out.length} not tried. Reconnect Gmail and send again (clubs already sent are skipped).` : ''}${out.some((r) => r.logError) ? ' Some messages were sent but could not be written to the log.' : ''}`,
    });
    if (expired) setGmailToken(null);
  }

  // The club reminders' log; Session details has its own, in Session reminders.
  const logRows = log.filter((e) => e.template !== 'session').slice(0, 200);
  const switcher = (label: string): ReactNode => (
    <div className="cl-seg" role="group" aria-label={label}>
      {KINDS.map((k) => (
        <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setPreviewId(''); setSummary(null); }}>
          {REMINDER_LABEL[k]} ({reminders[k].length})
        </button>
      ))}
    </div>
  );

  return (
    <>
      <section className="adm-card" aria-labelledby="cl-rem-h" hidden={view !== 'email'}>
        <div className="cl-head">
          <h2 className="display" id="cl-rem-h">Reminders</h2>
          <span className="badge warn">Test mode: real club addresses are off</span>
        </div>
        {switcher('Which reminder')}
        <p className="adm-muted">
          {kind === 'split'
            ? "Clubs with more athletes at a level than fit in one squad that haven't kept or changed the suggested split. They get this message instead of the A–Z reminder."
            : 'Clubs with at least one session still on the default A–Z order and no split to decide. Each email lists only those sessions.'}
        </p>

        {missing.length > 0 && (
          <div className="adm-banner warn" role="status">
            <strong>No email — add one above</strong> ({missing.length}): {missing.map((e) => e.clubName).join(', ')}
          </div>
        )}

        {frozen && <p className="adm-muted cl-frozen" role="status">The list is held while you send: club changes made now show up when it finishes.</p>}
        {list.length === 0 ? (
          <p className="adm-muted">No clubs on this list.</p>
        ) : (
          <>
          <div className="cl-all">
            <span className="adm-muted">{list.length - list.filter((e) => excluded.has(e.clubId)).length} of {list.length} ticked</span>
            <button type="button" className="btn ghost small" disabled={!!frozen || list.every((e) => !excluded.has(e.clubId))}
              onClick={() => setExcluded((prev) => { const n = new Set(prev); for (const e of list) n.delete(e.clubId); return n; })}>Check all</button>
            <button type="button" className="btn ghost small" disabled={!!frozen || list.every((e) => excluded.has(e.clubId))}
              onClick={() => setExcluded((prev) => { const n = new Set(prev); for (const e of list) n.add(e.clubId); return n; })}>Uncheck all</button>
          </div>
          <ul className="cl-recips" aria-label={`Clubs to send the ${REMINDER_LABEL[kind]} reminder to`}>
            {list.map((e) => (
              <li key={e.clubId}>
                <label>
                  <input
                    type="checkbox"
                    checked={!excluded.has(e.clubId)}
                    onChange={(ev) => setExcluded((prev) => { const n = new Set(prev); if (ev.target.checked) n.delete(e.clubId); else n.add(e.clubId); return n; })}
                  />
                  <span>{e.clubName}</span>
                </label>
                <span className="cl-recip-note">
                  {kind === 'split' ? e.levels.map((l) => `${l.levelName} (${l.count})`).join(', ') : e.sessions.map((s) => s.label).join(', ')}
                  {sentToday.has(e.clubId) && <em> · sent today</em>}
                </span>
                <button type="button" className="btn ghost small" aria-pressed={preview?.clubId === e.clubId} onClick={() => showPreview(e.clubId)} aria-label={`Preview ${e.clubName}`}>Preview</button>
              </li>
            ))}
          </ul>
          </>
        )}
      </section>

      <section className="adm-card" aria-labelledby="cl-tpl-h" hidden={view !== 'message'}>
        <h2 className="display" id="cl-tpl-h">Message: {REMINDER_LABEL[kind]}</h2>
        {/* The same switch as on "Who to email", so every message can be edited and previewed here. */}
        {switcher('Which message')}
        <p className="adm-muted">Placeholders: {PLACEHOLDERS.map((p) => <code key={p} className="cl-ph">{p}</code>)}. <code className="cl-ph">{'{sessions}'}</code> becomes a bulleted list. Blank line = new paragraph; <code className="cl-ph">**bold**</code>.</p>
        <label className="cl-field">
          <span>Subject</span>
          <input value={templates[kind].subject} onChange={(e) => setTpl('subject', e.target.value)} />
        </label>
        <label className="cl-field">
          <span>Message</span>
          <textarea rows={14} value={templates[kind].body} onChange={(e) => setTpl('body', e.target.value)} />
        </label>
        <div className="adm-actions">
          <button type="button" className="btn" onClick={() => void saveTemplates()} disabled={!tplDirty || tplState === 'saving'}>Save messages</button>
          <button type="button" className="btn ghost" onClick={() => { setTemplates((t) => ({ ...t, [kind]: DEFAULT_TEMPLATES[kind] })); setTplState('idle'); }}>Reset this message to the default</button>
          <span className="cl-state" role="status">{tplState === 'saving' ? 'Saving…' : tplState === 'saved' ? 'Saved' : tplDirty ? 'Unsaved changes (sending and the preview use what is typed here)' : ''}</span>
          {tplState === 'error' && <span className="cl-state err" role="alert">Couldn't save. Try again.</span>}
        </div>
      </section>

      <section className="adm-card" aria-labelledby="cl-prev-h" hidden={view !== 'message'}>
        <h2 className="display" id="cl-prev-h" tabIndex={-1}>Preview</h2>
        {!preview || !rendered ? (
          <p className="adm-muted">No clubs on this list.</p>
        ) : (
          <>
            <label className="cl-field">
              <span>Club</span>
              <Select aria-label="Club" value={preview.clubId} onChange={setPreviewId} options={list.map((e) => ({ value: e.clubId, label: e.clubName }))} />
            </label>
            <dl className="cl-mailhead">
              <div><dt>From</dt><dd>{FROM.name} &lt;{FROM.address}&gt;</dd></div>
              <div>
                <dt>To</dt>
                <dd>
                  <span className="cl-alias">{testAlias(who, preview.clubId)}</span> <span className="badge info">test alias</span>{' '}
                  <s className="cl-real" aria-label="Real address, not used in test mode">{(rowById.get(preview.clubId)?.emails ?? []).join(', ')}</s>
                </dd>
              </div>
              <div><dt>Subject</dt><dd>{rendered.subject}</dd></div>
            </dl>
            <iframe className="cl-frame" title={`Message to ${preview.clubName}`} sandbox="" srcDoc={rendered.html} />
            <details className="cl-text">
              <summary>Plain-text version</summary>
              <pre>{rendered.text}</pre>
            </details>
          </>
        )}
      </section>

      <section className="adm-card" aria-labelledby="cl-send-h" hidden={view !== 'email'}>
        <h2 className="display" id="cl-send-h">Send</h2>
        <div className="adm-banner warn" role="note">
          <strong>Test mode.</strong> Every message goes to a test alias, never to a club. Sent from your Gmail as {FROM.address}.
        </div>
        <fieldset className="cl-who">
          <legend>Send the test messages to</legend>
          <label><input type="radio" name="who" checked={who === 'jz'} onChange={() => setWho('jz')} /> jzsharpe+…@gmail.com</label>
          <label><input type="radio" name="who" checked={who === 'ns'} onChange={() => setWho('ns')} /> nssharpe+…@gmail.com</label>
        </fieldset>
        <div className="adm-actions">
          <button type="button" className="btn" onClick={() => void connect()} disabled={sending}>{gmailToken ? 'Reconnect Gmail' : 'Connect Gmail'}</button>
          <span className="cl-state" role="status">{gmailToken ? `Connected as ${adminEmail}.` : 'Not connected.'}</span>
        </div>
        {gmailError && <div className="adm-banner err" role="alert">{gmailError}</div>}
        <label className="cl-check"><input type="checkbox" checked={skipToday} onChange={(e) => setSkipToday(e.target.checked)} /> Skip clubs already sent this reminder today{skippedSent > 0 ? ` (${skippedSent} skipped)` : ''}</label>
        <div className="adm-actions">
          <button type="button" className="btn primary" disabled={!gmailToken || targets.length === 0 || sending} onClick={() => { setFrozen({ rows: liveRows, log: liveLog }); setConfirm(true); }}>
            Send {targets.length} test email{targets.length === 1 ? '' : 's'}
          </button>
          <label className="cl-check cl-real-send">
            <input type="checkbox" disabled aria-describedby="cl-real-note" /> Send to real club addresses
          </label>
          <span id="cl-real-note" className="cl-state">Needs Julia's go-ahead for each send</span>
        </div>
        {!gmailToken && targets.length > 0 && <p className="adm-muted">Connect Gmail first.</p>}

        {progress && (
          <div className="cl-progress">
            <progress max={progress.total} value={progress.done} aria-label="Sending progress" />
            <span role="status">{progress.done} of {progress.total}</span>
          </div>
        )}
        {summary && <div className={`adm-banner ${summary.tone}`} role="status">{summary.text}</div>}
        {results.length > 0 && (
          <ul className="cl-results" aria-label="Send results">
            {results.map((r) => (
              <li key={r.clubId} className={r.ok ? 'ok' : 'bad'}>
                <strong>{r.clubName}</strong> → {r.to}: {r.ok ? 'Sent' : r.error}{r.logError ? ` (not logged: ${r.logError})` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      {details && sessionOpened && (
        // Mounted the first time Session reminders opens, then kept while other pills show, so an unsaved draft survives.
        <div hidden={view !== 'session'}>
        <SessionDetailsPanel
          meetId={meetId} meetName={meetName} linkBase={linkBase} adminEmail={adminEmail}
          sessions={details.sessions} athletes={details.athletes} clubs={details.clubs} gymOrder={details.gymOrder}
          schedule={details.schedule ?? {}} meetDate={details.meetDate ?? ''}
          template={details.sessionTemplate ?? LINEUPS_SESSION_TEMPLATE} templateSaved={!!details.sessionTemplate && details.sessionTemplateSaved !== false} coachRoles={details.coachRoles ?? null}
          log={liveLog} onLogged={onLogged}
          who={who} onWho={setWho}
          gmailToken={gmailToken} gmailError={gmailError} onConnect={() => void connect()} onExpired={() => setGmailToken(null)}
          pauseMs={pauseMs}
        />
        </div>
      )}

      <section className="adm-card" aria-labelledby="cl-log-h" hidden={view !== 'email'}>
        <h2 className="display" id="cl-log-h">Send log</h2>
        {logRows.length === 0 ? <p className="adm-muted">Nothing sent yet.</p> : (
          <table className="cl-table cl-log">
            <thead><tr><th scope="col">When</th><th scope="col">Reminder</th><th scope="col">Club</th><th scope="col">Sent to</th><th scope="col">By</th><th scope="col">Mode</th></tr></thead>
            <tbody>
              {logRows.map((e) => (
                <tr key={e.id}>
                  <td data-label="When">{e.at ? formatWhen(e.at) : '—'}</td>
                  <td data-label="Reminder">{LOG_LABEL[e.template]}</td>
                  <th scope="row" data-label="Club" className="cl-name">{e.club}</th>
                  <td data-label="Sent to" className="cl-wrap">{e.to}</td>
                  <td data-label="By" className="cl-wrap">{e.by}</td>
                  <td data-label="Mode">{e.mode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {confirm && (
        <Modal title="Send test emails?" onClose={() => { setConfirm(false); setFrozen(null); }}>
          <p>Send <strong>{targets.length}</strong> “{REMINDER_LABEL[kind]}” test email{targets.length === 1 ? '' : 's'} to {who === 'jz' ? 'jzsharpe' : 'nssharpe'}+…@gmail.com aliases? Nothing goes to the clubs. Keep this page open until it finishes.</p>
          <div className="adm-actions">
            <button type="button" className="btn ghost" onClick={() => { setConfirm(false); setFrozen(null); }}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => void send()}>Send {targets.length} test email{targets.length === 1 ? '' : 's'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
