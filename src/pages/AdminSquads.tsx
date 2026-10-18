import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../lib/firebase';
import { Modal } from '../components/ui';
import { SquadBoard } from '../components/SquadBoard';
import { Autosaver, type SaveState } from '../lib/autosave';
import { loadSquadDoc, loadSquadsInput, saveSquadDoc, type SquadsInput } from '../lib/data/squad-store';
import {
  ROTATION_PATTERNS, firstApparatus, routinesPerRotation, squadCountFor, squadLetter,
  type ArtisticDiscipline, type RotationPattern,
} from '../lib/rotation';
import { autoBalance, capacityGuide, clearPlan, emptyPlan, moveCard, placedKeys, planStats, swapSquads, type SquadCard, type SquadPlan } from '../lib/squad-balance';
import { restoreSquads, type RestoreChange, type Restored } from '../lib/squad-restore';
import { squadRoutineCap } from '../lib/squad-builder';
import {
  EMPTY_SCHEDULE, buildSessionData, isArtisticSession, sessionTitle, sortSessionsByGym, toStoredSquadDoc,
  type ArtisticSession, type Schedule, type SquadSessionData, type StoredSquadDoc,
} from '../lib/squad-data';
import './squads.css';

type Loaded = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; input: SquadsInput };
type StoredDoc = StoredSquadDoc | null;

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

const patternLabel = (p: RotationPattern, d: ArtisticDiscipline): string => {
  const one = squadCountFor('one', d);
  const two = squadCountFor('parallel', d);
  if (p === 'one') return `One flight · ${one} squads`;
  if (p === 'parallel') return `Two flights, A/B equipment · ${two}`;
  return `Two flights with byes (2024) · ${two}`;
};

