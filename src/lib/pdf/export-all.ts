// Pure: everything the Exports screen needs to print, built from what the admin screens already load: one export input per
// session, plus the warnings (never blockers) the screen lists first. Spec §6.
import type { LevelOrder } from '../club-order-model';
import type { StoredAthlete } from '../import/diff';
import type { Session } from '../import/types';
import { mergeFlights, pairNames, pairsInSession, pairsNeedingSession, placePairs, type PlacedPair, type SynchroAssignments, type SynchroScratched } from '../synchro-flights';
import type { SynchroPair } from '../synchro-source';
import { scheduleKey, sessionLocation, sessionName } from '../session-names';
import { isArtisticSession, parseSquadDoc, sessionTitle, sortSessionsByGym } from '../squad-data';
import { buildTntRoster, isTntSession, parseTntDoc } from '../tnt-data';
import { formatDate, resolveSchedule, whenText, type ScheduleOverride, type ScheduleRows } from '../schedule';
import type { SessionExportInput } from './collate';
import type { Meet } from './model';
import { buildArtisticSessionInput, buildTntSessionInput } from './session-input';

export interface ExportWarning {
  sessionId: string;
  session: string;
  text: string;
}

export interface ExportSession {
  id: string;
  session: Session;
  /** `Session 1 – Orange`, `MAG Finals – Orange`. */
  title: string;
  input: SessionExportInput;
}

export interface ExportBuild {
  sessions: ExportSession[];
  warnings: ExportWarning[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildExportSessions(input: {
  sessions: Session[];
  athletes: StoredAthlete[];
  gymOrder: string[];
  ordersByClub: Record<string, Record<string, LevelOrder>>;
  /** Raw `squads/{sessionId}` documents by session id. */
  squadDocs: Record<string, unknown>;
  meet: Meet;
  /** The session schedule: a row per session name (with `meet.date` as the date fallback); sessions may override fields. */
  schedule?: ScheduleRows;
  /** Pairs read from the Synchro tool; null when it could not be read. */
  synchroPairs: SynchroPair[] | null;
  /** The host's synchro session choices (`synchroSessions/main`); none when omitted. */
  synchroAssignments?: SynchroAssignments;
  /** Pairs the host scratched: on no sheet and in no warning; none when omitted. */
  synchroScratched?: SynchroScratched;
}): ExportBuild {
  const out: ExportSession[] = [];
  const warnings: ExportWarning[] = [];
  const warn = (s: Session, text: string) => warnings.push({ sessionId: s.id, session: sessionTitle(s), text });

  const sessionsSorted = sortSessionsByGym(input.sessions, input.gymOrder);
  const placed: PlacedPair[] | null = input.synchroPairs
    ? placePairs(input.synchroPairs, buildTntRoster(input.athletes), input.synchroAssignments ?? {}, input.sessions.filter(isTntSession).map((s) => s.id), input.synchroScratched ?? {})
    : null;

  for (const session of sessionsSorted) {
    const raw = input.squadDocs[session.id];
    const base = { id: session.id, name: sessionName(session), location: sessionLocation(session) };
    if (isArtisticSession(session)) {
      const stored = parseSquadDoc(raw);
      const built = buildArtisticSessionInput({ session, athletes: input.athletes, ordersByClub: input.ordersByClub, stored, meet: input.meet });
      if (built.noSquads) warn(session, 'No squads saved yet: the scorecards have no pages and the rotation sheet is empty.');
      else if (built.unplaced > 0) warn(session, `${plural(built.unplaced, 'athlete')} not placed in a squad: not on the sheets.`);
      out.push({ id: session.id, session, title: sessionTitle(session), input: { type: 'artistic', ...base, input: built } });
    } else if (isTntSession(session)) {
      const stored = parseTntDoc(raw);
      const pairs = placed ? pairsInSession(placed, session.id) : null;
      const built = buildTntSessionInput({ session, athletes: input.athletes, stored, pairs, meet: input.meet });
      if (built.noSquads) warn(session, 'No squads saved yet: the scorecards have no pages and the rotation sheet is empty.');
      else if (built.unplaced > 0) warn(session, `${plural(built.unplaced, 'athlete')} not placed in a squad: not on the sheets.`);
      if (built.pairsMissing) warn(session, 'The Synchro tool could not be read: no synchro flights are included.');
      else if (stored && stored.flights.length > 0 && pairs) {
        const added = mergeFlights(stored.flights, pairs).added.length;
        if (added > 0) warn(session, `${plural(added, 'synchro pair')} not in the saved flights ${added === 1 ? 'was' : 'were'} added at the end of ${added === 1 ? 'its' : 'their'} level. Press Refresh pairs on the T&T screen to review.`);
      }
      out.push({ id: session.id, session, title: sessionTitle(session), input: { type: 'tnt', ...base, input: built } });
    }
  }
  const waiting = placed ? pairsNeedingSession(placed) : [];
  if (waiting.length > 0) {
    warnings.unshift({
      sessionId: '', session: 'Synchro',
      text: `${plural(waiting.length, 'synchro pair')} still ${waiting.length === 1 ? 'needs' : 'need'} a session and ${waiting.length === 1 ? 'is' : 'are'} not on any sheet: ${waiting.map(pairNames).join('; ')}. Choose a session on the T&T screen.`,
    });
  }
  if (!input.meet.name.trim()) warnings.unshift({ sessionId: '', session: 'Meet', text: 'The meet name is empty: set it above so it prints in the headers.' });
  return { sessions: applySchedules(out, { meet: input.meet, rows: input.schedule ?? {} }), warnings };
}

/**
 * Give every session its resolved schedule (its number's row, with the session's own override per field; the single meet date
 * is only a fallback when a session has no date): the header date on every sheet, the artistic rotation sheet's times, and the
 * T&T rotation sheet's "Thursday 7:30 AM". `overrides` (typed on the Exports screen, not saved yet) win over the saved ones.
 */
export function applySchedules(
  sessions: ExportSession[],
  o: { meet: Meet; rows: ScheduleRows; overrides?: Record<string, ScheduleOverride> },
): ExportSession[] {
  return sessions.map((s) => {
    const r = resolveSchedule(scheduleKey(s.session), o.rows, o.overrides?.[s.id] ?? s.session.scheduleOverride, o.meet.date);
    const meet: Meet = { id: o.meet.id, name: o.meet.name, date: formatDate(r.date) };
    const inner = s.input;
    if (inner.type === 'artistic') {
      return { ...s, input: { ...inner, input: { ...inner.input, meet, schedule: { stretch: r.stretch, warmups: r.warmups, competition: r.competition } } } };
    }
    return { ...s, input: { ...inner, input: { ...inner.input, meet, competitionTime: whenText(r) } } };
  });
}
