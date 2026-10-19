import { findRowKey, scheduleKey, type SessionRef } from './session-names';
// Pure: the session schedule. One row per session NAME (every location's "Session 1" shares it, every "MAG Finals" too) holds the
// date and the times; a session may override any field. `settings/meet.schedule` = { "<key>": row } where the key is "<N>" for a
// session named `Session N` (as it always was) and the name as typed otherwise (matched ignoring case); `sessions/{id}.scheduleOverride` = fields.
export interface ScheduleFields {
  /** ISO `yyyy-mm-dd` (a free-text date is kept as typed). */
  date: string;
  /** Open stretch, timed warm-ups, competition: shown as typed, e.g. `7:30 AM`. */
  stretch: string;
  warmups: string;
  competition: string;
}

export const SCHEDULE_KEYS: (keyof ScheduleFields)[] = ['date', 'stretch', 'warmups', 'competition'];
export const EMPTY_FIELDS: ScheduleFields = { date: '', stretch: '', warmups: '', competition: '' };

/** Rows keyed by schedule key (`"1"` for Session 1, else the session name). A row may be missing or partial. */
export type ScheduleRows = Record<string, Partial<ScheduleFields>>;
export type ScheduleOverride = Partial<ScheduleFields>;

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Read fields defensively: only known keys, only non-empty strings. */
export function parseFields(raw: unknown): Partial<ScheduleFields> {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Partial<ScheduleFields> = {};
  for (const k of SCHEDULE_KEYS) {
    const v = clean(o[k]);
    if (v) out[k] = v;
  }
  return out;
}

export function parseRows(raw: unknown): ScheduleRows {
  const out: ScheduleRows = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const f = parseFields(v);
      if (Object.keys(f).length > 0) out[k] = f;
    }
  }
  return out;
}

/**
 * The schedule a session prints: per field, the session's override if it has one, else its name's row (`key` = `scheduleKey(session)`). The date falls
 * back to the meet's single date (`fallbackDate`) when neither has one. Anything missing is ''.
 */
