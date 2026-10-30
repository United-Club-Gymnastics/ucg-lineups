import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Select from '../Select';
import { Modal } from '../ui';
import { db } from '../../lib/firebase';
import { addEmailLog, loadOtherSessionTemplates, saveCoachRoles, saveSessionTemplate, type EmailLogEntry } from '../../lib/data/email-store';
import type { StoredClub } from '../../lib/data/plan';
import type { StoredAthlete } from '../../lib/import/diff';
import type { Session } from '../../lib/import/types';
import { buildSessionReminderEmail, REMINDER_PLACEHOLDERS, type ReminderTemplate } from '../../lib/email/session-reminder-email';
import { FROM, sendTestBatch, SEND_MODE, testAlias, type FetchLike, type SendResult, type TestWho } from '../../lib/email-send';
import { resolveSchedule } from '../../lib/schedule';
import { scheduleKey, sortByName } from '../../lib/session-names';
import { sessionTitle } from '../../lib/squad-data';
import {
  buildSessionRecipients, coachRolesOrDefault, contactRoles, LINEUPS_SESSION_TEMPLATE, sessionEmailContext, sessionEmailLabel, type SessionRecipient,
} from '../../lib/session-details';
import type { ScheduleRows } from '../../lib/schedule';

type Role = 'athlete' | 'coach';

/** The text fields of the template, in the order the email shows them. `reminders` is edited one per line. */
const FIELDS: { key: Exclude<keyof ReminderTemplate, 'reminders'>; label: string; rows?: number; hint?: string }[] = [
  { key: 'subject', label: 'Subject' },
  { key: 'intro', label: 'Introduction', rows: 3 },
  { key: 'facilityNote', label: 'Facility note', rows: 3, hint: 'Hidden when blank.' },
  { key: 'rotationNote', label: 'Under the Rotation Sheet link', rows: 3 },
  { key: 'scorecardsNote', label: 'Under the Scorecards link', rows: 3 },
  { key: 'callout', label: 'Call-out box', rows: 3, hint: 'Hidden when blank.' },
  { key: 'calloutButton', label: 'Call-out button text', hint: 'The button shows only with text and a link.' },
  { key: 'calloutUrl', label: 'Call-out button link', hint: 'Starts with https://' },
  { key: 'scheduleNote', label: 'Schedule note', rows: 3 },
  { key: 'livestreamUrl', label: 'Livestream link', hint: 'Adds “Don’t forget that we will be livestreaming the event here.” Hidden when blank.' },
  { key: 'signoff', label: 'Sign-off', rows: 3 },
  { key: 'footnote', label: 'Small print', rows: 2 },
];

const sameTemplate = (a: ReminderTemplate, b: ReminderTemplate) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The "Session details" message (Julia 2026-10-30): the platform's session reminder email, sent per session to each athlete and
 * to each club's coaches. Same two pills as the club reminders: 'message' edits the wording and previews a real recipient,
 * 'email' picks the session and people and sends. Test mode only: every message goes to a jzsharpe+/nssharpe+ alias.
 */
