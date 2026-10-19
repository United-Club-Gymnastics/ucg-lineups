import { useState } from 'react';
import { Field, Modal } from './ui';
import type { MeetInfo } from '../lib/data/meet-store';

type Dialog = null | 'new' | 'rename' | 'archive';

/** Meet dropdown plus New / Rename / Archive. Presentational: the page owns the data. */
export default function MeetSwitcher({ meets, selectedId, onSelect, onCreate, onRename, onArchive, onBringInData }: {
  /** Visible (not archived) meets, newest first. */
  meets: MeetInfo[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onArchive: () => Promise<void>;
  /** Given only when earlier (pre-meets) data still exists: shows "Bring in earlier data". */
  onBringInData?: () => void;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = meets.find((m) => m.id === selectedId);

  function open(d: Exclude<Dialog, null>) {
    setName(d === 'rename' ? current?.name ?? '' : '');
    setError('');
    setDialog(d);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await fn(); setDialog(null); } catch (e) { setError(e instanceof Error ? e.message : 'That did not work. Try again.'); } finally { setBusy(false); }
  }

  return (
    <div className="adm-meet">
      <div className="adm-meet-pick">
        <label htmlFor="meet-select">Meet</label>
        <select id="meet-select" value={selectedId} onChange={(e) => onSelect(e.target.value)}>
          {meets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      <div className="adm-meet-actions">
        <button className="btn ghost small" type="button" onClick={() => open('new')}>New meet</button>
        <button className="btn ghost small" type="button" onClick={() => open('rename')}>Rename</button>
        <button className="btn ghost small" type="button" onClick={() => open('archive')}>Archive</button>
        {onBringInData && <button className="btn ghost small" type="button" onClick={onBringInData}>Bring in earlier data</button>}
      </div>

      {(dialog === 'new' || dialog === 'rename') && (
        <Modal title={dialog === 'new' ? 'New meet' : 'Rename meet'} onClose={() => setDialog(null)}>
          <form onSubmit={(e) => { e.preventDefault(); void run(() => (dialog === 'new' ? onCreate(name) : onRename(name))); }}>
            <Field label="Meet name" hint={dialog === 'new' ? 'For example: NE Regionals 2027. It starts empty; other meets are not touched.' : undefined}>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            {error && <div className="adm-banner err" role="alert">{error}</div>}
            <div className="adm-actions">
              <button className="btn ghost" type="button" onClick={() => setDialog(null)}>Cancel</button>
              <button className="btn primary" type="submit" disabled={busy || !name.trim()}>{dialog === 'new' ? 'Create meet' : 'Save name'}</button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === 'archive' && (
        <Modal title="Archive this meet?" onClose={() => setDialog(null)}>
          <p>{current?.name} is hidden from the list. Nothing is deleted, and its club links keep working.</p>
          {error && <div className="adm-banner err" role="alert">{error}</div>}
          <div className="adm-actions">
            <button className="btn ghost" type="button" onClick={() => setDialog(null)}>Cancel</button>
            <button className="btn primary" type="button" disabled={busy} onClick={() => void run(onArchive)}>Archive meet</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Shown when there are no (unarchived) meets yet. */
export function FirstMeet({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try { await onCreate(name); } catch (e) { setError(e instanceof Error ? e.message : 'Could not create the meet.'); setBusy(false); }
  }
  return (
    <section className="adm-card">
      <h2 className="display">Create your first meet</h2>
      <p className="adm-muted">Each meet keeps its own athletes, clubs, squads and club links, so you can switch between meets without losing any work.</p>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Meet name">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {error && <div className="adm-banner err" role="alert">{error}</div>}
        <div className="adm-actions">
          <button className="btn primary" type="submit" disabled={busy || !name.trim()}>Create meet</button>
        </div>
      </form>
    </section>
  );
}
