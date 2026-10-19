// Pure: per-meet name fixes. ScoreFlippers and the Synchro tool export some names with the spaces stripped
// ("MurrayMetzger", "StPierre"); there is no correct spelling in any source, so the host enters the fix once per meet.
// A fix is display-only: ids, matching (club + compact name), stored orders and squads never change. That is why a fix may
// only change spacing, capitals, hyphens/apostrophes and accents (its compact form stays the same): the Synchro tool's
// text still has to match the athlete, and the A-Z order and ids are built from the export's spelling.
import { slug } from './import/normalize';

export type NameField = 'first' | 'last';

/** `from` is the name exactly as the exports have it; `to` is how it is shown. */
export interface NameFix {
  field: NameField;
  from: string;
  to: string;
}

/** Lowercase letters and digits only, as the import and the Synchro matching compare names. */
export const compactName = (s: string): string => slug(s).replace(/-/g, '');

const tidy = (s: string): string => s.replace(/\s+/g, ' ').trim();

export const MAX_NAME_LENGTH = 60;

/** Read the stored fixes defensively: anything unusable is dropped; a later duplicate of the same field + compact name wins. */
export function parseNameFixes(raw: unknown): NameFix[] {
  const list = raw && typeof raw === 'object' ? (raw as { fixes?: unknown }).fixes : null;
  if (!Array.isArray(list)) return [];
  let out: NameFix[] = [];
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const { field, from, to } = f as Record<string, unknown>;
    if ((field !== 'first' && field !== 'last') || typeof from !== 'string' || typeof to !== 'string') continue;
    const fix = { field: field as NameField, from: tidy(from), to: tidy(to) };
    if (!compactName(fix.from) || !fix.to) continue;
    out = upsertNameFix(out, fix);
  }
  return out;
}

/** Why a fix cannot be saved, or null. */
export function validateNameFix(fix: NameFix): string | null {
  const from = tidy(fix.from);
  const to = tidy(fix.to);
  if (!compactName(from)) return 'Enter the name as it appears in the export.';
  if (!to) return 'Enter how the name should be shown.';
  if (to.length > MAX_NAME_LENGTH || from.length > MAX_NAME_LENGTH) return `Names can be at most ${MAX_NAME_LENGTH} characters.`;
  if (compactName(to) !== compactName(from)) {
    return 'The new name must use the same letters as the export; only spaces, capitals, hyphens or accents can change. Matching and sorting still use the export’s spelling.';
  }
  if (to === from) return 'That is already how the name is shown.';
  return null;
}

/** Add a fix, replacing one for the same field and the same compact name. */
export function upsertNameFix(fixes: NameFix[], fix: NameFix): NameFix[] {
  const key = compactName(fix.from);
  const clean = { field: fix.field, from: tidy(fix.from), to: tidy(fix.to) };
  const i = fixes.findIndex((f) => f.field === fix.field && compactName(f.from) === key);
  return i < 0 ? [...fixes, clean] : fixes.map((f, j) => (j === i ? clean : f));
}

export function removeNameFix(fixes: NameFix[], fix: Pick<NameFix, 'field' | 'from'>): NameFix[] {
  const key = compactName(fix.from);
  return fixes.filter((f) => !(f.field === fix.field && compactName(f.from) === key));
}

/** A function that fixes one name field; build it once for many athletes. */
export function makeNameFixer(fixes: NameFix[]): (field: NameField, value: string) => string {
  const maps: Record<NameField, Map<string, string>> = { first: new Map(), last: new Map() };
  for (const f of fixes) maps[f.field].set(compactName(f.from), f.to);
  return (field, value) => {
    const to = maps[field].get(compactName(value));
    return to === undefined || compactName(value) === '' ? value : to;
  };
}

/** The display first and last names. A name with no fix comes back as it was. */
export function applyNameFixes(first: string, last: string, fixes: NameFix[]): { first: string; last: string } {
  const fix = makeNameFixer(fixes);
  return { first: fix('first', first), last: fix('last', last) };
}

/** The same athletes with display names fixed (new objects only where a name changed). Ids and everything else are untouched. */
export function applyNameFixesToAthletes<T extends { first: string; last: string }>(athletes: T[], fixes: NameFix[]): T[] {
  if (fixes.length === 0) return athletes;
  const fix = makeNameFixer(fixes);
  return athletes.map((a) => {
    const first = fix('first', a.first);
    const last = fix('last', a.last);
    return first === a.first && last === a.last ? a : { ...a, first, last };
  });
}