export default function SessionDetailsPanel(props: {
  /** The page's pill: nothing shows on 'clubs'. */
  view: 'clubs' | 'email' | 'message';
  /** The Still A–Z / split / Session details switch, drawn at the top of each card. */
  switcher: ReactNode;
  meetId: string;
  meetName: string;
  linkBase: string;
  adminEmail: string;
  sessions: Session[];
  athletes: StoredAthlete[];
  clubs: StoredClub[];
  gymOrder: string[];
  schedule: ScheduleRows;
  meetDate: string;
  template: ReminderTemplate;
  coachRoles: string[] | null;
  log: EmailLogEntry[];
  onLogged: (e: EmailLogEntry) => void;
  who: TestWho;
  onWho: (w: TestWho) => void;
  gmailToken: string | null;
  gmailError: string;
  onConnect: () => void;
  onExpired: () => void;
  /** "Preview" on a person: show the Message & preview pill, scrolled to the preview. */
  onPreview: () => void;
  pauseMs?: number;
}) {
  const { view, meetId, linkBase } = props;
  const sessions = useMemo(() => sortByName(props.sessions, props.gymOrder), [props.sessions, props.gymOrder]);
  const [sessionId, setSessionId] = useState('');
  const session = sessions.find((s) => s.id === sessionId) ?? sessions[0];

  // Wording.
  const [template, setTemplate] = useState<ReminderTemplate>(props.template);
  const [stored, setStored] = useState<ReminderTemplate>(props.template);
  const [tplState, setTplState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const tplDirty = !sameTemplate(template, stored);
  const [others, setOthers] = useState<{ meetId: string; meetName: string; template: ReminderTemplate }[]>([]);
  const [copyFrom, setCopyFrom] = useState('');
  useEffect(() => {
    if (view !== 'message') return;
    let off = false;
    Promise.resolve().then(() => loadOtherSessionTemplates(db, meetId)).then((x) => { if (!off) setOthers(x); }, () => {});
    return () => { off = true; };
  }, [view, meetId]);
  const setField = (key: keyof ReminderTemplate, value: string) => {
    setTemplate((t) => ({ ...t, [key]: key === 'reminders' ? value.split('\n') : value }));
    setTplState('idle');
  };
  async function saveTemplate() {
    setTplState('saving');
    const clean = { ...template, reminders: template.reminders.map((r) => r.trim()).filter(Boolean) };
    try {
      await saveSessionTemplate(db, meetId, clean);
      setTemplate(clean);
      setStored(clean);
      setTplState('saved');
    } catch {
      setTplState('error');
    }
  }
  const urlError = (['calloutUrl', 'livestreamUrl'] as const).some((k) => template[k].trim() && !/^https?:\/\//i.test(template[k].trim()));

  // Coaches: which League Communications roles count.
  const roles = useMemo(() => contactRoles(props.clubs), [props.clubs]);
  const [coachRoles, setCoachRoles] = useState<string[]>(() => coachRolesOrDefault(props.coachRoles, roles));
  const [savedRoles, setSavedRoles] = useState<string[] | null>(props.coachRoles);
  const [roleState, setRoleState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const rolesDirty = JSON.stringify([...coachRoles].sort()) !== JSON.stringify([...(savedRoles ?? coachRolesOrDefault(null, roles))].sort()) || savedRoles === null;
  async function saveRoles() {
    setRoleState('saving');
    try {
      await saveCoachRoles(db, meetId, coachRoles);
      setSavedRoles(coachRoles);
      setRoleState('saved');
    } catch {
      setRoleState('error');
    }
  }

  // Who gets it, for the chosen session.
  const recips = useMemo(
    () => (session ? buildSessionRecipients({ sessionId: session.id, athletes: props.athletes, clubs: props.clubs, coachRoles }) : null),
    [session, props.athletes, props.clubs, coachRoles],
  );
  const everyone: SessionRecipient[] = useMemo(() => (recips ? [...recips.coaches, ...recips.athletes] : []), [recips]);
  const schedule = session ? resolveSchedule(scheduleKey(session), props.schedule, session.scheduleOverride, props.meetDate) : null;
  const sent = useMemo(
    () => new Set(props.log.filter((e) => e.template === 'session' && e.sessionId === session?.id && e.recipientKey).map((e) => e.recipientKey!)),
    [props.log, session],
  );
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [skipSent, setSkipSent] = useState(true);
  const targets = everyone.filter((r) => !excluded.has(r.key) && !(skipSent && sent.has(r.key)));
  const skipped = everyone.filter((r) => !excluded.has(r.key) && skipSent && sent.has(r.key)).length;

  // Preview: a real recipient of the chosen kind, else a stand-in so the wording can be checked before addresses are imported.
  const [role, setRole] = useState<Role>('athlete');
  const [previewKey, setPreviewKey] = useState('');
  const ofRole = role === 'coach' ? (recips?.coaches ?? []) : (recips?.athletes ?? []);
  const sample: SessionRecipient = role === 'coach'
    ? { key: 'sample', role, name: 'Sample Coach', firstName: 'Sample', email: '', clubName: 'Sample club', athletes: [{ name: 'Sample Athlete', club: 'Sample club' }] }
    : { key: 'sample', role, name: 'Sample Athlete', firstName: 'Sample', email: '', clubName: 'Sample club' };
  const previewed = ofRole.find((r) => r.key === previewKey) ?? ofRole[0] ?? sample;
  const ctxFor = (r: SessionRecipient) => sessionEmailContext({ meetName: props.meetName, meetId, session: session!, schedule: schedule!, recipient: r, linkBase });
  const rendered = session && schedule ? buildSessionReminderEmail(template, ctxFor(previewed)) : null;
  const showPreview = (r: SessionRecipient) => {
    setRole(r.role);
    setPreviewKey(r.key);
    props.onPreview();
  };

  // Sending.
  const [confirm, setConfirm] = useState<SessionRecipient[] | null>(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<SendResult[]>([]);
  const [summary, setSummary] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  async function send(list: SessionRecipient[]) {
    if (!props.gmailToken || !session || !schedule) return;
    setConfirm(null);
    setSending(true);
    setSummary(null);
    setResults([]);
    setProgress({ done: 0, total: list.length });
    const label = sessionEmailLabel(session);
    const byKey = new Map(list.map((r) => [`${session.id}|${r.key}`, r]));
    const messages = list.map((r) => ({ clubId: `${session.id}|${r.key}`, clubName: `${r.name || r.email} (${r.role})`, ...buildSessionReminderEmail(template, ctxFor(r)) }));
    const out = await sendTestBatch({
      token: props.gmailToken,
      who: props.who,
      messages,
      pauseMs: props.pauseMs,
      fetchImpl: globalThis.fetch as unknown as FetchLike,
      onSent: async (res, msg) => {
        const r = byKey.get(res.clubId)!;
        const entry = { template: 'session' as const, clubId: r.key, club: `${r.name || r.email} · ${label}`, to: res.to, subject: msg.subject, by: props.adminEmail, sessionId: session.id, recipientKey: r.key };
        await addEmailLog(db, meetId, entry);
        props.onLogged({ id: `local-${Date.now()}-${r.key}`, ...entry, at: new Date(), mode: SEND_MODE });
      },
      onProgress: (done, total, r) => {
        setProgress({ done, total });
        setResults((prev) => [r, ...prev]);
      },
    });
    setSending(false);
    const ok = out.filter((r) => r.ok).length;
    const expired = out.length < messages.length;
    setSummary({
      tone: ok === messages.length ? 'ok' : 'warn',
      text: `Sent ${ok} of ${messages.length} test email${messages.length === 1 ? '' : 's'}.${expired ? ` Stopped early: ${messages.length - out.length} not tried. Reconnect Gmail and send again (people already sent are skipped).` : ''}${out.some((r) => r.logError) ? ' Some messages were sent but could not be written to the log.' : ''}`,
    });
    if (expired) props.onExpired();
  }

  const sessionPicker = (
    <label className="cl-field">
      <span>Session</span>
      <Select aria-label="Session" value={session?.id ?? ''} onChange={(v) => { setSessionId(v); setPreviewKey(''); setSummary(null); setResults([]); }}
        options={sessions.map((s) => ({ value: s.id, label: sessionTitle(s) }))} />
    </label>
  );

  if (!session) {
    return (
      <section className="adm-card" hidden={view !== 'email' && view !== 'message'}>
        <h2 className="display">Session details</h2>
        {props.switcher}
        <p className="adm-muted">No sessions yet: import the meet first.</p>
      </section>
    );
  }

  return (
    <>
      <section className="adm-card" aria-labelledby="sd-who-h" hidden={view !== 'email'}>
        <div className="cl-head">
          <h2 className="display" id="sd-who-h">Session details</h2>
          <span className="badge warn">Test mode: real addresses are off</span>
        </div>
        {props.switcher}
        <p className="adm-muted">Each athlete in the session gets their own email with the session’s date, times and links to its rotation sheet and scorecards. Each club’s coaches get one email listing their athletes in the session. Independents get the athlete email only.</p>

        <fieldset className="cl-who sd-roles">
          <legend>League Communications roles that count as coaches</legend>
          {roles.length === 0 ? (
            <p className="adm-muted sd-none">No contacts imported yet. Re-export League Communications from ScoreFlippers with all roles and import it with the athletes.</p>
          ) : roles.map((r) => (
            <label key={r.role}>
              <input type="checkbox" checked={coachRoles.includes(r.role)}
                onChange={(e) => { setCoachRoles((prev) => (e.target.checked ? [...prev, r.role] : prev.filter((x) => x !== r.role))); setRoleState('idle'); }} />
              {r.role} ({r.count})
            </label>
          ))}
        </fieldset>
        {roles.length > 0 && (
          <div className="adm-actions">
            <button type="button" className="btn" disabled={!rolesDirty || roleState === 'saving'} onClick={() => void saveRoles()}>Save coach roles</button>
            <span className={`cl-state${roleState === 'error' ? ' err' : ''}`} role={roleState === 'error' ? 'alert' : 'status'}>
              {roleState === 'saving' ? 'Saving…' : roleState === 'saved' ? 'Saved' : roleState === 'error' ? "Couldn't save. Try again." : savedRoles === null ? 'Not saved yet: roles with “coach” in the name are ticked.' : rolesDirty ? 'Unsaved changes (the list below uses what is ticked)' : ''}
            </span>
          </div>
        )}

        {sessionPicker}
        {recips && (
          <p className="cl-count">
            {recips.athleteCount} athlete{recips.athleteCount === 1 ? '' : 's'} compete in this session: {recips.athletes.length} athlete email{recips.athletes.length === 1 ? '' : 's'} and {recips.coaches.length} coach email{recips.coaches.length === 1 ? '' : 's'}.
          </p>
        )}
        {recips && recips.missing.length > 0 && (
          <details className="adm-banner warn sd-missing">
            <summary><strong>No address</strong> ({recips.missing.length}): they get nothing</summary>
            <ul>
              {recips.missing.map((m, i) => (
                <li key={i}>{m.role === 'coach' ? `${m.clubName}: no coach address` : `${m.name} (${m.clubName})`}</li>
              ))}
            </ul>
          </details>
        )}

        {everyone.length === 0 ? (
          <p className="adm-muted">Nobody in this session has an address yet.</p>
        ) : (
          <>
            <div className="cl-all">
              <span className="adm-muted">{everyone.length - everyone.filter((r) => excluded.has(r.key)).length} of {everyone.length} ticked</span>
              <button type="button" className="btn ghost small" disabled={sending || everyone.every((r) => !excluded.has(r.key))}
                onClick={() => setExcluded((prev) => { const n = new Set(prev); for (const r of everyone) n.delete(r.key); return n; })}>Check all</button>
              <button type="button" className="btn ghost small" disabled={sending || everyone.every((r) => excluded.has(r.key))}
                onClick={() => setExcluded((prev) => { const n = new Set(prev); for (const r of everyone) n.add(r.key); return n; })}>Uncheck all</button>
            </div>
            <ul className="cl-recips" aria-label="People to send the session details email to">
              {everyone.map((r) => (
                <li key={r.key}>
                  <label>
                    <input type="checkbox" checked={!excluded.has(r.key)}
                      onChange={(ev) => setExcluded((prev) => { const n = new Set(prev); if (ev.target.checked) n.delete(r.key); else n.add(r.key); return n; })} />
                    <span>{r.name || r.email}</span>
                  </label>
                  <span className="cl-recip-note">
                    {r.role === 'coach' ? `Coach · ${r.clubName} · ${r.athletes?.length ?? 0} athlete${r.athletes?.length === 1 ? '' : 's'}` : `Athlete · ${r.clubName}`}
                    {sent.has(r.key) && <em> · sent</em>}
                  </span>
                  <button type="button" className="btn ghost small" aria-label={`Preview ${r.name || r.email}`} onClick={() => showPreview(r)}>Preview</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="adm-card" aria-labelledby="sd-send-h" hidden={view !== 'email'}>
        <h2 className="display" id="sd-send-h">Send</h2>
        <div className="adm-banner warn" role="note">
          <strong>Test mode.</strong> Every message goes to a test alias, never to an athlete or coach. Sent from your Gmail as {FROM.address}.
        </div>
        <fieldset className="cl-who">
          <legend>Send the test messages to</legend>
          <label><input type="radio" name="sd-who" checked={props.who === 'jz'} onChange={() => props.onWho('jz')} /> jzsharpe+…@gmail.com</label>
          <label><input type="radio" name="sd-who" checked={props.who === 'ns'} onChange={() => props.onWho('ns')} /> nssharpe+…@gmail.com</label>
        </fieldset>
        <div className="adm-actions">
          <button type="button" className="btn" onClick={props.onConnect} disabled={sending}>{props.gmailToken ? 'Reconnect Gmail' : 'Connect Gmail'}</button>
          <span className="cl-state" role="status">{props.gmailToken ? `Connected as ${props.adminEmail}.` : 'Not connected.'}</span>
        </div>
        {props.gmailError && <div className="adm-banner err" role="alert">{props.gmailError}</div>}
        <label className="cl-check"><input type="checkbox" checked={skipSent} onChange={(e) => setSkipSent(e.target.checked)} /> Skip people already sent this session’s email{skipped > 0 ? ` (${skipped} skipped)` : ''}</label>
        <div className="adm-actions">
          <button type="button" className="btn primary" disabled={!props.gmailToken || targets.length === 0 || sending || tplDirty} onClick={() => setConfirm(targets)}>
            Send {targets.length} test email{targets.length === 1 ? '' : 's'}
          </button>
          {tplDirty && <span className="cl-state">Save the message first (Message &amp; preview).</span>}
        </div>
        {!props.gmailToken && targets.length > 0 && <p className="adm-muted">Connect Gmail first.</p>}
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

      <section className="adm-card" aria-labelledby="sd-tpl-h" hidden={view !== 'message'}>
        <h2 className="display" id="sd-tpl-h">Message: Session details</h2>
        {props.switcher}
        <p className="adm-muted">Plain text: line breaks are kept, nothing else is formatted. Placeholders: {REMINDER_PLACEHOLDERS.filter((p) => p !== '{end}').map((p) => <code key={p} className="cl-ph">{p}</code>)}. The greeting, the session’s date and times, the coach’s list of athletes and the two sheet links are added for you.</p>
        <div className="cl-filters">
          <label className="cl-field cl-grow">
            <span>Copy text from</span>
            <Select aria-label="Copy text from" value={copyFrom} onChange={setCopyFrom} placeholder="Choose…"
              options={[{ value: 'default', label: 'UCG default' }, ...others.map((o) => ({ value: o.meetId, label: o.meetName }))]} />
          </label>
          <button type="button" className="btn ghost" disabled={!copyFrom} onClick={() => {
            const t = copyFrom === 'default' ? LINEUPS_SESSION_TEMPLATE : others.find((o) => o.meetId === copyFrom)?.template;
            if (t) { setTemplate(t); setTplState('idle'); }
          }}>Copy</button>
        </div>
        {FIELDS.map((f) => {
          const hint = f.hint ? `sd-hint-${f.key}` : undefined;
          return (
            <div key={f.key}>
              <label className="cl-field">
                <span>{f.label}</span>
                {f.rows ? (
                  <textarea rows={f.rows} value={template[f.key]} aria-describedby={hint} onChange={(e) => setField(f.key, e.target.value)} />
                ) : (
                  <input value={template[f.key]} aria-describedby={hint} inputMode={f.key.endsWith('Url') ? 'url' : undefined} onChange={(e) => setField(f.key, e.target.value)} />
                )}
              </label>
              {f.hint && <small id={hint} className="sd-hint">{f.hint}</small>}
            </div>
          );
        }).flatMap((el, i) => (FIELDS[i].key === 'scheduleNote' ? [el, (
          <label key="reminders" className="cl-field">
            <span>Reminders (one per line)</span>
            <textarea rows={8} value={template.reminders.join('\n')} onChange={(e) => setField('reminders', e.target.value)} />
          </label>
        )] : [el]))}
        {urlError && <div className="adm-banner err" role="alert">A link must start with http:// or https://.</div>}
        <div className="adm-actions">
          <button type="button" className="btn" onClick={() => void saveTemplate()} disabled={!tplDirty || tplState === 'saving' || urlError}>Save message</button>
          <button type="button" className="btn ghost" onClick={() => { setTemplate(LINEUPS_SESSION_TEMPLATE); setTplState('idle'); }}>Reset to the UCG default</button>
          <span className="cl-state" role="status">{tplState === 'saving' ? 'Saving…' : tplState === 'saved' ? 'Saved' : tplDirty ? 'Unsaved changes (the preview uses what is typed here)' : ''}</span>
          {tplState === 'error' && <span className="cl-state err" role="alert">Couldn't save. Try again.</span>}
        </div>
      </section>

      <section className="adm-card" aria-labelledby="sd-prev-h" hidden={view !== 'message'}>
        <h2 className="display" id="sd-prev-h" tabIndex={-1}>Preview</h2>
        <div className="cl-filters">
          {sessionPicker}
          <div className="cl-seg" role="group" aria-label="Which email">
            {(['athlete', 'coach'] as Role[]).map((r) => (
              <button key={r} type="button" aria-pressed={role === r} onClick={() => { setRole(r); setPreviewKey(''); }}>{r === 'athlete' ? 'Athlete' : 'Coach'}</button>
            ))}
          </div>
          {ofRole.length > 0 && (
            <label className="cl-field cl-grow">
              <span>{role === 'coach' ? 'Coach' : 'Athlete'}</span>
              <Select aria-label={role === 'coach' ? 'Coach' : 'Athlete'} value={previewed.key} onChange={setPreviewKey}
                options={ofRole.map((r) => ({ value: r.key, label: r.role === 'coach' ? `${r.name || r.email} (${r.clubName})` : `${r.name} (${r.clubName})` }))} />
            </label>
          )}
        </div>
        {ofRole.length === 0 && <p className="adm-muted">No {role === 'coach' ? 'coach' : 'athlete'} in this session has an address yet: showing a sample.</p>}
        {rendered && (
          <>
            <dl className="cl-mailhead">
              <div><dt>From</dt><dd>{FROM.name} &lt;{FROM.address}&gt;</dd></div>
              <div>
                <dt>To</dt>
                <dd>
                  <span className="cl-alias">{testAlias(props.who, `${session.id}|${previewed.key}`)}</span> <span className="badge info">test alias</span>{' '}
                  {previewed.email && <s className="cl-real" aria-label="Real address, not used in test mode">{previewed.email}</s>}
                </dd>
              </div>
              <div><dt>Subject</dt><dd>{rendered.subject}</dd></div>
            </dl>
            <iframe className="cl-frame sd-frame" title={`Session details email to ${previewed.name}`} sandbox="" srcDoc={rendered.html} />
            <details className="cl-text">
              <summary>Plain-text version</summary>
              <pre>{rendered.text}</pre>
            </details>
          </>
        )}
      </section>

      {confirm && (
        <Modal title="Send test emails?" onClose={() => setConfirm(null)}>
          <p>Send <strong>{confirm.length}</strong> “Session details” test email{confirm.length === 1 ? '' : 's'} for {sessionTitle(session)} to {props.who === 'jz' ? 'jzsharpe' : 'nssharpe'}+…@gmail.com aliases? Nothing goes to athletes or coaches. Keep this page open until it finishes.</p>
          <div className="adm-actions">
            <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => void send(confirm)}>Send {confirm.length} test email{confirm.length === 1 ? '' : 's'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
