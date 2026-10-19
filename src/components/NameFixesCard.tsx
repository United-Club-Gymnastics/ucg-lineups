// Import tab: the meet's name fixes. ScoreFlippers and the Synchro tool export some names with the spaces stripped
// ("MurrayMetzger"); the host enters how each should be shown, once per meet. Display only (see src/lib/name-fixes.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../lib/firebase';
import { loadAthletes, publishClubLinks, saveNameFixesAndRepublish } from '../lib/data/store';
import { loadNameFixes } from '../lib/data/name-fixes-store';
import type { StoredAthlete } from '../lib/import/diff';
import {
  countAffected, removeNameFix, suggestNameFixes, upsertNameFix, validateNameFix, type NameField, type NameFix,
} from '../lib/name-fixes';
import Select from './Select';
import { Field } from './ui';

const FIELD_LABEL: Record<NameField, string> = { first: 'First name', last: 'Last name' };
const FIELD_OPTIONS = [{ value: 'last', label: FIELD_LABEL.last }, { value: 'first', label: FIELD_LABEL.first }];
const EMPTY = { field: 'last' as NameField, from: '', to: '' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function NameFixesCard({ meetId, reloadKey = 0 }: { meetId: string; reloadKey?: number }) {
  const [athletes, setAthletes] = useState<StoredAthlete[]>([]);
  const [fixes, setFixes] = useState<NameFix[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; retry?: boolean } | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState('');
  const showAsRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    Promise.all([loadAthletes(db, meetId), loadNameFixes(db, meetId)]).then(([a, f]) => {
      setAthletes(a);
      setFixes(f);
      setState('ready');
    }, (e) => {
      setLoadError(e instanceof Error ? e.message : 'Could not read the name fixes.');
      setState('error');
    });
  }, [meetId]);
  // The parent keys this card by meet, so a new meet starts with a clean form and notice. A re-import re-reads quietly.
  useEffect(() => { load(); }, [load, reloadKey]);

  const suggestions = useMemo(() => suggestNameFixes(athletes, fixes), [athletes, fixes]);
  const preview = form.from.trim() ? countAffected(athletes, form) : null;

  async function commit(next: NameFix[], what: string): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    try {
      const r = await saveNameFixesAndRepublish(db, meetId, fixes, next);
      setFixes(next);
      if (r.publishError) {
        setNotice({ ok: false, retry: true, text: `${what} saved, but publishing the club pages failed: ${r.publishError}. Republish them to retry.` });
      } else {
        const pages = r.republished.length === 0 ? 'No club pages needed republishing.' : `Republished ${plural(r.republished.length, 'club page')}: ${r.republished.join(', ')}.`;
        setNotice({ ok: true, text: `${what} saved. ${pages}` });
      }
      return true;
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : 'Could not save the name fixes.' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function republishAll() {
    setBusy(true);
    try {
      const n = await publishClubLinks(db, meetId);
      setNotice({ ok: true, text: `Republished ${plural(n, 'club page')}.` });
    } catch (e) {
      setNotice({ ok: false, retry: true, text: `Publishing the club pages failed: ${e instanceof Error ? e.message : 'unknown error'}.` });
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const fix: NameFix = { field: form.field, from: form.from, to: form.to };
    const problem = validateNameFix(fix);
    setFormError(problem ?? '');
    if (problem) return;
    if (await commit(upsertNameFix(fixes, fix), 'Name fix')) setForm(EMPTY);
  }

  function edit(s: NameFix) {
    setForm({ field: s.field, from: s.from, to: s.to });
    setFormError('');
    showAsRef.current?.focus();
  }

  return (
    <section className="adm-card" aria-labelledby="nf-title">
      <h2 className="display" id="nf-title">Name fixes</h2>
      <p className="adm-muted">
        Some names come out of ScoreFlippers and the Synchro tool with the spaces stripped (&ldquo;MurrayMetzger&rdquo;). Say how
        each should be shown. Fixes belong to this meet, apply everywhere a name is shown (club pages, squads, sheets, PDFs and
        emails) and stay when you import again. Matching and saved orders keep using the export&rsquo;s spelling.
      </p>

      {state === 'loading' && <p className="adm-muted" role="status">Loading name fixes…</p>}
      {state === 'error' && (
        <div className="adm-banner err" role="alert">
          Could not read the name fixes: {loadError}{' '}
          <button className="btn ghost small" type="button" onClick={() => { setState('loading'); load(); }}>Try again</button>
        </div>
      )}

      {notice && (
        <div className={`adm-banner ${notice.ok ? 'ok' : 'err'}`} role={notice.ok ? 'status' : 'alert'}>
          {notice.text}{' '}
          {notice.retry && <button className="btn ghost small" type="button" disabled={busy} onClick={() => void republishAll()}>Republish club pages</button>}
        </div>
      )}

      {state === 'ready' && (
        <>
          <h3>Current fixes</h3>
          {fixes.length === 0 ? (
            <p className="adm-muted">No fixes yet.</p>
          ) : (
            <ul className="nf-list" aria-label="Name fixes for this meet">
              {fixes.map((f) => (
                <li key={`${f.field}|${f.from}`}>
                  <span className="nf-what">
                    <span className="nf-kind">{FIELD_LABEL[f.field]}</span>
                    <b>{f.from}</b> <span aria-hidden="true">&rarr;</span><span className="sr-only"> shown as </span> <b>{f.to}</b>
                    <span className="adm-muted"> · {plural(countAffected(athletes, f), 'athlete')}</span>
                  </span>
                  <span className="nf-btns">
                    <button className="btn ghost small" type="button" disabled={busy} aria-label={`Remove the fix for ${f.from}`} onClick={() => void commit(removeNameFix(fixes, f), 'Removal')}>Remove</button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3>Add a fix</h3>
          <form className="nf-form" onSubmit={(e) => { e.preventDefault(); void add(); }} noValidate>
            <Field label="Name"><Select value={form.field} options={FIELD_OPTIONS} onChange={(v) => setForm({ ...form, field: v as NameField })} /></Field>
            <Field label="As in the export"><input type="text" value={form.from} maxLength={60} autoComplete="off" onChange={(e) => setForm({ ...form, from: e.target.value })} /></Field>
            <Field label="Show as"><input type="text" ref={showAsRef} value={form.to} maxLength={60} autoComplete="off" onChange={(e) => setForm({ ...form, to: e.target.value })} /></Field>
            <button className="btn primary" type="submit" disabled={busy}>Add fix</button>
          </form>
          {preview !== null && <p className="adm-muted" role="status">Changes the name of {plural(preview, 'athlete')} in this meet.</p>}
          {formError && <p className="nf-error" role="alert">{formError}</p>}

          <h3>Suggestions</h3>
          {suggestions.length === 0 ? (
            <p className="adm-muted">Nothing to suggest. Names with a capital inside them (like MurrayMetzger) show up here.</p>
          ) : (
            <>
              <p className="adm-muted">Names with a capital letter inside them. Nothing changes until you accept one. Prefixes like Mc, Mac, De, Di, Van and Von are left alone.</p>
              <ul className="nf-list">
                {suggestions.map((s) => (
                  <li key={`${s.field}|${s.from}`}>
                    <span className="nf-what">
                      <span className="nf-kind">{FIELD_LABEL[s.field]}</span>
                      <b>{s.from}</b> <span aria-hidden="true">&rarr;</span><span className="sr-only"> shown as </span> <b>{s.to}</b>
                      <span className="adm-muted"> · {plural(s.count, 'athlete')}</span>
                    </span>
                    <span className="nf-btns">
                      <button className="btn primary small" type="button" disabled={busy} aria-label={`Accept ${s.from} as ${s.to}`} onClick={() => void commit(upsertNameFix(fixes, s), 'Name fix')}>Accept</button>
                      <button className="btn ghost small" type="button" disabled={busy} aria-label={`Edit the fix for ${s.from}`} onClick={() => edit(s)}>Edit</button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
