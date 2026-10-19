import { useMemo, useState } from 'react';
import { Field, Modal } from './ui';
import { DEFAULT_MEET_SETTINGS } from '../lib/data/plan';
import type { MeetInfo } from '../lib/data/meet-store';
import { CONFLICT_KINDS, KINDS, KIND_LABEL, planLegacyCopy, type CopyMode, type LegacySnapshot, type MeetState } from '../lib/legacy-copy';

const NEW = '__new__';

export interface LegacyCopyApi {
  load: () => Promise<LegacySnapshot>;
  loadMeet: (meetId: string) => Promise<MeetState>;
  createMeet: (name: string) => Promise<string>;
  apply: (ops: ReturnType<typeof planLegacyCopy>['ops'], onProgress: (done: number, total: number) => void) => Promise<number>;
}

type Step = 'pick' | 'preview' | 'done';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One-time "Bring in earlier data": pick a meet, preview, (conflicts), copy, result. Nothing is deleted. */
export default function LegacyCopyDialog({ meets, defaultMeetId, api, onClose, onDone }: {
  meets: MeetInfo[];
  defaultMeetId: string | null;
  api: LegacyCopyApi;
  onClose: () => void;
  /** Called when the admin leaves the result screen; `meetId` is the meet that was filled. */
  onDone: (meetId: string | null) => void;
}) {
  const [step, setStep] = useState<Step>('pick');
  const [target, setTarget] = useState(meets.length ? (defaultMeetId ?? meets[0].id) : NEW);
  const [newName, setNewName] = useState('UCG Nationals 2026');
  const [snapshot, setSnapshot] = useState<LegacySnapshot | null>(null);
  const [state, setState] = useState<MeetState>(new Map());
  const [mode, setMode] = useState<CopyMode>('skip');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [finished, setFinished] = useState<{ meetId: string; meetName: string; written: number; links: number } | null>(null);

  const isNew = target === NEW;
  const meetName = isNew ? newName.trim() : (meets.find((m) => m.id === target)?.name ?? target);
  // A meet that does not exist yet is planned against an empty one (the id only matters for the write paths).
  const plan = useMemo(
    () => (snapshot ? planLegacyCopy(snapshot, state, isNew ? 'new-meet' : target, mode) : null),
    [snapshot, state, target, isNew, mode],
  );

  async function check() {
    setBusy(true);
    setError('');
    try {
      const [snap, st] = await Promise.all([snapshot ?? api.load(), isNew ? Promise.resolve(new Map() as MeetState) : api.loadMeet(target)]);
      setSnapshot(snap);
      setState(st);
      setMode('skip');
      setStep('preview');
    } catch (e) {
      setError(`Could not read the data: ${e instanceof Error ? e.message : 'try again'}`);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!snapshot) return;
    setBusy(true);
    setError('');
    try {
      let meetId = target;
      if (isNew) meetId = await api.createMeet(newName);
      // Plan again with the real meet id, so every path is right. A just-created meet starts with its default settings
      // (its own name included), which count as "not set" except the name: the admin's chosen name stays.
      const fresh: MeetState = new Map([['settings/meet', { ...DEFAULT_MEET_SETTINGS, meetName: newName.trim() }]]);
      const real = planLegacyCopy(snapshot, isNew ? fresh : state, meetId, mode);
      const written = await api.apply(real.ops, (d, t) => setProgress(`Copied ${d} of ${t}…`));
      setFinished({ meetId, meetName, written, links: real.links.working });
      setStep('done');
    } catch (e) {
      setError(`The copy stopped part-way: ${e instanceof Error ? e.message : 'try again'}. Nothing was deleted. It is safe to run it again: documents already copied are not repeated.`);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  const close = () => (step === 'done' ? onDone(finished?.meetId ?? null) : onClose());

  return (
    <Modal title="Bring in earlier data" onClose={close}>
      {step === 'pick' && (
        <form onSubmit={(e) => { e.preventDefault(); void check(); }}>
          <p>Your work from before meets were added is still stored in the old place. This copies it into a meet you choose. The original data is not changed or removed.</p>
          <Field label="Copy it into">
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {meets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              <option value={NEW}>A new meet…</option>
            </select>
          </Field>
          {isNew && (
            <Field label="New meet name" hint="It is created when you press Copy, not before.">
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </Field>
          )}
          {error && <div className="adm-banner err" role="alert">{error}</div>}
          <div className="adm-actions">
            <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn primary" type="submit" disabled={busy || (isNew && !newName.trim())}>{busy ? 'Reading…' : 'See what will be copied'}</button>
          </div>
        </form>
      )}

      {step === 'preview' && plan && (
        <div>
          <p>Copying into <strong>{meetName}</strong>{isNew ? ' (new meet)' : ''}.</p>
          <div className="adm-tablewrap">
            <table className="adm-table wrap">
              <caption className="sr-only">What will be copied</caption>
              <thead>
                <tr><th scope="col">Kind</th><th scope="col" className="num">Earlier data</th><th scope="col" className="num">To copy</th><th scope="col" className="num">Already there</th></tr>
              </thead>
              <tbody>
                {KINDS.filter((k) => plan.counts[k].total > 0).map((k) => {
                  const c = plan.counts[k];
                  return (
                    <tr key={k}>
                      <th scope="row">{KIND_LABEL[k]}</th>
                      <td className="num">{c.total}</td>
                      <td className="num">{c.copy}</td>
                      <td className="num">{c.skipped + c.unchanged}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {plan.settings.kept.length > 0 && (
            <p className="adm-muted">Settings the meet already has are kept: {plan.settings.kept.join(', ')}.</p>
          )}
          <p>
            <strong>{plural(plan.links.working, 'club link')}</strong> will work again for this meet
            {plan.links.alreadyHere > 0 ? ` (${plan.links.alreadyHere} already do)` : ''}. Saved orders come back with them.
            {plan.links.other > 0 && <span className="adm-muted"> {plural(plan.links.other, 'other link')} left alone.</span>}
          </p>

          {plan.hasConflicts && (
            <div className="adm-banner warn" role="group" aria-label="Conflicts">
              <strong>This meet already has data:</strong>{' '}
              {CONFLICT_KINDS.filter((k) => plan.existing[k] > 0).map((k) => `${KIND_LABEL[k].toLowerCase()} ${plan.existing[k]}`).join(', ')}.
              <fieldset className="adm-choice">
                <legend>What should happen to documents that exist in both?</legend>
                <label><input type="radio" name="legacy-mode" checked={mode === 'skip'} onChange={() => setMode('skip')} /> Skip anything that already exists in the meet</label>
                <label><input type="radio" name="legacy-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace</label>
              </fieldset>
              {mode === 'replace' && <p>Replace overwrites those documents in the meet with the earlier version. Settings the meet has are overwritten too (its name stays).</p>}
              {plan.tokenMismatch > 0 && <p>{plural(plan.tokenMismatch, 'club')} in this meet already has a different private link than the old one. The old link will still work, but the Clubs tab shows the other.</p>}
            </div>
          )}

          {plan.nothingToDo && <div className="adm-banner ok" role="status">Nothing to copy: this meet already has everything from the earlier data.</div>}
          {error && <div className="adm-banner err" role="alert">{error}</div>}
          {busy && <p role="status">{progress || 'Copying…'}</p>}
          <div className="adm-actions">
            <button className="btn ghost" type="button" disabled={busy} onClick={() => setStep('pick')}>Back</button>
            <button className="btn primary" type="button" disabled={busy || plan.nothingToDo} onClick={() => void copy()}>Copy</button>
          </div>
        </div>
      )}

      {step === 'done' && finished && (
        <div>
          <div className="adm-banner ok" role="status">
            Done. {plural(finished.written, 'write')} into {finished.meetName}; {plural(finished.links, 'club link')} work for this meet.
          </div>
          <p>The original data was left in place. Once you&rsquo;ve checked the meet, you can ask to have it removed.</p>
          <div className="adm-actions">
            <button className="btn primary" type="button" onClick={() => onDone(finished.meetId)}>Open {finished.meetName}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