type AthleteLike = { first: string; last: string; removed?: boolean };

/** How many (non-removed) athletes a fix changes the display of. */
export function countAffected(athletes: AthleteLike[], fix: Pick<NameFix, 'field' | 'from'>): number {
  const key = compactName(fix.from);
  return athletes.filter((a) => !a.removed && compactName(a[fix.field]) === key).length;
}

/** Club ids with at least one athlete whose displayed name differs between two sets of fixes. */
export function clubsAffectedByChange<T extends AthleteLike & { clubId: string }>(athletes: T[], before: NameFix[], after: NameFix[]): string[] {
  const b = makeNameFixer(before);
  const a = makeNameFixer(after);
  const ids = new Set<string>();
  for (const x of athletes) {
    if (x.removed) continue;
    if (b('first', x.first) !== a('first', x.first) || b('last', x.last) !== a('last', x.last)) ids.add(x.clubId);
  }
  return [...ids];
}

// --- suggestions -------------------------------------------------------------------------------------------

/** Prefixes that are correct as written when followed by a capital (McDonald, DeAngelo, VanDyke, O'Brien). */
export const KEEP_PREFIXES = ['Mc', 'Mac', 'De', 'Di', 'Da', 'Du', 'La', 'Le', 'Lo', 'Van', 'Von', "O'"];

const LOWER = /\p{Ll}/u;
const UPPER = /\p{Lu}/u;

/** Spaces to insert into one word, or null when it needs none. */
function splitWord(word: string): string | null {
  const chars = [...word];
  const breaks: number[] = [];
  let segStart = 0;
  for (let i = 1; i < chars.length; i++) {
    if (!UPPER.test(chars[i]) || !LOWER.test(chars[i - 1])) continue;
    // A keep-prefix that is the whole segment so far (DeAngelo, McDonald, DeLaCruz) is not a word break.
    const keep = KEEP_PREFIXES.includes(chars.slice(segStart, i).join(''));
    segStart = i;
    if (!keep) breaks.push(i);
  }
  if (breaks.length === 0) return null;
  let out = '';
  let prev = 0;
  for (const b of breaks) { out += `${chars.slice(prev, b).join('')} `; prev = b; }
  return out + chars.slice(prev).join('');
}

/** "MurrayMetzger" -> "Murray Metzger"; a name with nothing to split -> null. Each word is looked at on its own. */
export function suggestSplit(name: string): string | null {
  let changed = false;
  const words = tidy(name).split(' ').map((w) => {
    const s = splitWord(w);
    if (s === null) return w;
    changed = true;
    return s;
  });
  return changed ? words.join(' ') : null;
}

export interface NameFixSuggestion extends NameFix {
  /** Non-removed athletes with this name. */
  count: number;
}

/**
 * Suggest fixes for last names and first names that look squashed together: an inner capital directly after a lowercase
 * letter, except after a prefix that is right as written (Mc, Mac, De, Di, Da, Du, La, Le, Lo, Van, Von, O'). One suggestion
 * per field and compact name, with the number of athletes it would change. Names that already have a fix are skipped.
 * These are only suggestions: nothing applies until the host accepts one.
 */
export function suggestNameFixes(athletes: AthleteLike[], fixes: NameFix[] = []): NameFixSuggestion[] {
  const have = new Set(fixes.map((f) => `${f.field}|${compactName(f.from)}`));
  const found = new Map<string, { field: NameField; names: Map<string, number>; count: number }>();
  for (const a of athletes) {
    if (a.removed) continue;
    for (const field of ['last', 'first'] as NameField[]) {
      const name = tidy(a[field]);
      const key = `${field}|${compactName(name)}`;
      if (!compactName(name) || have.has(key) || suggestSplit(name) === null) continue;
      const e = found.get(key) ?? { field, names: new Map(), count: 0 };
      e.names.set(name, (e.names.get(name) ?? 0) + 1);
      e.count++;
      found.set(key, e);
    }
  }
  const out: NameFixSuggestion[] = [];
  for (const e of found.values()) {
    // The most common exact spelling is the "from" (ties: first seen).
    const from = [...e.names.entries()].sort((x, y) => y[1] - x[1])[0][0];
    out.push({ field: e.field, from, to: suggestSplit(from)!, count: e.count });
  }
  return out.sort((x, y) => (x.field === y.field ? 0 : x.field === 'last' ? -1 : 1) || x.from.localeCompare(y.from, 'en', { sensitivity: 'base' }));
}
