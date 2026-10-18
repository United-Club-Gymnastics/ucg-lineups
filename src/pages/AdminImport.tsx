import { useCallback, useMemo, useState, type DragEvent } from 'react';
import { db } from '../lib/firebase';
import { Badge, Modal } from '../components/ui';
import { applyImport, loadStored, type StoredState } from '../lib/data/store';
import { planImport } from '../lib/data/plan';
import { assembleInput } from '../lib/import/assemble';
import { detectWorkbook, KIND_LABEL, type Detected } from '../lib/import/detect';
import { normalizeImport } from '../lib/import/normalize';
import { readWorkbook } from '../lib/import/read-workbook';
import type { Discipline } from '../lib/import/types';

interface LoadedFile {
  key: string;
  name: string;
  detected: Detected | null;
  error?: string;
}

const DISC_LABEL: Record<Discipline, string> = { WAG: 'WAG', MAG: 'MAG', TNT: 'T&T' };

export default function AdminImport() {
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [over, setOver] = useState(false);
  const [stored, setStored] = useState<StoredState | null>(null);
  const [storedError, setStoredError] = useState('');
  const [loadingStored, setLoadingStored] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const next: LoadedFile[] = [];
    for (const f of Array.from(list)) {
      const key = `${f.name}-${f.size}-${f.lastModified}`;
      try {
        const sheets = await readWorkbook(await f.arrayBuffer());
        next.push({ key, name: f.name, detected: detectWorkbook(sheets) });
      } catch {
        next.push({ key, name: f.name, detected: null, error: 'Could not read this file as .xlsx.' });
      }
    }
    setResult(null);
    setFiles((prev) => [...prev.filter((p) => !next.some((n) => n.key === p.key)), ...next]);
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void addFiles(e.dataTransfer.files);
  };

  const refreshStored = useCallback(async () => {
    setLoadingStored(true);
    setStoredError('');
    try {
      setStored(await loadStored(db));
    } catch (e) {
      setStored(null);
      setStoredError(e instanceof Error ? e.message : 'Could not read stored data.');
    } finally {
      setLoadingStored(false);
    }
  }, []);

  // Latest file of each kind wins.
  const usable = useMemo(() => {
    const byKind = new Map<string, Detected>();
    for (const f of files) if (f.detected) byKind.set(f.detected.kind, f.detected);
    return [...byKind.values()];
  }, [files]);

  const model = useMemo(() => {
    const input = assembleInput(usable);
    return input ? normalizeImport(input) : null;
  }, [usable]);

  const plan = useMemo(
    () => (model && stored ? planImport(model, stored) : null),
    [model, stored],
  );

  const perDiscipline = useMemo(() => {
    const rows = (['WAG', 'MAG', 'TNT'] as Discipline[]).map((d) => {
      const xs = model?.athletes.filter((a) => a.discipline === d) ?? [];
      return { d, total: xs.length, competing: xs.filter((a) => a.competes).length, sessions: model?.sessions.filter((s) => s.discipline === d).length ?? 0 };
    });
    return rows;
  }, [model]);

  async function apply() {
    if (!model || !stored) return;
    setApplying(true);
    try {
      const done = await applyImport(db, model, stored);
      setResult({
        ok: true,
        text: `Import applied: ${done.diff.added.length} added, ${done.diff.changed.length} changed, ${done.diff.removed.length} marked removed, ${done.newClubs} new club links.`,
      });
      setConfirm(false);
      await refreshStored();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Import failed.' });
      setConfirm(false);
    } finally {
      setApplying(false);
    }
  }

  const independents = model?.athletes.filter((a) => a.independent).length ?? 0;

  return (
    <>
      <section className="adm-card">
        <h2 className="display">Import</h2>
        <p className="adm-muted">
          Drop the ScoreFlippers exports here (Athletes, WAG, MAG, T&T and the club emails list). Each file is identified by
          its columns. Nothing is saved until you press Apply import.
        </p>
        <label
          className={`adm-drop${over ? ' over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <strong>Drop .xlsx files here</strong> or choose files
          <input type="file" accept=".xlsx" multiple onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
        </label>
        {files.length > 0 && (
          <ul className="adm-files">
            {files.map((f) => (
              <li key={f.key}>
                <span className="name">{f.name}</span>
                {f.detected
                  ? <Badge tone="ok">{KIND_LABEL[f.detected.kind]} · {f.detected.sheet.rows.length} rows</Badge>
                  : <Badge tone="err">{f.error ?? 'Not recognised'}</Badge>}
                <button className="btn ghost small" type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((p) => p.filter((x) => x.key !== f.key))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {files.length > 0 && !model && (
        <div className="adm-banner warn" role="status">Add the Athletes export. It is the list every other file is matched against.</div>
      )}

      {model && (
        <section className="adm-card" aria-label="Import preview">
          <h2 className="display">Preview</h2>
          <div className="adm-stats">
            <div className="adm-stat"><b>{model.athletes.length}</b>athletes</div>
            <div className="adm-stat"><b>{model.sessions.length}</b>sessions</div>
            <div className="adm-stat"><b>{model.clubs.length}</b>clubs</div>
            <div className="adm-stat"><b>{independents}</b>independent athletes</div>
            <div className="adm-stat"><b>{model.warnings.length}</b>warnings</div>
          </div>
          <div className="adm-tablewrap">
            <table className="adm-table">
              <caption className="adm-muted" style={{ textAlign: 'left' }}>Athletes by discipline</caption>
              <thead><tr><th scope="col">Discipline</th><th scope="col" className="num">Athletes</th><th scope="col" className="num">Competing</th><th scope="col" className="num">Sessions</th></tr></thead>
              <tbody>
                {perDiscipline.map((r) => (
                  <tr key={r.d}><th scope="row">{DISC_LABEL[r.d]}</th><td className="num">{r.total}</td><td className="num">{r.competing}</td><td className="num">{r.sessions}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          {model.warnings.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary><strong>{model.warnings.length} warnings</strong> (review before applying)</summary>
              <ul className="adm-warnings">
                {model.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
              </ul>
            </details>
          )}

          <h3>Compared with what is stored</h3>
          {!stored && (
            <div className="adm-actions" style={{ marginTop: 0 }}>
              <button className="btn" type="button" onClick={() => void refreshStored()} disabled={loadingStored}>
                {loadingStored ? 'Loading…' : 'Load stored data to compare'}
              </button>
            </div>
          )}
          {storedError && <div className="adm-banner err" role="alert">Could not read stored data: {storedError}</div>}
          {plan && (
            <div className="adm-stats">
              <div className="adm-stat"><b>{plan.diff.added.length}</b>added</div>
              <div className="adm-stat"><b>{plan.diff.changed.length}</b>changed</div>
              <div className="adm-stat"><b>{plan.diff.removed.length}</b>removed</div>
              <div className="adm-stat"><b>{plan.diff.unchanged.length}</b>unchanged</div>
              <div className="adm-stat"><b>{plan.newClubs}</b>new clubs</div>
            </div>
          )}
          {plan && plan.diff.removed.length > 0 && (
            <div className="adm-banner warn" role="status">
              {plan.diff.removed.length} stored athletes are not in this import. They are marked removed, not deleted.
            </div>
          )}

          <div className="adm-actions">
            <button className="btn primary" type="button" disabled={!plan || applying} onClick={() => setConfirm(true)}>
              Apply import
            </button>
            {!plan && <span className="adm-muted">Load the stored data first so the changes can be checked.</span>}
          </div>
        </section>
      )}

      {result && <div className={`adm-banner ${result.ok ? 'ok' : 'err'}`} role={result.ok ? 'status' : 'alert'}>{result.text}</div>}

      {confirm && plan && (
        <Modal title="Apply this import?" onClose={() => setConfirm(false)}>
          <p>
            {plan.diff.added.length} added, {plan.diff.changed.length} changed, {plan.diff.removed.length} marked removed,
            {' '}{plan.newClubs} new clubs. Saved orders and squads are kept.
          </p>
          <div className="adm-actions">
            <button className="btn ghost" type="button" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn primary" type="button" disabled={applying} onClick={() => void apply()}>
              {applying ? 'Applying…' : 'Apply import'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