export default function AdminSquads() {
  const [load, setLoad] = useState<Loaded>({ kind: 'loading' });
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const saver = useRef<Autosaver<StoredSquadDoc> | null>(null);
  if (saver.current === null) saver.current = new Autosaver<StoredSquadDoc>((sessionId, value) => saveSquadDoc(db, sessionId, value), setSave);

  const fetchInput = useCallback(() => {
    loadSquadsInput(db)
      .then((input) => setLoad({ kind: 'ready', input }))
      .catch((e) => setLoad({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load squads data.' }));
  }, []);
  useEffect(() => { fetchInput(); }, [fetchInput]);
  const refresh = () => {
    setLoad({ kind: 'loading' });
    void saver.current!.flush().finally(fetchInput); // write pending changes first so the reload sees them
  };

  useEffect(() => {
    const s = saver.current!;
    const flush = () => { void s.flush(); };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    const onUnload = (e: BeforeUnloadEvent) => { if (s.hasPending) { flush(); e.preventDefault(); } };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
      flush();
    };
  }, []);

  if (load.kind === 'loading') return <section className="adm-card"><p role="status">Loading sessions, athletes and club groups…</p></section>;
  if (load.kind === 'error') {
    return (
      <section className="adm-card">
        <div className="adm-banner err" role="alert">{load.message}</div>
        <button type="button" className="btn" onClick={refresh}>Try again</button>
      </section>
    );
  }
  return <SquadsScreen input={load.input} save={save} onRetry={() => void saver.current!.flush()} onReload={refresh} schedule={(id, doc) => saver.current!.schedule(id, doc)} />;
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.kind === 'error') {
    return (
      <div className="adm-banner err" role="alert">
        Your last change did not save: {state.message} Your changes are still on this page.{' '}
        <button type="button" className="btn small" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  let text = 'Changes save automatically';
  if (state.kind === 'saving') text = 'Saving…';
  if (state.kind === 'saved') text = `Saved · ${timeFmt.format(state.at)}`;
  return <p className="sq-save" role="status" aria-live="polite" data-testid="squads-save">{text}</p>;
}

function SquadsScreen({ input, save, onRetry, onReload, schedule }: {
  input: SquadsInput;
  save: SaveState;
  onRetry: () => void;
  onReload: () => void;
  schedule: (sessionId: string, doc: StoredSquadDoc) => void;
}) {
  const sessions = useMemo(() => sortSessionsByGym(input.sessions.filter(isArtisticSession), input.gymOrder), [input]);
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? '');
  const session = sessions.find((s) => s.id === sessionId);
  const [docs, setDocs] = useState<Record<string, StoredDoc>>({});
  const [docError, setDocError] = useState('');
  const hasDoc = sessionId in docs;

  useEffect(() => {
    if (!sessionId || hasDoc) return;
    let cancelled = false;
    loadSquadDoc(db, sessionId)
      .then((d) => { if (!cancelled) setDocs((prev) => ({ ...prev, [sessionId]: d })); })
      .catch((e) => { if (!cancelled) setDocError(e instanceof Error ? e.message : 'Could not load the saved squads.'); });
    return () => { cancelled = true; };
  }, [sessionId, hasDoc]);

  // Keep the loaded copy current so switching sessions and back never shows an older plan.
  const remember = (id: string, doc: StoredSquadDoc) => {
    setDocs((prev) => ({ ...prev, [id]: doc }));
    schedule(id, doc);
  };

  if (sessions.length === 0) {
    return (
      <section className="adm-card">
        <h2 className="display">Squads</h2>
        <p className="adm-muted">No MAG or WAG sessions yet. Import the registrations first.</p>
      </section>
    );
  }

  return (
    <div className="sq">
      <section className="adm-card sq-pick">
        <div className="sq-pick-row">
          <label className="sq-field">
            <span>Session</span>
            <select value={sessionId} onChange={(e) => { setDocError(''); setSessionId(e.target.value); }}>
              {sessions.map((s) => <option key={s.id} value={s.id}>{sessionTitle(s)} ({s.discipline})</option>)}
            </select>
          </label>
          <button type="button" className="btn ghost small" onClick={onReload}>Reload data</button>
        </div>
        <SaveIndicator state={save} onRetry={onRetry} />
      </section>
      {docError && <div className="adm-banner err" role="alert">{docError}</div>}
      {session && hasDoc && (
        <SessionSquads key={session.id} session={session} input={input} stored={docs[session.id]} schedule={remember} />
      )}
      {session && !hasDoc && !docError && <p role="status">Loading saved squads…</p>}
    </div>
  );
}

type Confirm = { title: string; body: string; action: string; run: () => void } | null;

function SessionSquads({ session, input, stored, schedule: scheduleSave }: {
  session: ArtisticSession;
  input: SquadsInput;
  stored: StoredDoc;
  schedule: (sessionId: string, doc: StoredSquadDoc) => void;
}) {
  const discipline = session.discipline;
  const data: SquadSessionData = useMemo(() => buildSessionData(session, input.athletes, input.ordersByClub), [session, input]);
  const cap = squadRoutineCap(discipline);
  const ctx = useMemo(() => ({
    discipline, apparatusOf: (id: string) => data.athletes.get(id)?.apparatus ?? [],
    levelRank: data.levelRank, clubLabel: data.clubLabel, independentLabel: data.independentLabel,
  }), [discipline, data]);
  const levelName = (l: string) => data.levelNames.get(l) ?? l;

  // Start from what is saved. Saved cards hold athletes, so they are matched to the clubs' CURRENT groups; anything
  // that moved since is listed in `changes` (never silently).
  const [start] = useState(() => {
    if (!stored) return { cards: data.cards, plan: emptyPlan('one', discipline), changes: [] as RestoreChange[], movedCount: 0 };
    return restoreSquads({ stored, discipline, sessionRegs: data.regs, savedGroups: data.savedGroups, ctx, describe: data.describe, levelName });
  });
  const [cards, setCards] = useState<SquadCard[]>(start.cards);
  const [pattern, setPattern] = useState<RotationPattern>(stored?.pattern ?? 'one');
  const [plan, setPlan] = useState<SquadPlan>(start.plan);
  const [sched, setSched] = useState<Schedule>(stored?.schedule ?? EMPTY_SCHEDULE);
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [showChanges, setShowChanges] = useState(true);

  const commit = (p: RotationPattern, nextPlan: SquadPlan, nextCards: SquadCard[], nextSched: Schedule) => {
    setPattern(p);
    setPlan(nextPlan);
    setCards(nextCards);
    setSched(nextSched);
    scheduleSave(session.id, toStoredSquadDoc(p, nextPlan, nextCards, nextSched));
  };

  // Auto-balance works on whole club groups, so it also resets any group that had been split across places.
  const whole = data.cards;
  const balanceFor = (p: RotationPattern) => autoBalance({ ...ctx, cards: whole, pattern: p });
  const anyPlaced = placedKeys(plan).size > 0;
  const ask = (c: NonNullable<Confirm>, direct: boolean) => { if (direct) c.run(); else setConfirm(c); };

  const doBalance = () => {
    commit(pattern, balanceFor(pattern), whole, sched);
    setNotice('Squads balanced: biggest groups first, evening out the busiest apparatus.');
  };
  const doClear = () => {
    commit(pattern, clearPlan(plan), whole, sched);
    setNotice('All groups returned to the unplaced list.');
  };
  const requestPattern = (p: RotationPattern) => {
    if (p === pattern) return;
    const run = () => {
      commit(p, anyPlaced ? balanceFor(p) : emptyPlan(p, discipline), whole, sched);
      setNotice(anyPlaced ? 'Squads re-balanced for the new rotation pattern.' : '');
    };
    ask({
      title: 'Change the rotation pattern?',
      body: 'Squads are re-balanced for the new pattern, which replaces the groups you have placed.',
      action: 'Change and re-balance', run,
    }, !anyPlaced);
  };
  const onPlace = (key: string, to: number | null) => commit(pattern, moveCard(plan, key, to), cards, sched);
  const onSwap = (a: number, b: number) => {
    commit(pattern, swapSquads(plan, a, b), cards, sched);
    setNotice(`Swapped Squad ${squadLetter(a)} and Squad ${squadLetter(b)}. Their groups now start on ${firstApparatus(a, pattern, discipline)} and ${firstApparatus(b, pattern, discipline)}.`);
  };
  const setField = (k: keyof Schedule, v: string) => commit(pattern, plan, cards, { ...sched, [k]: v });

  const byKey = useMemo(() => new Map(cards.map((c) => [c.key, c])), [cards]);
  const stats = useMemo(() => planStats(plan, byKey, discipline, data.levelRank), [plan, byKey, discipline, data]);
  const guide = capacityGuide(data.athleteCount, pattern, discipline);
  const summary = routinesPerRotation(pattern, discipline, stats.map((s) => s.routines), cap);
  const gymDisc = `${discipline} · ${session.gym} Gym · ${session.levelCodes.map(levelName).join(', ')}`;

  return (
    <div className="sq-stack">
      <section className="adm-card" aria-label="Session summary">
        <div className="sq-head">
          <div className="sq-head-text">
            <h2 className="display">{sessionTitle(session)}</h2>
            <p className="adm-muted">
              {gymDisc} · {data.athleteCount} athletes · {data.stillAz} club{data.stillAz === 1 ? '' : 's'} still A–Z · {data.needSplit} need{data.needSplit === 1 ? 's' : ''} to decide a split
            </p>
          </div>
          <div className="sq-actions">
            <button
              type="button" className="btn primary" disabled={whole.length === 0}
              onClick={() => ask({ title: 'Auto-balance?', body: 'This replaces the groups you have placed.', action: 'Auto-balance', run: doBalance }, !anyPlaced)}
            >
              Auto-balance
            </button>
            <button
              type="button" className="btn ghost" disabled={!anyPlaced}
              onClick={() => ask({ title: 'Clear squads?', body: 'Every group goes back to the unplaced list.', action: 'Clear squads', run: doClear }, false)}
            >
              Clear squads
            </button>
          </div>
        </div>

        <div className="sq-row">
          <span className="sq-label" id="sq-pattern-label">Rotation</span>
          <div className="sq-seg" role="group" aria-labelledby="sq-pattern-label">
            {ROTATION_PATTERNS.map((p) => (
              <button key={p} type="button" aria-pressed={pattern === p} onClick={() => requestPattern(p)}>{patternLabel(p, discipline)}</button>
            ))}
          </div>
        </div>

        <div className="sq-row sq-sched">
          <label className="sq-field"><span>Open stretch</span><input type="text" value={sched.stretch} onChange={(e) => setField('stretch', e.target.value)} /></label>
          <label className="sq-field"><span>Timed warm-ups</span><input type="text" value={sched.warmups} onChange={(e) => setField('warmups', e.target.value)} /></label>
          <label className="sq-field"><span>Competition</span><input type="text" value={sched.competition} onChange={(e) => setField('competition', e.target.value)} /></label>
        </div>

        <div className={`adm-banner ${guide.tone === 'warn' ? 'warn' : 'ok'}`} role="status" data-testid="squads-capacity">{guide.text}</div>
        {start.movedCount > 0 && showChanges && <ChangesNotice restored={start} onDismiss={() => setShowChanges(false)} />}
        {notice && <p className="sq-notice" role="status" aria-live="polite">{notice}</p>}

        <details className="sq-how">
          <summary>How auto-balance places groups</summary>
          <ol>
            <li>Never more than {cap} on one apparatus in a squad, when it can be avoided.</li>
            <li>A club&rsquo;s groups stay together: the whole club in one squad if it fits. If not, each level goes in as a unit, then group by group, and later pieces join a squad that already has that club.</li>
            <li>Squads stay single-level where possible. Infinity is never put with another level (a manual mix is flagged, not blocked).</li>
            <li>Athletes on only 1 or 2 apparatus go in a squad that reaches their first apparatus as early as possible.</li>
            <li>Then the busiest apparatus is evened out across squads.</li>
          </ol>
        </details>
      </section>

      <RotationTable summary={summary} cap={cap} />

      {whole.length === 0 ? (
        <section className="adm-card"><p className="adm-muted">No athletes are entered in this session yet.</p></section>
      ) : (
        <SquadBoard discipline={discipline} pattern={pattern} plan={plan} cards={cards} data={data} onPlace={onPlace} onSwap={onSwap} />
      )}

      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p>{confirm.body}</p>
          <div className="adm-actions">
            <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => { const run = confirm.run; setConfirm(null); run(); }}>{confirm.action}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const CHANGE_TEXT: Record<RestoreChange['kind'], string> = {
  dropped: 'no longer in this club and level, or no longer competing; removed from Squad',
  added: 'new since you placed squads; in the unplaced list',
  regrouped: 'their club changed its groups; still in Squad',
};

function ChangesNotice({ restored, onDismiss }: { restored: Restored; onDismiss: () => void }) {
  const n = restored.movedCount;
  return (
    <div className="adm-banner warn" role="status" data-testid="squads-changes">
      <p className="sq-changes-title"><strong>{n} athlete{n === 1 ? '' : 's'} moved since you placed squads.</strong> Nothing else was changed.</p>
      <ul className="sq-changes">
        {restored.changes.map((c, i) => (
          <li key={i}>
            {c.clubLabel} · {c.levelName}: {c.names.join(', ')} ({CHANGE_TEXT[c.kind]}{c.kind === 'added' ? '' : ` ${c.squad ?? ''}`})
          </li>
        ))}
      </ul>
      <button type="button" className="btn small" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

function RotationTable({ summary, cap }: { summary: ReturnType<typeof routinesPerRotation>; cap: number }) {
  return (
    <section className="adm-card" aria-label="Routines per rotation">
      <div className="sq-tbl-head">
        <h3>Routines per rotation</h3>
        <span className="adm-muted">Each cell: the squad on that equipment that rotation and its routines on it. Over {cap} is highlighted.</span>
      </div>
      <div className="adm-tablewrap">
        <table className="adm-table sq-rotsum">
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Rotation</span></th>
              {summary.equipment.map((e) => <th key={e} scope="col" className="num">{e}</th>)}
              <th scope="col" className="num">Total</th>
              <th scope="col"><span className="sr-only">Byes</span></th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => (
              <tr key={r.rotation}>
                <th scope="row">Rotation {r.rotation}</th>
                {r.cells.map((c, i) => (
                  <td key={summary.equipment[i]} className={`num${c?.squads.some((s) => s.over) ? ' hot' : ''}${c ? '' : ' none'}`}>
                    {c ? c.squads.map((s) => (
                      <span key={s.index} className="sq-cellpart">
                        <span className={s.over ? 'over-n' : ''}>{s.count}</span>
                        <span className="sq-letter" aria-label={`squad ${s.letter}`}>{s.letter}</span>
                      </span>
                    )) : <span aria-label="nobody">–</span>}
                  </td>
                ))}
                <td className="num tot">{r.total}</td>
                <td className="sq-bye">{r.byes.length > 0 ? `Bye: ${r.byes.join(', ')}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

