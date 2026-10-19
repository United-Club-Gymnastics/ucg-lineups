import { useEffect, useMemo, useState } from 'react';
import Select from './Select';
import { Modal } from './ui';
import type { MeetInfo } from '../lib/data/meet-store';
import { levelRefLabel, planOrderCopy, type ClubCopyInput, type CopyPlan } from '../lib/orders-copy';

export interface OrderCopyApi {
  /** Reads both meets' rosters and the clubs' saved orders. */
  load: (sourceMeetId: string, targetMeetId: string) => Promise<ClubCopyInput[]>;
  apply: (plan: CopyPlan, onProgress: (done: number, total: number) => void) => Promise<number>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "Start orders from another meet" (spec §7b): pick the meet to copy from, see what will happen (levels matched by level code, what
 * cannot be matched, counts), copy, see the result. Copying never overwrites an order a club already saved in this meet unless the
 * box is ticked.
 */
export default function OrderCopyDialog({ target, meets, api, onClose, onDone }: {
  target: MeetInfo;
  /** Visible (not archived) meets, newest first; the target is left out of the source list. */
  meets: MeetInfo[];
  api: OrderCopyApi;
  onClose: () => void;
  onDone: () => void;
}) {
  const sources = useMemo(() => meets.filter((m) => m.id !== target.id), [meets, target.id]);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [replace, setReplace] = useState(false);
  // The read for the chosen source: tagged with the source it belongs to, so a stale answer is never shown for another source.
  const [read, setRead] = useState<{ sourceId: string; input?: ClubCopyInput[]; error?: string } | null>(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<{ written: number; plan: CopyPlan } | null>(null);

  useEffect(() => {
    if (!sourceId) return;
    let live = true;
    api.load(sourceId, target.id).then(
      (v) => { if (live) setRead({ sourceId, input: v }); },
      (e) => { if (live) setRead({ sourceId, error: `Could not read the meets: ${e instanceof Error ? e.message : 'try again'}` }); },
    );
    return () => { live = false; };
  }, [api, sourceId, target.id]);

  const current = read && read.sourceId === sourceId ? read : null;
  const input = current?.input ?? null;
  const error = current?.error ?? actionError;
  const plan = useMemo(() => (input ? planOrderCopy(input, { replace }) : null), [input, replace]);
  const sourceName = sources.find((m) => m.id === sourceId)?.name ?? '';

  async function copy() {
    if (!plan) return;
    setBusy(true);
    setActionError('');
    try {
      const written = await api.apply(plan, (d, t) => setProgress(`Copied ${d} of ${t}…`));
      setResult({ written, plan });
    } catch (e) {
      setActionError(`The copy stopped part-way: ${e instanceof Error ? e.message : 'try again'}. It is safe to run it again: orders already copied count as set and are skipped.`);
    } finally {
      setBusy(false);
    }
  }

  if (sources.length === 0) {
    return (
      <Modal title="Start orders from another meet" onClose={onClose}>
        <p>There is no other meet to copy from. Create the earlier meet first (for example Prelims) and import its athletes.</p>
        <div className="adm-actions"><button className="btn primary" type="button" onClick={onClose}>OK</button></div>
      </Modal>
    );
  }

  if (result) {
    const p = result.plan;
    return (
      <Modal title="Orders copied" onClose={onDone}>
        <div className="adm-banner ok" role="status">
          Copied {plural(result.written, 'level order')} for {plural(p.clubs, 'club')} ({plural(p.athletes, 'athlete')}) from {sourceName} to {target.name}.
          They show as &ldquo;Order set&rdquo; and get no Still A&ndash;Z reminder.
        </div>
        <ul className="oc-list">
          {p.skippedSet > 0 && <li>{plural(p.skippedSet, 'level')} the club had already set in {target.name} {p.skippedSet === 1 ? 'was' : 'were'} left alone.</li>}
          {p.replaced > 0 && <li>{plural(p.replaced, 'order')} the club had already set {p.replaced === 1 ? 'was' : 'were'} replaced.</li>}
          {p.noSource > 0 && <li>{plural(p.noSource, 'level')} had no order set in {sourceName} and stay as they are. Those clubs are still reminded.</li>}
          {p.resplit > 0 && <li>{plural(p.resplit, 'level')} did not fit one squad with the copied groups, so the groups were split again.</li>}
        </ul>
        <NewcomerList plan={p} />
        <div className="adm-actions"><button className="btn primary" type="button" onClick={onDone}>Done</button></div>
      </Modal>
    );
  }

  return (
    <Modal title="Start orders from another meet" onClose={() => { if (!busy) onClose(); }}>
      <p>
        Copy the competing orders the clubs set in another meet into <strong>{target.name}</strong>. Each club&rsquo;s groups and
        per-event order are kept for the athletes who are in both meets. Levels are matched by level code within MAG or WAG.
      </p>
      <label className="oc-field">
        <span>Copy orders from</span>
        <Select aria-label="Copy orders from" value={sourceId} onChange={setSourceId} options={sources.map((m) => ({ value: m.id, label: m.name }))} disabled={busy} />
      </label>

      {!input && !error && <p role="status">Reading both meets and the clubs&rsquo; orders…</p>}
      {plan && (
        <div className="oc-summary" data-testid="copy-summary">
          <p className="oc-big">
            <strong>{plural(plan.levels, 'level order')}</strong> for <strong>{plural(plan.clubs, 'club')}</strong> ({plural(plan.athletes, 'athlete')}) will be copied.
          </p>
          <ul className="oc-list">
            <li>
              {plan.skippedSet > 0 && !replace
                ? `${plural(plan.skippedSet, 'level')} the club already set in ${target.name} will be left alone.`
                : replace && plan.replaced > 0
                  ? `${plural(plan.replaced, 'level')} the club already set in ${target.name} will be replaced.`
                  : `No club has set an order in ${target.name} yet.`}
            </li>
            <li>{plural(plan.noSource, 'level')} {plan.noSource === 1 ? 'has' : 'have'} no order to copy (left at A&ndash;Z in {sourceName}, or not in it) and stay as they are.</li>
            {plan.resplit > 0 && <li>{plural(plan.resplit, 'level')} will be split again because the copied groups do not fit one squad.</li>}
            {plan.unplaced > 0 && <li>{plural(plan.unplaced, 'order')} from {sourceName} {plan.unplaced === 1 ? 'has' : 'have'} no matching level for that club in {target.name} and will not be copied.</li>}
          </ul>
          <label className="oc-check">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} disabled={busy} />
            <span>Replace orders already set in this meet</span>
          </label>
          {(plan.unmatchedSource.length > 0 || plan.unmatchedTarget.length > 0) && (
            <div className="adm-banner warn" role="status" data-testid="copy-unmatched">
              <strong>Levels that could not be matched</strong>
              {plan.unmatchedSource.length > 0 && <p>In {sourceName} only: {plan.unmatchedSource.map(levelRefLabel).join(', ')}. Nothing is copied for these.</p>}
              {plan.unmatchedTarget.length > 0 && <p>In {target.name} only: {plan.unmatchedTarget.map(levelRefLabel).join(', ')}. These stay as they are.</p>}
            </div>
          )}
          <NewcomerList plan={plan} />
        </div>
      )}
      {error && <div className="adm-banner err" role="alert">{error}</div>}
      <div className="adm-actions">
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" type="button" onClick={() => void copy()} disabled={busy || !plan || plan.levels === 0}>
          {busy ? (progress || 'Copying…') : 'Copy orders'}
        </button>
        {plan && plan.levels === 0 && <span className="adm-muted">Nothing to copy.</span>}
      </div>
    </Modal>
  );
}

function NewcomerList({ plan }: { plan: CopyPlan }) {
  if (plan.newcomers.length === 0) return null;
  return (
    <div className="adm-banner warn" role="status" data-testid="copy-newcomers">
      <strong>New in this meet</strong>
      <p>These athletes were not in the earlier order. They are put at the end of their level, A&ndash;Z.</p>
      <ul className="oc-list">{plan.newcomers.map((n) => <li key={`${n.clubName}|${n.levelName}`}>{n.clubName}, {n.levelName}: {n.names.join(', ')}</li>)}</ul>
    </div>
  );
}
