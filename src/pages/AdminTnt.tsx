import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Select from '../components/Select';
import { db } from '../lib/firebase';
import { Badge, Modal } from '../components/ui';
import { ReorderLists } from '../components/ReorderLists';
import { SaveIndicator } from '../components/SaveIndicator';
import { TntSquadBoard } from '../components/TntSquadBoard';
import { Autosaver, type SaveState } from '../lib/autosave';
import { loadTntDoc, loadTntInput, saveTntDoc, type TntInput } from '../lib/data/tnt-store';
import { fetchSynchroPairs, type SynchroPair } from '../lib/synchro-source';
import { saveSynchroAssignment } from '../lib/data/synchro-store';
import {
  assignPair, defaultFlights, flightName, mergeFlights, movePair, pairClubs, pairNames, pairsInSession, pairsNeedingSession, placePairs,
  type Flight, type PlacedPair, type RosterPerson, type SynchroAssignments,
} from '../lib/synchro-flights';
import type { Session } from '../lib/import/types';
import { sessionTitle, sortSessionsByGym } from '../lib/squad-data';
import { buildTntRoster, buildTntSessionData, isTntSession, toStoredTntDoc, type StoredTntDoc } from '../lib/tnt-data';
import {
  TNT_CAP, TNT_EVENT_NAME, TNT_EVENTS, TNT_SQUAD_COUNT, TNT_USUAL, autoBalance, fullName, moveAthlete, normalizeOrders, orderFor, orderKey,
  restoreTntSquads, rotationFor, squadLetter, type TntEvent, type TntRestored,
} from '../lib/tnt-squads';
import './squads.css';
import './tnt.css';

type Loaded = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; input: TntInput };
type StoredDoc = StoredTntDoc | null;

const whenFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function AdminTnt({ meetId }: { meetId: string }) {
  const [load, setLoad] = useState<Loaded>({ kind: 'loading' });
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const saver = useRef<Autosaver<StoredTntDoc> | null>(null);
  if (saver.current === null) saver.current = new Autosaver<StoredTntDoc>((sessionId, value) => saveTntDoc(db, meetId, sessionId, value), setSave);

  const fetchInput = useCallback(() => {
    loadTntInput(db, meetId)
      .then((input) => setLoad({ kind: 'ready', input }))
      .catch((e) => setLoad({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load T&T data.' }));
  }, [meetId]);
  useEffect(() => { fetchInput(); }, [fetchInput]);
  const refresh = () => {
    setLoad({ kind: 'loading' });
    void saver.current!.flush().finally(fetchInput);
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

  if (load.kind === 'loading') return <section className="adm-card"><p role="status">Loading sessions and athletes…</p></section>;
  if (load.kind === 'error') {
    return (
      <section className="adm-card">
        <div className="adm-banner err" role="alert">{load.message}</div>
        <button type="button" className="btn" onClick={refresh}>Try again</button>
      </section>
    );
  }
  return <TntScreen meetId={meetId} input={load.input} save={save} onRetry={() => void saver.current!.flush()} onReload={refresh} schedule={(id, doc) => saver.current!.schedule(id, doc)} />;
}

function TntScreen({ meetId, input, save, onRetry, onReload, schedule }: {
  meetId: string;
  input: TntInput;
  save: SaveState;
  onRetry: () => void;
  onReload: () => void;
  schedule: (sessionId: string, doc: StoredTntDoc) => void;
}) {
  const sessions = useMemo(() => sortSessionsByGym(input.sessions.filter(isTntSession), input.gymOrder), [input]);
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? '');
  const session = sessions.find((s) => s.id === sessionId);
  const roster = useMemo(() => buildTntRoster(input.athletes), [input]);
  const [assignments, setAssignments] = useState<SynchroAssignments>(input.assignments);
  const assignRef = useRef(assignments);
  const [assignError, setAssignError] = useState('');
  /** Store the host's session choice for a pair (`meets/{id}/synchroSessions/main`). */
  const assign = (pairId: string, toSessionId: string) => {
    const next = assignPair(assignRef.current, pairId, toSessionId);
    assignRef.current = next;
    setAssignments(next);
    setAssignError('');
    saveSynchroAssignment(db, meetId, pairId, toSessionId).catch((e) => setAssignError(e instanceof Error ? e.message : 'Could not save the session choice.'));
  };
  const [docs, setDocs] = useState<Record<string, StoredDoc>>({});
  const [docError, setDocError] = useState('');
  const hasDoc = sessionId in docs;

  useEffect(() => {
    if (!sessionId || hasDoc) return;
    let cancelled = false;
    loadTntDoc(db, meetId, sessionId)
      .then((d) => { if (!cancelled) setDocs((prev) => ({ ...prev, [sessionId]: d })); })
      .catch((e) => { if (!cancelled) setDocError(e instanceof Error ? e.message : 'Could not load the saved squads.'); });
    return () => { cancelled = true; };
  }, [meetId, sessionId, hasDoc]);

  // Keep the loaded copy current so switching sessions and back never shows an older plan.
  const remember = (id: string, doc: StoredTntDoc) => {
    setDocs((prev) => ({ ...prev, [id]: doc }));
    schedule(id, doc);
  };

  if (sessions.length === 0) {
    return (
      <section className="adm-card">
        <h2 className="display">T&amp;T</h2>
        <p className="adm-muted">No T&amp;T sessions yet. Import the registrations first.</p>
      </section>
    );
  }

  return (
    <div className="sq tnt">
      <section className="adm-card sq-pick">
        <div className="sq-pick-row">
          <label className="sq-field">
            <span>Session</span>
            <Select aria-label="Session" value={sessionId} onChange={(v) => { setDocError(''); setSessionId(v); }} options={sessions.map((s) => ({ value: s.id, label: `${sessionTitle(s)} (T&T)` }))} />
          </label>
          <button type="button" className="btn ghost small" onClick={onReload}>Reload data</button>
        </div>
        <SaveIndicator state={save} onRetry={onRetry} />
      </section>
      {docError && <div className="adm-banner err" role="alert">{docError}</div>}
      {assignError && <div className="adm-banner err" role="alert">Could not save the synchro session choice: {assignError} Try again.</div>}
      {session && hasDoc && (
        <TntSession
          key={session.id} session={session} sessions={sessions} input={input} stored={docs[session.id]} schedule={remember}
          roster={roster} assignments={assignments} onAssign={assign}
        />
      )}
      {session && !hasDoc && !docError && <p role="status">Loading saved squads…</p>}
    </div>
  );
}

type Confirm = { title: string; body: string; action: string; run: () => void } | null;
type PairsState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; raw: SynchroPair[]; at: Date };

interface Snapshot {
  squads: string[][];
  orders: Record<string, string[]>;
  flights: Flight[];
  readAt: Date | null;
}

function TntSession({ session, sessions, input, stored, schedule: scheduleSave, roster, assignments, onAssign }: {
  session: Session;
  /** Every T&T session (the choices for "Move to session"). */
  sessions: Session[];
  roster: RosterPerson[];
  assignments: SynchroAssignments;
  onAssign: (pairId: string, sessionId: string) => void;
  input: TntInput;
  stored: StoredDoc;
  schedule: (sessionId: string, doc: StoredTntDoc) => void;
}) {
  const data = useMemo(() => buildTntSessionData(session, input.athletes), [session, input]);
  const eligibleIds = useMemo(() => data.squadAthletes.map((a) => a.id), [data]);

  // Start from what is saved; whoever left or joined since is listed in the notice (never silently).
  const [start] = useState<TntRestored>(() => restoreTntSquads({ stored, eligible: data.squadAthletes, describe: data.describe }));
  const [state, setState] = useState<Snapshot>(() => ({
    squads: start.squads,
    orders: stored ? normalizeOrders(start.squads, stored.orders, data.byId) : {},
    flights: stored?.flights ?? [],
    readAt: stored?.pairsReadAt ?? null,
  }));
  const cur = useRef(state);
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [showChanges, setShowChanges] = useState(true);
  const [sq, setSq] = useState(0);
  const [ev, setEv] = useState<TntEvent>('TR');

  const trayOf = (squads: string[][]) => { const placed = new Set(squads.flat()); return eligibleIds.filter((id) => !placed.has(id)); };
  const commit = (patch: Partial<Snapshot>) => {
    const next = { ...cur.current, ...patch };
    next.orders = normalizeOrders(next.squads, next.orders, data.byId);
    cur.current = next;
    setState(next);
    scheduleSave(session.id, toStoredTntDoc({ squads: next.squads, tray: trayOf(next.squads), orders: next.orders, flights: next.flights, pairsReadAt: next.readAt }));
  };
  const { squads, orders, flights } = state;
  const tray = trayOf(squads);
  const anyPlaced = squads.some((s) => s.length > 0);
  const ask = (c: NonNullable<Confirm>, direct: boolean) => { if (direct) c.run(); else setConfirm(c); };

  // ---- squads ----
  const doBalance = () => {
    commit({ squads: autoBalance(data.squadAthletes), orders: {} });
    setNotice('Squads balanced: clubs together, then levels, then even sizes. Competing orders are back to the default.');
  };
  const doClear = () => { commit({ squads: Array.from({ length: TNT_SQUAD_COUNT }, () => []), orders: {} }); setNotice('Everyone is back in the unplaced list.'); };
  const onMove = (id: string, to: number | null) => {
    commit({ squads: moveAthlete(squads, id, to) });
    const a = data.byId.get(id);
    setNotice(`${a ? fullName(a) : 'Athlete'} ${to === null ? 'is unplaced' : `moved to Squad ${squadLetter(to)}`}.`);
  };

  // ---- competing order ----
  const key = orderKey(sq, ev);
  const order = useMemo(() => orderFor(squads[sq] ?? [], ev, orders[key], data.byId), [squads, sq, ev, orders, key, data]);
  const customOrder = !!orders[key];
  const nameOf = (id: string) => { const a = data.byId.get(id); return a ? fullName(a) : id; };

  // ---- synchro pairs ----
  const [pairsState, setPairsState] = useState<PairsState>({ kind: 'loading' });
  const [pairsError, setPairsError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);
  useEffect(() => {
    let cancelled = false;
    fetchSynchroPairs()
      .then((raw) => { if (!cancelled) setPairsState({ kind: 'ready', raw, at: new Date() }); })
      .catch((e) => { if (!cancelled) setPairsState({ kind: 'error', message: e instanceof Error ? e.message : 'Could not read the Synchro tool.' }); });
    return () => { cancelled = true; };
  }, []);

  /** Every pair, with its session (the host's choice, else the session both athletes are in). */
  const placed = useMemo(
    () => (pairsState.kind === 'ready' ? placePairs(pairsState.raw, roster, assignments, sessionIds) : []),
    [pairsState, roster, assignments, sessionIds],
  );
  const pairs = useMemo(() => pairsInSession(placed, session.id), [placed, session.id]);
  const needing = useMemo(() => pairsNeedingSession(placed), [placed]);
  const pairById = useMemo(() => new Map(pairs.map((p) => [p.id, p])), [pairs]);
  const savedFlights = flights.length > 0;
  const shown: Flight[] = useMemo(
    () => (savedFlights ? flights : pairsState.kind === 'ready' ? defaultFlights(pairs) : []).map((f) => ({ name: f.name, pairIds: f.pairIds.filter((id) => pairById.has(id)) })),
    [savedFlights, flights, pairsState.kind, pairs, pairById],
  );
  const stale = useMemo(() => (savedFlights && pairsState.kind === 'ready' ? mergeFlights(flights, pairs) : null), [savedFlights, flights, pairsState.kind, pairs]);
  const readAt = state.readAt ?? (pairsState.kind === 'ready' ? pairsState.at : null);

  /** Pairs saved in a flight but no longer in this session stay in the saved data until the next refresh. */
  const withHidden = (next: Flight[]): Flight[] => next.map((f, i) => ({
    name: f.name,
    pairIds: [...f.pairIds, ...(flights[i]?.pairIds ?? []).filter((id) => !pairById.has(id))],
  }));
  const setFlights = (next: Flight[]) => commit({ flights: withHidden(next), readAt: cur.current.readAt ?? readAt });

  const sessionName = (id: string | null) => { const s = sessions.find((x) => x.id === id); return s ? sessionTitle(s) : 'no session'; };
  /** The host chooses a session for a pair. The choice is stored; this session's flights follow it straight away. */
  const moveToSession = (id: string, to: string) => {
    onAssign(id, to);
    if (to === session.id) {
      if (savedFlights) {
        const mine = pairsInSession(placed.map((p) => (p.id === id ? { ...p, sessionId: to } : p)), session.id);
        commit({ flights: mergeFlights(cur.current.flights, mine).flights, readAt: cur.current.readAt ?? readAt });
      }
      setNotice(`${pairNames(placed.find((p) => p.id === id)!)} added to ${sessionName(to)}.`);
    } else {
      if (savedFlights) commit({ flights: cur.current.flights.map((f) => ({ name: f.name, pairIds: f.pairIds.filter((x) => x !== id) })) });
      setNotice(`${pairNames(placed.find((p) => p.id === id)!)} moved to ${sessionName(to)}.`);
    }
  };

  const doRefresh = async () => {
    setRefreshing(true);
    setPairsError('');
    try {
      const raw = await fetchSynchroPairs();
      // The session choices are not touched: Refresh pairs keeps them.
      const fresh = pairsInSession(placePairs(raw, roster, assignments, sessionIds), session.id);
      const first = cur.current.flights.length === 0;
      const merged = mergeFlights(cur.current.flights, fresh);
      const at = new Date();
      setPairsState({ kind: 'ready', raw, at });
      commit({ flights: merged.flights, readAt: at });
      setNotice(
        first
          ? `Read ${fresh.length} pair${fresh.length === 1 ? '' : 's'} from the Synchro tool.`
          : `Pairs refreshed: ${merged.added.length} added, ${merged.removed.length} removed, the rest kept in their order.`,
      );
    } catch (e) {
      setPairsError(e instanceof Error ? e.message : 'Could not read the Synchro tool.');
    } finally {
      setRefreshing(false);
    }
  };
  const flightLists = shown.map((f, i) => ({ id: `flight-${i}`, label: `Flight ${f.name}`, ids: f.pairIds }));

  const nPairs = shown.reduce((t, f) => t + f.pairIds.length, 0);
  const pairCount = pairsState.kind === 'ready' ? `${nPairs} synchro pair${nPairs === 1 ? '' : 's'}` : pairsState.kind === 'error' ? 'synchro pairs not read' : 'reading synchro pairs…';
  const checkCount = pairs.filter((p) => p.check).length;
  const sessionSelect = (p: PlacedPair, blank: boolean) => (
    <label className="sq-place">
      <span className="sr-only">Move to session for {pairNames(p)}</span>
      <Select
        size="sm" value={p.sessionId ?? ''} aria-label={`Move to session for ${pairNames(p)}`} onChange={(v) => v && moveToSession(p.id, v)}
        options={[...(blank ? [{ value: '', label: 'Choose a session…' }] : []), ...sessions.map((s) => ({ value: s.id, label: sessionTitle(s) }))]}
      />
    </label>
  );

  return (
    <div className="sq-stack">
      <section className="adm-card" aria-label="Session summary">
        <div className="sq-head">
          <div className="sq-head-text">
            <h2 className="display">{sessionTitle(session)}</h2>
            <p className="adm-muted">
              T&amp;T · {session.gym} Gym · {data.squadAthletes.length} athlete{data.squadAthletes.length === 1 ? '' : 's'} in squads · {data.synchroOnly.length} synchro only · {pairCount}
            </p>
          </div>
          <div className="sq-actions">
            <button
              type="button" className="btn primary" disabled={data.squadAthletes.length === 0}
              onClick={() => ask({ title: 'Auto-balance?', body: 'This replaces the squads you have set and puts every competing order back to the default.', action: 'Auto-balance', run: doBalance }, !anyPlaced)}
            >
              Auto-balance
            </button>
            <button
              type="button" className="btn ghost" disabled={!anyPlaced}
              onClick={() => ask({ title: 'Clear squads?', body: 'Every athlete goes back to the unplaced list and the competing orders are reset.', action: 'Clear squads', run: doClear }, false)}
            >
              Clear squads
            </button>
          </div>
        </div>
        <div className="adm-banner ok" role="status">
          Clubs do not set T&amp;T order. UCG builds the squads and the order. Squads usually hold {TNT_USUAL[0]}–{TNT_USUAL[1]} athletes, at most {TNT_CAP}.
        </div>
        {start.movedCount > 0 && showChanges && <ChangesNotice restored={start} onDismiss={() => setShowChanges(false)} />}
        {notice && <p className="sq-notice" role="status" aria-live="polite">{notice}</p>}
        <details className="sq-how">
          <summary>How auto-balance places athletes</summary>
          <ol>
            <li>Never more than {TNT_CAP} in a squad, when it can be avoided.</li>
            <li>A club&rsquo;s athletes stay together. A club with more than {TNT_CAP} is split by level, and its pieces stay as close together as possible.</li>
            <li>Levels stay together, using each athlete&rsquo;s most common level across Trampoline, Double Mini and Tumbling (a tie goes to the higher level).</li>
            <li>Then squad sizes are evened out.</li>
            <li>Athletes entered only in synchro are not put in a squad. They compete in the synchro flights. Independent athletes are placed one at a time.</li>
          </ol>
        </details>
      </section>

      {data.squadAthletes.length === 0 ? (
        <section className="adm-card"><p className="adm-muted">No athletes are entered on Trampoline, Double Mini or Tumbling in this session.</p></section>
      ) : (
        <TntSquadBoard squads={squads} tray={tray} byId={data.byId} onMove={onMove} />
      )}

      {data.synchroOnly.length > 0 && (
        <section className="adm-card" aria-label="Synchro only">
          <h3 className="tnt-h3">Synchro only (not in a squad)</h3>
          <p className="adm-muted">{data.synchroOnly.map((a) => `${fullName(a)} (${a.clubName})`).join(', ')}</p>
        </section>
      )}

      <section className="adm-card" aria-label="Competing order">
        <div className="tnt-h">
          <h2 className="display">Competing order</h2>
          <button type="button" className="btn small" disabled={!customOrder} onClick={() => { const { [key]: _drop, ...rest } = orders; void _drop; commit({ orders: rest }); setNotice('Order reset to the default.'); }}>
            Reset to default
          </button>
        </div>
        <div className="sq-row">
          <div className="sq-seg" role="group" aria-label="Squad">
            {Array.from({ length: TNT_SQUAD_COUNT }, (_, s) => (
              <button key={s} type="button" aria-pressed={sq === s} onClick={() => setSq(s)}>Squad {squadLetter(s)}</button>
            ))}
          </div>
          <div className="sq-seg" role="group" aria-label="Event">
            {TNT_EVENTS.map((e) => <button key={e} type="button" aria-pressed={ev === e} onClick={() => setEv(e)}>{TNT_EVENT_NAME[e]}</button>)}
          </div>
        </div>
        <p className="adm-muted">
          Squad {squadLetter(sq)} · {rotationFor(sq).map((c) => TNT_EVENT_NAME[c]).join(' → ')}. {TNT_EVENT_NAME[ev]}: only athletes entered on this event.
          Default is High Flyers, Intermediate, New, then club A–Z, then first name. Drag to reorder; a heavy rule marks where the level changes.
          {customOrder ? ' This order has been changed.' : ''}
        </p>
        <ReorderLists
          ariaLabel={`${TNT_EVENT_NAME[ev]}, Squad ${squadLetter(sq)}`}
          lists={[{ id: key, label: `${TNT_EVENT_NAME[ev]}, Squad ${squadLetter(sq)}`, ids: order }]}
          nameOf={nameOf}
          emptyText={squads[sq]?.length ? 'Nobody in this squad is entered on this event.' : 'No athletes in this squad yet.'}
          breakBefore={(id, prev) => data.byId.get(id)?.levels[ev] !== data.byId.get(prev)?.levels[ev]}
          renderRow={(id) => {
            const a = data.byId.get(id);
            if (!a) return null;
            return (
              <>
                <span className="tnt-who"><b>{fullName(a)}</b><span className="tnt-club">{a.clubName}</span></span>
                <span className="tnt-chip lvl"><b>{ev}</b> {a.levels[ev]}</span>
              </>
            );
          }}
          onChange={(next) => commit({ orders: { ...orders, [key]: next[0] } })}
        />
      </section>

      <section className="adm-card" aria-label="Synchro flights">
        <div className="tnt-h">
          <h2 className="display">Synchro flights</h2>
          <div className="sq-actions">
            <button type="button" className="btn" disabled={refreshing} onClick={() => void doRefresh()}>{refreshing ? 'Reading…' : 'Refresh pairs'}</button>
            <button type="button" className="btn ghost" disabled={pairsState.kind !== 'ready'} onClick={() => setFlights([...shown, { name: flightName(shown.length), pairIds: [] }])}>Add a flight</button>
            <button
              type="button" className="btn ghost" disabled={pairsState.kind !== 'ready' || pairs.length === 0}
              onClick={() => ask({ title: 'Reset flights?', body: 'Pairs go back to the default: High Flyers, Intermediate, New, then club, split evenly into two flights. Your order and moves are lost.', action: 'Reset flights', run: () => { commit({ flights: defaultFlights(pairs) }); setNotice('Flights reset to the default.'); } }, false)}
            >
              Reset flights
            </button>
          </div>
        </div>
        <p className="adm-muted">
          Pairs are read from the Synchro tool and matched to the T&amp;T athletes by club and name. A pair competes in the session both athletes are in; use Move to session to put it somewhere else.
          {readAt ? ` Last read ${whenFmt.format(readAt)}${savedFlights ? '' : ' (flights are not saved until you change something or refresh)'}.` : ''}
        </p>
        {pairsState.kind === 'ready' && needing.length > 0 && (
          <div className="tnt-needs" data-testid="needs-session">
            <h3 className="tnt-h3">Needs a session</h3>
            <p className="adm-muted">
              {needing.length} pair{needing.length === 1 ? '' : 's'} can&rsquo;t be placed on their own. They are not on any sheet until you choose a session.
            </p>
            <ul className="tnt-needs-list">
              {needing.map((p) => (
                <li key={p.id}>
                  <span className="tnt-who">
                    <b>{pairNames(p)}</b>
                    <span className="tnt-club">{pairClubs(p)}</span>
                    {p.unassignedReason === 'different-sessions' && (
                      <span className="tnt-why">{p.name1} is in {sessionName(p.athleteSessions[0])}; {p.name2} is in {sessionName(p.athleteSessions[1])}.</span>
                    )}
                    {p.check && <span className="tnt-check"><Badge tone="warn">Check pair</Badge> <span className="tnt-why">{p.problems.join('; ')}</span></span>}
                  </span>
                  <span className="tnt-ctl">
                    <span className="tnt-chip lvl">{p.level}</span>
                    {sessionSelect(p, true)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {pairsState.kind === 'loading' && <p role="status">Reading pairs from the Synchro tool…</p>}
        {pairsState.kind === 'error' && (
          <div className="adm-banner err" role="alert">
            Could not read the Synchro tool: {pairsState.message} Your saved flights are untouched.{' '}
            <button type="button" className="btn small" onClick={() => void doRefresh()}>Try again</button>
          </div>
        )}
        {pairsError && <div className="adm-banner err" role="alert">Could not refresh: {pairsError} Your saved flights are untouched.</div>}
        {stale && (stale.added.length > 0 || stale.removed.length > 0) && (
          <div className="adm-banner warn" role="status" data-testid="synchro-stale">
            The Synchro tool has changed since flights were last refreshed: {stale.added.length} new pair{stale.added.length === 1 ? '' : 's'}, {stale.removed.length} deleted or moved to another session.
            New pairs are not shown until you press Refresh pairs.
          </div>
        )}
        {checkCount > 0 && (
          <div className="adm-banner warn" role="status">
            {checkCount} pair{checkCount === 1 ? '' : 's'} flagged &ldquo;Check pair&rdquo;: an athlete could not be matched to this import, or is on the roster but not entered in synchro. They are still shown with the names from the Synchro tool.
          </div>
        )}
        {pairsState.kind === 'ready' && pairs.length === 0 && <p className="adm-muted">No synchro pairs for this session yet.</p>}
        {pairsState.kind === 'ready' && pairs.length > 0 && (
          <ReorderLists
            ariaLabel="Synchro flights"
            lists={flightLists}
            nameOf={(id) => { const p = pairById.get(id); return p ? pairNames(p) : id; }}
            emptyText="Drag pairs here"
            breakBefore={(id, prev) => pairById.get(id)?.level !== pairById.get(prev)?.level}
            renderHeader={(i) => (
              <div className="tnt-flight-h">
                <h3 className="display">Flight {shown[i].name}</h3>
                <span className="adm-muted">{shown[i].pairIds.length} pair{shown[i].pairIds.length === 1 ? '' : 's'}</span>
                {shown[i].pairIds.length === 0 && shown.length > 1 && (
                  <button type="button" className="btn small ghost" onClick={() => setFlights(shown.filter((_, j) => j !== i).map((f, j) => ({ ...f, name: flightName(j) })))}>
                    Remove flight {shown[i].name}
                  </button>
                )}
              </div>
            )}
            renderRow={(id, listIndex) => {
              const p = pairById.get(id);
              if (!p) return null;
              return (
                <>
                  <span className="tnt-who">
                    <b>{pairNames(p)}</b>
                    <span className="tnt-club">{pairClubs(p)}</span>
                    {p.check && <span className="tnt-check"><Badge tone="warn">Check pair</Badge> <span className="tnt-why">{p.problems.join('; ')}</span></span>}
                  </span>
                  <span className="tnt-ctl">
                    <span className="tnt-chip lvl">{p.level}</span>
                    {sessionSelect(p, false)}
                    <label className="sq-place">
                      <span className="sr-only">Flight for {pairNames(p)}</span>
                      <Select
                        size="sm" value={String(listIndex)} aria-label={`Flight for ${pairNames(p)}`}
                        onChange={(v) => setFlights(movePair(shown, id, Number(v)))}
                        options={shown.map((f, j) => ({ value: String(j), label: `Flight ${f.name}` }))}
                      />
                    </label>
                  </span>
                </>
              );
            }}
            onChange={(next) => setFlights(shown.map((f, i) => ({ name: f.name, pairIds: next[i] })))}
          />
        )}
      </section>

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

function ChangesNotice({ restored, onDismiss }: { restored: TntRestored; onDismiss: () => void }) {
  const n = restored.movedCount;
  return (
    <div className="adm-banner warn" role="status" data-testid="squads-changes">
      <p className="sq-changes-title"><strong>{n} athlete{n === 1 ? '' : 's'} changed since you placed squads.</strong> Nothing else was changed.</p>
      <ul className="sq-changes">
        {restored.changes.map((c, i) => (
          <li key={i}>
            {c.kind === 'dropped'
              ? `Removed from ${c.squad} (no longer entered on Trampoline, Double Mini or Tumbling, or no longer competing): ${c.names.join(', ')}`
              : `New since you placed squads, in the unplaced list: ${c.names.join(', ')}`}
          </li>
        ))}
      </ul>
      <button type="button" className="btn small" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
