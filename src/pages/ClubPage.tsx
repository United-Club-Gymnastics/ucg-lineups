import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../lib/firebase';
import { CompetitionOrderCard, type OrderChange } from '../components/CompetitionOrderCard';
import { Badge } from '../components/ui';
import { Autosaver, type SaveState } from '../lib/autosave';
import type { ClubLinkDoc, LinkLevel, LinkSession } from '../lib/club-links';
import { resolveLevel, type ArtisticDiscipline, type LevelOrder } from '../lib/club-order-model';
import { levelStatus, sessionStatus, STATUS_LABEL, type SessionStatus } from '../lib/club-status';
import { APPARATUS } from '../lib/apparatus';
import { groupLetter } from '../lib/competition-order';
import { loadClubLink, loadLevelOrders, loadOrderDeadline, saveLevelOrder } from '../lib/data/club-store';
import './club.css';

type Load =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; link: ClubLinkDoc; deadline: Date | null; orders: Record<string, LevelOrder> };

const TONE: Record<SessionStatus, 'ok' | 'warn' | 'err' | 'info' | 'navy'> = {
  split: 'err', default: 'warn', custom: 'ok', none: 'info', tnt: 'navy',
};

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function ClubPage() {
  const { token = '' } = useParams();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const link = await loadClubLink(db, token);
        if (cancelled) return;
        if (!link) { setLoad({ kind: 'invalid' }); return; }
        const [deadline, orders] = await Promise.all([loadOrderDeadline(db), loadLevelOrders(db, token)]);
        if (!cancelled) setLoad({ kind: 'ready', link, deadline, orders });
      } catch (e) {
        if (!cancelled) setLoad({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load this page.' });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (load.kind === 'loading') return <main className="club"><p role="status">Loading your lineup…</p></main>;
  if (load.kind === 'invalid') {
    return (
      <main className="club">
        <h1 className="display">This link isn&rsquo;t valid</h1>
        <p>We couldn&rsquo;t find a club for this link. Check that you copied the whole address from your email, or ask UCG for a new link.</p>
      </main>
    );
  }
  if (load.kind === 'error') {
    return (
      <main className="club">
        <h1 className="display">Something went wrong</h1>
        <div className="club-banner err" role="alert">{load.message}</div>
        <button className="btn" type="button" onClick={() => window.location.reload()}>Reload</button>
      </main>
    );
  }
  return <ClubOrders key={token} token={token} link={load.link} deadline={load.deadline} initialOrders={load.orders} />;
}

function ClubOrders({ token, link, deadline, initialOrders }: { token: string; link: ClubLinkDoc; deadline: Date | null; initialOrders: Record<string, LevelOrder> }) {
  const [orders, setOrders] = useState(initialOrders);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [sessionId, setSessionId] = useState(() => link.sessions.find((s) => s.discipline !== 'TNT')?.sessionId ?? '');
  const [levelKey, setLevelKey] = useState('');
  const [apparatus, setApparatus] = useState('');

  // The deadline is checked when the page loads and again every minute, so an open page goes read-only.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const locked = deadline !== null && now >= deadline.getTime();

  const saver = useRef<Autosaver<LevelOrder> | null>(null);
  if (saver.current === null) saver.current = new Autosaver<LevelOrder>((key, order) => saveLevelOrder(db, token, key, order), setSave);
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

  const session: LinkSession | undefined = link.sessions.find((s) => s.sessionId === sessionId);
  const levels = useMemo(() => session?.levels ?? [], [session]);
  const level: LinkLevel | undefined = levels.find((l) => l.levelKey === levelKey) ?? levels[0];
  const discipline = session?.discipline as ArtisticDiscipline | undefined;

  const statusOf = useCallback(
    (s: LinkSession): SessionStatus =>
      sessionStatus(s.discipline, s.levels.map((l) => levelStatus(s.discipline as ArtisticDiscipline, l.athletes, orders[l.levelKey]))),
    [orders],
  );

  const resolved = level && discipline ? resolveLevel(discipline, level.athletes, orders[level.levelKey]) : null;
  const activeApparatus = resolved && resolved.codes.includes(apparatus) ? apparatus : resolved?.codes[0] ?? '';

  function commit(key: string, order: LevelOrder) {
    setOrders((prev) => ({ ...prev, [key]: order }));
    saver.current!.schedule(key, order);
  }

  function onChange(change: OrderChange) {
    if (!level || !resolved || locked) return;
    commit(level.levelKey, {
      groups: change.groups,
      sections: change.sections,
      splitDecided: resolved.splitDecided || change.membershipChanged,
    });
  }

  function keepSplit() {
    if (!level || !resolved || locked) return;
    commit(level.levelKey, { groups: resolved.groups, sections: resolved.sectionsBy, splitDecided: true });
  }

  const needsSplit = !!resolved && resolved.levelBusiest > resolved.cap && !resolved.splitDecided;

  return (
    <main className="club">
      <header className="club-head">
        <p className="club-eyebrow">UCG Nationals</p>
        <h1 className="display">{link.clubName}</h1>
        <p className="club-lead">
          Set the order your athletes compete in. Every change saves by itself, so there is nothing to submit.
          Until you change something, athletes are listed A&ndash;Z by first name.
        </p>
        <SaveIndicator state={save} locked={locked} onRetry={() => void saver.current!.flush()} />
      </header>

      {locked ? (
        <div className="club-banner warn" role="status" data-testid="club-locked">
          The order deadline has passed, so orders are now locked and can&rsquo;t be changed here. Contact UCG if something needs to change.
        </div>
      ) : deadline && (
        <p className="club-note">Orders lock on {dateFmt.format(deadline)}.</p>
      )}

      {link.sessions.length === 0 ? (
        <div className="club-card"><p>No athletes are entered for your club yet. This page will fill in once UCG imports the registrations.</p></div>
      ) : (
        <>
          <ul className="club-sessions" aria-label="Your sessions">
            {link.sessions.map((s) => {
              const st = statusOf(s);
              const body = (
                <>
                  <span className="club-chip-label">{s.label}</span>
                  <span className="club-chip-meta">{s.discipline === 'TNT' ? 'T&T' : s.discipline}</span>
                  <Badge tone={TONE[st]}>{STATUS_LABEL[st]}</Badge>
                </>
              );
              return (
                <li key={s.sessionId}>
                  {s.discipline === 'TNT' ? (
                    <div className="club-chip static">{body}</div>
                  ) : (
                    <button
                      type="button"
                      className={`club-chip${s.sessionId === sessionId ? ' active' : ''}`}
                      aria-pressed={s.sessionId === sessionId}
                      onClick={() => { setSessionId(s.sessionId); setLevelKey(''); setApparatus(''); }}
                    >
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {session && session.discipline !== 'TNT' && level && discipline && resolved && (
            <section className="club-card" aria-label={`${session.label} order`}>
              <div className="tabs" role="tablist" aria-label="Level">
                {levels.map((l) => {
                  const st = levelStatus(discipline, l.athletes, orders[l.levelKey]);
                  const active = l.levelKey === level.levelKey;
                  return (
                    <button key={l.levelKey} type="button" role="tab" aria-selected={active} className={`tab${active ? ' active' : ''}`} onClick={() => { setLevelKey(l.levelKey); setApparatus(''); }}>
                      {l.levelName}
                      {st === 'split' && <span className="club-dot" aria-label="needs a split decision" title="Needs a split decision" />}
                    </button>
                  );
                })}
              </div>

              <p className="club-note">
                {level.levelName}: {STATUS_LABEL[levelStatus(discipline, level.athletes, orders[level.levelKey])]}
              </p>

              {needsSplit && (
                <div className="club-banner warn" role="region" aria-label="Suggested split" data-testid="club-split">
                  <p>
                    <strong>This level is too big for one squad.</strong> Your busiest event has {resolved.levelBusiest} athletes and a squad holds
                    at most {resolved.cap}. We suggest {resolved.groups.length} groups ({resolved.groups.map((g, i) => `${groupLetter(i)}: ${g.length}`).join(', ')}).
                    Review the groups below, move anyone you like, then keep the split.
                  </p>
                  {!locked && <button type="button" className="btn primary small" onClick={keepSplit}>Keep this split</button>}
                </div>
              )}

              {resolved.codes.length > 1 && (
                <div className="tabs tabs-pill" role="tablist" aria-label="Event">
                  {resolved.codes.map((c) => (
                    <button key={c} type="button" role="tab" aria-selected={c === activeApparatus} className={`tab${c === activeApparatus ? ' active' : ''}`} onClick={() => setApparatus(c)}>
                      {APPARATUS[discipline].find((a) => a.code === c)?.name ?? c}
                    </button>
                  ))}
                </div>
              )}

              <CompetitionOrderCard
                key={level.levelKey}
                athletes={level.athletes}
                discipline={discipline}
                groups={resolved.groups}
                sections={resolved.sectionsBy}
                editable={!locked}
                apparatus={activeApparatus || undefined}
                onChange={onChange}
              />
            </section>
          )}
        </>
      )}
    </main>
  );
}

function SaveIndicator({ state, locked, onRetry }: { state: SaveState; locked: boolean; onRetry: () => void }) {
  if (state.kind === 'error') {
    return (
      <div className="club-banner err" role="alert">
        Your last change did not save: {state.message} Your changes are still on this page.{' '}
        <button type="button" className="btn small" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  let text = locked ? 'Locked' : 'All changes save automatically';
  if (state.kind === 'saving') text = 'Saving…';
  if (state.kind === 'saved') text = `Saved · ${timeFmt.format(state.at)}`;
  return <p className="club-save" role="status" aria-live="polite" data-testid="club-save">{text}</p>;
}