export function resolveSchedule(key: string | number, rows: ScheduleRows, override: ScheduleOverride | undefined, fallbackDate = ''): ScheduleFields {
  const k = findRowKey(rows, String(key));
  const row = (k === undefined ? undefined : rows[k]) ?? {};
  const pick = (k: keyof ScheduleFields) => clean(override?.[k]) || clean(row[k]);
  return {
    date: pick('date') || clean(fallbackDate),
    stretch: pick('stretch'),
    warmups: pick('warmups'),
    competition: pick('competition'),
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseIso(date: string): { y: number; m: number; d: number; weekday: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d, weekday: DAYS[t.getUTCDay()] };
}

/** `2026-10-22` -> `October 22, 2026`; free text is returned as typed. */
export function formatDate(date: string): string {
  const p = parseIso(date);
  return p ? `${MONTHS[p.m - 1]} ${p.d}, ${p.y}` : date.trim();
}

/** `2026-10-22` -> `Thursday`; '' for free text. */
export const weekdayOf = (date: string): string => parseIso(date)?.weekday ?? '';

/**
 * The T&T rotation sheet's time: weekday + competition, e.g. `Thursday 7:30 AM`. A competition time that already names the
 * weekday (older times were typed that way) is not given a second one; with no weekday it is the time alone.
 */
export function whenText(s: Pick<ScheduleFields, 'date' | 'competition'>): string {
  const day = weekdayOf(s.date);
  const time = s.competition.trim();
  if (!day) return time;
  if (!time) return day;
  return new RegExp(day, 'i').test(time) ? time : `${day} ${time}`;
}

// --- one-time migration of the older per-session times ----------------------------------------------------------

export interface LegacySchedule {
  sessionId: string;
  /** The session's schedule key (`scheduleKey()`). */
  number: string | number;
  /** From `squads/{id}.schedule` (stretch, warmups, competition) and `sessions/{id}.competitionTime`. */
  stretch: string;
  warmups: string;
  competition: string;
  /** `sessions/{id}.competitionTime`, kept apart so it can be cleared on its own. */
  hadCompetitionTime: boolean;
  hadSquadSchedule: boolean;
}

export interface MigrationPlan {
  /** Fields that differ from the session name's row become that session's override (merged over any existing one). */
  overrides: Record<string, ScheduleOverride>;
  /** Sessions whose old `squads/{id}.schedule` is cleared, and whose `sessions/{id}.competitionTime` is removed. */
  clearSquadSchedule: string[];
  clearCompetitionTime: string[];
  /** Counts for the screen. */
  moved: number;
  dropped: number;
}

/**
 * Old times become an override only where they differ from the number's row (same text = dropped). An override the host
 * already set is never replaced. Legacy competition time (older of the two sources: the Exports screen's) wins over the
 * squads one when both exist.
 */
export function planMigration(legacy: LegacySchedule[], rows: ScheduleRows, existing: Record<string, ScheduleOverride | undefined>): MigrationPlan {
  const plan: MigrationPlan = { overrides: {}, clearSquadSchedule: [], clearCompetitionTime: [], moved: 0, dropped: 0 };
  for (const l of legacy) {
    if (l.hadSquadSchedule) plan.clearSquadSchedule.push(l.sessionId);
    if (l.hadCompetitionTime) plan.clearCompetitionTime.push(l.sessionId);
    const lk = findRowKey(rows, String(l.number));
    const row = (lk === undefined ? undefined : rows[lk]) ?? {};
    const have = existing[l.sessionId] ?? {};
    const next: ScheduleOverride = {};
    for (const k of ['stretch', 'warmups', 'competition'] as const) {
      const v = clean(l[k]);
      if (!v) continue;
      if (v === clean(row[k]) || clean(have[k])) plan.dropped++;
      else { next[k] = v; plan.moved++; }
    }
    if (Object.keys(next).length > 0) plan.overrides[l.sessionId] = { ...have, ...next };
  }
  return plan;
}

/** Find the old per-session times in the raw `squads/{id}` documents and the sessions' `competitionTime`. */
export function collectLegacy(
  sessions: ({ id: string; competitionTime?: string } & SessionRef)[],
  squadDocs: Record<string, unknown>,
): LegacySchedule[] {
  const out: LegacySchedule[] = [];
  for (const s of sessions) {
    const raw = squadDocs[s.id];
    const sch = raw && typeof raw === 'object' ? (raw as { schedule?: unknown }).schedule : undefined;
    const sq = sch && typeof sch === 'object' ? (sch as Record<string, unknown>) : null;
    const time = clean(s.competitionTime);
    const l: LegacySchedule = {
      sessionId: s.id, number: scheduleKey(s),
      stretch: clean(sq?.stretch), warmups: clean(sq?.warmups), competition: time || clean(sq?.competition),
      hadCompetitionTime: s.competitionTime !== undefined,
      hadSquadSchedule: !!sq && ['stretch', 'warmups', 'competition'].some((k) => clean(sq[k]) !== ''),
    };
    if (l.hadCompetitionTime || l.hadSquadSchedule) out.push(l);
  }
  return out;
}

/**
 * Tidy a typed time into `h:mm AM/PM` (Julia 2026-10-18), e.g. `730` / `7:30` / `7.30a` / `19:30` / `7 pm` →
 * `7:30 AM` / `7:30 PM`. Without AM/PM, 24-hour values are converted; 7–11 read as AM and 12–6 as PM (meet hours).
 * Anything that isn't a time (e.g. `TBD`) is returned as typed (trimmed).
 */
export function formatTime(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?\s*([ap])?\.?\s*(?:m\.?)?$/i.exec(s.replace(/\s+/g, ' '));
  if (!m) return s;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (min > 59) return s;
  let suffix: 'AM' | 'PM';
  if (m[3]) {
    if (h < 1 || h > 12) return s;
    suffix = m[3].toLowerCase() === 'a' ? 'AM' : 'PM';
  } else {
    if (h > 23) return s;
    if (h === 0) { h = 12; suffix = 'AM'; }
    else if (h >= 13) { h -= 12; suffix = 'PM'; }
    else if (h === 12) suffix = 'PM';
    else suffix = h >= 7 ? 'AM' : 'PM';
  }
  return `${h}:${String(min).padStart(2, '0')} ${suffix}`;
}
