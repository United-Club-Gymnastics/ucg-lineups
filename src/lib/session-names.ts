// Pure: how a ScoreFlippers session string ("<session name> - <location>") is read, named, keyed, sorted and printed.
// Spec §2 / §6. The name is anything ("Session 1", "MAG Finals", "Xcel Platinum - Day 2"); the location is a gym colour
// or a venue ("Orange", "Dupont"). Live meets only ever had "Session <N> - <colour>": those keep their ids and schedule keys.

export interface ParsedSession {
  /** Left of the last " - ", trimmed. `Session N` is normalised to `Session N`. */
  name: string;
  /** Right of the last " - ", trimmed; '' when the string had no separator. */
  location: string;
  /** Only when the name is exactly `Session N` (ordering, and the schedule key). */
  number?: number;
  /** false: no separator, so the whole string is the name and the location is empty (the import warns). */
  hasLocation: boolean;
}

/** What the screens need from a session to name and sort it. Stored sessions from before names existed have number + gym only. */
export interface SessionRef {
  name?: string;
  location?: string;
  number?: number;
  gym?: string;
}

const SESSION_N = /^session\s*(\d+)$/i;
// " - ", " – ", " — " with a space either side. The LAST one splits, so names may hold hyphens ("Xcel Platinum - Day 2 - Green").
const SEPARATOR = /\s[-–—]\s/g;
// The older, looser reading (kept so "Session 1-Orange", "Session 1 Orange" and "Session 1: Orange" still import).
const LEGACY = /^\s*session\s*(\d+)\s*[-–—:]?\s*([A-Za-z]+)\s*$/i;

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function finish(name: string, location: string, hasLocation: boolean): ParsedSession {
  const m = SESSION_N.exec(name);
  if (!m) return { name, location, hasLocation };
  // Today's gym spelling: a single word is capitalised ("ORANGE" -> "Orange").
  const loc = /^[A-Za-z]+$/.test(location) ? capitalise(location) : location;
  return { name: `Session ${Number(m[1])}`, location: loc, number: Number(m[1]), hasLocation };
}

/** null: nothing to read (empty string). */
export function parseSessionString(raw: string): ParsedSession | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  let at = -1;
  let len = 0;
  for (const m of text.matchAll(SEPARATOR)) { at = m.index; len = m[0].length; }
  if (at > 0 && at + len < text.length) {
    const name = text.slice(0, at).trim();
    const location = text.slice(at + len).trim();
    if (name && location) return finish(name, location, true);
  }
  const old = LEGACY.exec(text);
  if (old) return finish(`Session ${Number(old[1])}`, old[2], true);
  return finish(text, '', false);
}

/** `Session N` + a location keeps today's id (`s1-orange`); anything else is `<name>--<location>` as slugs. */
export function sessionIdFor(p: Pick<ParsedSession, 'name' | 'location' | 'number'>): string {
  if (p.number !== undefined) {
    const loc = /^[A-Za-z]+$/.test(p.location) ? p.location.toLowerCase() : slug(p.location);
    return `s${p.number}-${loc}`;
  }
  return `${slug(p.name)}--${slug(p.location)}`;
}

// --- reading a stored / fixture session ------------------------------------------------------------------------------

export const sessionName = (s: SessionRef): string => s.name || (s.number !== undefined ? `Session ${s.number}` : '');
export const sessionLocation = (s: SessionRef): string => s.location ?? s.gym ?? '';

/** `Session 1 – Orange`, `MAG Finals – Orange`, `MAG Session 1 – Dupont`; just the name when there is no location. */
export function sessionTitle(s: SessionRef): string {
  const n = sessionName(s);
  const l = sessionLocation(s);
  return l ? `${n} – ${l}` : n;
}

/** The compact form for chips and email lists: `Session 1 · Orange`. */
export function sessionShortLabel(s: SessionRef): string {
  const n = sessionName(s);
  const l = sessionLocation(s);
  return l ? `${n} · ${l}` : n;
}

const COLOURS = ['green', 'red', 'yellow', 'orange', 'purple', 'blue', 'teal', 'pink', 'white', 'black', 'gray', 'grey', 'brown', 'gold', 'silver'];

/** `Orange` -> `Orange Gym` (a single colour word); a venue is printed as written (`Dupont`). */
export function locationLabel(location: string): string {
  const l = location.trim();
  return COLOURS.includes(l.toLowerCase()) ? `${capitalise(l)} Gym` : l;
}

// --- ordering ---------------------------------------------------------------------------------------------------------

/** Natural order: Session 2 before Session 10, case-insensitive. */
export const naturalCompare = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

/** Position in the meet's location order (case-insensitive); locations not in it go after, A–Z. */
export const locationRank = (order: string[], location: string): number => {
  const i = order.findIndex((x) => x.trim().toLowerCase() === location.trim().toLowerCase());
  return i < 0 ? order.length : i;
};

/** Location (the meet's order, then A–Z), then name in natural order. */
export function sortByLocation<T extends SessionRef>(sessions: T[], order: string[]): T[] {
  return [...sessions].sort(
    (a, b) =>
      locationRank(order, sessionLocation(a)) - locationRank(order, sessionLocation(b)) ||
      naturalCompare(sessionLocation(a), sessionLocation(b)) ||
      naturalCompare(sessionName(a), sessionName(b)),
  );
}

/** Name in natural order, then location (the meet's order, then A–Z). */
export function sortByName<T extends SessionRef>(sessions: T[], order: string[]): T[] {
  return [...sessions].sort(
    (a, b) =>
      naturalCompare(sessionName(a), sessionName(b)) ||
      locationRank(order, sessionLocation(a)) - locationRank(order, sessionLocation(b)) ||
      naturalCompare(sessionLocation(a), sessionLocation(b)),
  );
}

// --- the schedule ----------------------------------------------------------------------------------------------------

/** The schedule row a session uses: `"<N>"` for `Session N` (unchanged), else its name as typed. */
export const scheduleKey = (s: SessionRef): string => (s.number !== undefined ? String(s.number) : sessionName(s));

/** Find a row by key, ignoring case (a row stored as "MAG Finals" serves "mag finals"). */
export function findRowKey(rows: Record<string, unknown>, key: string): string | undefined {
  if (key in rows) return key;
  const k = key.trim().toLowerCase();
  return Object.keys(rows).find((x) => x.trim().toLowerCase() === k);
}

/** One row per distinct session name (case-insensitive), in natural order. `key` is what the schedule is stored under. */
export function scheduleRows(sessions: SessionRef[], stored: Record<string, unknown> = {}): { key: string; label: string }[] {
  const seen = new Map<string, { key: string; label: string }>();
  for (const s of sessions) {
    const name = sessionName(s);
    if (!name) continue;
    const id = name.toLowerCase();
    if (!seen.has(id)) seen.set(id, { key: findRowKey(stored, scheduleKey(s)) ?? scheduleKey(s), label: name });
  }
  return [...seen.values()].sort((a, b) => naturalCompare(a.label, b.label));
}

// --- file names ------------------------------------------------------------------------------------------------------

/** Strip what file systems and zip tools reject (/ \ : * ? " < > |, control characters) and tidy spaces. */
export function safeFileText(s: string): string {
  return [...s]
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join('')
    .replace(/[/\\:*?"<>|]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .trim();
}

/** `<name> - <location>`: the export's own text, in the file-name dash. */
export const sessionFileBase = (s: SessionRef): string => safeFileText([sessionName(s), sessionLocation(s)].filter(Boolean).join(' - '));
