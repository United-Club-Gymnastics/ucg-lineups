import { useEffect, useState } from 'react';
import { Modal } from './ui';
import type { UpgradePlan } from '../lib/club-links-upgrade';

export interface UpgradeLinksApi {
  load: () => Promise<UpgradePlan>;
  apply: (plan: UpgradePlan, onProgress: (done: number, total: number) => void) => Promise<number>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One-time "Upgrade club links" (spec §7c): preview the counts, run it, see the result. Safe to run again. */
export default function UpgradeLinksDialog({ api, onClose, onDone }: { api: UpgradeLinksApi; onClose: () => void; onDone: () => void }) {
  const [plan, setPlan] = useState<UpgradePlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    api.load().then((p) => { if (live) setPlan(p); }, (e) => { if (live) setError(`Could not read the club links: ${e instanceof Error ? e.message : 'try again'}`); });
    return () => { live = false; };
  }, [api]);

  async function run() {
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      await api.apply(plan, (d, t) => setProgress(`Working… ${d} of ${t}`));
      setDone(true);
    } catch (e) {
      setError(`It stopped part-way: ${e instanceof Error ? e.message : 'try again'}. Nothing was lost. It is safe to run it again: it picks up where it stopped.`);
    } finally {
      setBusy(false);
    }
  }

  const c = plan?.counts;
  if (done && c) {
    return (
      <Modal title="Club links upgraded" onClose={onDone}>
        <div className="adm-banner ok" role="status">
          {plural(c.clubs, 'club')} now {c.clubs === 1 ? 'has' : 'have'} one private link for all meets. {plural(c.ordersToCopy, 'saved order')} moved, {plural(c.linksToDelete, 'old link')} removed.
          The old per-meet links no longer work, so send each club its link again (Clubs &amp; Emails shows the current one).
        </div>
        <div className="adm-actions"><button className="btn primary" type="button" onClick={onDone}>Done</button></div>
      </Modal>
    );
  }
  return (
    <Modal title="Upgrade club links" onClose={() => { if (!busy) onClose(); }}>
      <p>
        Until now each club had a different private link for each meet. This gives every club <strong>one link for all its meets</strong>,
        with a meet switcher on the page. Each club keeps the link from its newest meet, its saved orders from every meet move
        to it, and the other old links are deleted (they stop working). Nothing else is deleted: the old order documents stay where they are.
      </p>
      {!plan && !error && <p role="status">Reading the club links…</p>}
      {c && (
        <ul className="oc-list" data-testid="upgrade-counts">
          <li>{plural(c.clubs, 'club')} across {plural(c.meets, 'meet')}</li>
          <li>{plural(c.oldLinks, 'old link')}: {plural(c.linksToDelete, 'link')} will be deleted, {plural(c.clubs, 'link')} kept as the club&rsquo;s one link</li>
          <li>{plural(c.ordersToCopy, 'saved order')} to move{c.ordersAlreadyThere > 0 ? `, ${plural(c.ordersAlreadyThere, 'order')} already moved` : ''}</li>
          <li>{plural(c.tokensReused, 'club')} already {c.tokensReused === 1 ? 'has' : 'have'} a link to keep, {plural(c.tokensNew, 'club')} will use the link from {c.tokensNew === 1 ? 'its' : 'their'} newest meet</li>
        </ul>
      )}
      {plan && plan.skipped.length > 0 && <div className="adm-banner warn" role="status">{plural(plan.skipped.length, 'old link')} belong to a meet that no longer exists and {plan.skipped.length === 1 ? 'is' : 'are'} left alone.</div>}
      {error && <div className="adm-banner err" role="alert">{error}</div>}
      <div className="adm-actions">
        <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" type="button" onClick={() => void run()} disabled={busy || !plan || c!.clubs === 0}>{busy ? (progress || 'Working…') : 'Upgrade club links'}</button>
      </div>
    </Modal>
  );
}
