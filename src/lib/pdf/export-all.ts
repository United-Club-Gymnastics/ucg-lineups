// Pure: everything the Exports screen needs to print, built from what the admin screens already load: one export input per
// session, plus the warnings (never blockers) the screen lists first. Spec §6.
import type { LevelOrder } from '../club-order-model';
import type { StoredAthlete } from '../import/diff';
import type { Session } from '../import/types';
import { matchPairs } from '../synchro-flights';
import type { SynchroPair } from '../synchro-source';
import { isArtisticSession, parseSquadDoc, sessionTitle, sortSessionsByGym } from '../squad-data';
import { buildTntSessionData, isTntSession, parseTntDoc } from '../tnt-data';
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
  /** `Session 1 – Orange`. */
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
  /** Pairs read from the Synchro tool; null when it could not be read. */
  synchroPairs: SynchroPair[] | null;
}): ExportBuild {
  const out: ExportSession[] = [];
  const warnings: ExportWarning[] = [];
  const warn = (s: Session, text: string) => warnings.push({ sessionId: s.id, session: sessionTitle(s), text });

  for (const session of sortSessionsByGym(input.sessions, input.gymOrder)) {
    const raw = input.squadDocs[session.id];
    const base = { id: session.id, number: session.number, gym: session.gym };
    if (isArtisticSession(session)) {
      const stored = parseSquadDoc(raw);
      const built = buildArtisticSessionInput({ session, athletes: input.athletes, ordersByClub: input.ordersByClub, stored, meet: input.meet });
      if (built.noSquads) warn(session, 'No squads saved yet: the scorecards have no pages and the rotation sheet is empty.');
      else if (built.unplaced > 0) warn(session, `${plural(built.unplaced, 'athlete')} not placed in a squad: not on the sheets.`);
      out.push({ id: session.id, session, title: sessionTitle(session), input: { type: 'artistic', ...base, input: built } });
    } else if (isTntSession(session)) {
      const stored = parseTntDoc(raw);
      const data = buildTntSessionData(session, input.athletes);
      const pairs = input.synchroPairs ? matchPairs(input.synchroPairs, data.all, data.elsewhere) : null;
      const built = buildTntSessionInput({ session, athletes: input.athletes, stored, pairs, meet: input.meet });
      if (built.noSquads) warn(session, 'No squads saved yet: the scorecards have no pages and the rotation sheet is empty.');
      else if (built.unplaced > 0) warn(session, `${plural(built.unplaced, 'athlete')} not placed in a squad: not on the sheets.`);
      if (built.pairsMissing) warn(session, 'The Synchro tool could not be read: no synchro flights are included.');
      out.push({ id: session.id, session, title: sessionTitle(session), input: { type: 'tnt', ...base, input: built } });
    }
  }
  if (!input.meet.name.trim()) warnings.unshift({ sessionId: '', session: 'Meet', text: 'The meet name is empty: set it above so it prints in the headers.' });
  return { sessions: out, warnings };
}

/** The screen lets the admin type the meet name/date and a T&T competition time before saving them: show those in the sheets. */
export function withOverrides(sessions: ExportSession[], o: { meet: Meet; competitionTimes: Record<string, string> }): ExportSession[] {
  return sessions.map((s) => {
    const inner = s.input;
    if (inner.type === 'artistic') return { ...s, input: { ...inner, input: { ...inner.input, meet: o.meet } } };
    const time = o.competitionTimes[s.id];
    return { ...s, input: { ...inner, input: { ...inner.input, meet: o.meet, competitionTime: time ?? inner.input.competitionTime } } };
  });
}
