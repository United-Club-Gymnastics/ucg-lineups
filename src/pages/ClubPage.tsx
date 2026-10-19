import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../lib/firebase';
import { CompetitionOrderCard, type OrderChange } from '../components/CompetitionOrderCard';
import Select from '../components/Select';
import { Badge } from '../components/ui';
import { Autosaver, type SaveState } from '../lib/autosave';
import { linkMeets, type ClubLinkDoc, type LinkLevel, type LinkSession, type MeetLinkEntry } from '../lib/club-links';
import { resolveLevel, type ArtisticDiscipline, type LevelOrder } from '../lib/club-order-model';
import { levelStatus, sessionStatus, STATUS_LABEL, type SessionStatus } from '../lib/club-status';
import { APPARATUS } from '../lib/apparatus';
import { groupLetter } from '../lib/competition-order';
import { loadClubLink, loadLevelOrders, loadPublicMeet, saveLevelOrder } from '../lib/data/club-store';
import './club.css';

type Load =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; link: ClubLinkDoc; meets: Record<string, MeetData> };

/** What the page holds per meet: its public facts (deadline, name) and the club's saved orders there. */
interface MeetData { deadline: Date | null; name: string; orders: Record<string, LevelOrder> }

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
        // loadClubLink returns null for a missing link and for an old per-meet link (those stop working).
        if (!link) { setLoad({ kind: 'invalid' }); return; }
        const entries = linkMeets(link);
        const loaded = await Promise.all(entries.map(async ({ meetId }) => {
          const [meet, orders] = await Promise.all([loadPublicMeet(db, meetId), loadLevelOrders(db, token, meetId)]);
          return [meetId, { deadline: meet.deadline, name: meet.name, orders }] as const;
        }));
        if (!cancelled) setLoad({ kind: 'ready', link, meets: Object.fromEntries(loaded) });
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
  return <ClubOrders key={token} token={token} link={load.link} meets={load.meets} />;
}

const KEY_SEP = '\u0001';
const deadlineText = (d: Date | null, locked: boolean) => (d === null ? 'No deadline' : locked ? 'Locked' : `Locks ${dateFmt.format(d)}`);

function ClubOrders({ token, link, meets }: { token: string; link: ClubLinkDoc; meets: Record<string, MeetData> }) {
  // The meets the club is in (not archived), newest first; the newest is selected until the club picks another.
  const list = useMemo(() => linkMeets(link), [link]);
  const [meetId, setMeetId] = useState(() => list[0]?.meetId ?? '');
  const [orders, setOrders] = useState(() => Object.fromEntries(Object.entries(meets).map(([id, m]) => [id, m.orders])));
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  // Each meet's deadline is checked when the page loads and again every minute, so an open page goes read-only.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const isLocked = (id: string) => { const d = meets[id]?.deadline ?? null; return d !== null && now >= d.getTime(); };

  const saver = useRef<Autosaver<{ meetId: string; levelKey: string; order: LevelOrder }> | null>(null);
  if (saver.current === null) saver.current = new Autosaver((_key, v) => saveLevelOrder(db, token, v.meetId, v.levelKey, v.order), setSave);
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

  function commit(forMeet: string, levelKey: string, order: LevelOrder) {
    setOrders((prev) => ({ ...prev, [forMeet]: { ...(prev[forMeet] ?? {}), [levelKey]: order } }));
    saver.current!.schedule(`${forMeet}${KEY_SEP}${levelKey}`, { meetId: forMeet, levelKey, order });
  }

  const current = list.find((m) => m.meetId === meetId);
  const locked = current ? isLocked(current.meetId) : false;
  const currentDeadline = current ? meets[current.meetId]?.deadline ?? null : null;
  const meetName = (id: string, e: MeetLinkEntry) => meets[id]?.name || e.meetName || 'Meet';

  return (
    <main className="club">
      <header className="club-head">
        <p className="club-eyebrow">UCG</p>
        <h1 className="display">{link.clubName}</h1>
        <p className="club-lead">
          Set the order your athletes compete in. Every change saves by itself, so there is nothing to submit.
          Until you change something, athletes are listed A&ndash;Z by first name.
        </p>
        <SaveIndicator state={save} locked={locked} onRetry={() => void saver.current!.flush()} />
      </header>

      {list.length === 0 ? (
        <div className="club-card"><p>No meets are open for your club yet. This page will fill in once UCG sets one up.</p></div>
      ) : (
        <>
          {list.length > 1 && (
            <div className="club-meet-select">
              <label htmlFor="club-meet">Meet</label>
              <Select
                id="club-meet" value={meetId} onChange={setMeetId}
                options={list.map(({ meetId: id, entry }) => ({ value: id, label: `${meetName(id, entry)} · ${deadlineText(meets[id]?.deadline ?? null, isLocked(id))}` }))}
              />
            </div>
          )}

          {locked ? (
            <div className="club-banner warn" role="status" data-testid="club-locked">
              The order deadline has passed{list.length > 1 && current ? ` for ${meetName(current.meetId, current.entry)}` : ''}, so orders are now locked and can&rsquo;t be changed here. Contact UCG if something needs to change.
            </div>
          ) : currentDeadline && (
            <p className="club-note">Orders lock on {dateFmt.format(currentDeadline)}{list.length > 1 && current ? ` for ${meetName(current.meetId, current.entry)}` : ''}.</p>
          )}
          {list.length === 1 && current && <p className="club-note club-meetname">{meetName(current.meetId, current.entry)}</p>}

          {current && (
            <MeetOrders
              key={current.meetId}
              entry={current.entry}
              orders={orders[current.meetId] ?? {}}
              locked={locked}
              onCommit={(levelKey, order) => commit(current.meetId, levelKey, order)}
            />
          )}
        </>
      )}
    </main>
  );
}

/** One meet's sessions, statuses and the order editor. Remounted (by key) when the club switches meet. */
function MeetOrders({ entry, orders, locked, onCommit }: {
  entry: MeetLinkEntry;
  orders: Record<string, LevelOrder>;
  locked: boolean;
  onCommit: (levelKey: string, order: LevelOrder) => void;
}) {
  const sessionsList = entry.sessions;
  const [sessionId, setSessionId] = useState(() => sessionsList.find((s) => s.discipline !== 'TNT')?.sessionId ?? '');
  const [levelKey, setLevelKey] = useState('');
  const [apparatus, setApparatus] = useState('');

  const session: LinkSession | undefined = sessionsList.find((s) => s.sessionId === sessionId);
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

  function onChange(change: OrderChange) {
    if (!level || !resolved || locked) return;
    onCommit(level.levelKey, {
      groups: change.groups,
      sections: change.sections,
      splitDecided: resolved.splitDecided || change.membershipChanged,
    });
  }

  function keepSplit() {
    if (!level || !resolved || locked) return;
    onCommit(level.levelKey, { groups: resolved.groups, sections: resolved.sectionsBy, splitDecided: true });
  }

  const needsSplit = !!resolved && resolved.levelBusiest > resolved.cap && !resolved.splitDecided;

  return (
    <>
      {sessionsList.length === 0 ? (
        <div className="club-card"><p>No athletes are entered for your club in this meet yet. This page will fill in once UCG imports the registrations.</p></div>
      ) : (
        <>
          <ul className="club-sessions" aria-label="Your sessions">
            {sessionsList.map((s) => {
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
    </>
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
