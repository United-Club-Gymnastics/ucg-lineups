// Pure: the public sheets page's data (Julia 2026-10-30). "Publish sheets" on the Exports screen writes one document per session,
// `meets/{meetId}/publicSheets/{sessionId}` (public `get`, no `list`): the session's export input exactly as the Exports screen
// built it, so the page draws the same rotation sheet and scorecards and downloads the same PDF. The Session details email links
// here. It holds what the sheets print (names, full club names, levels, squads, order, date and times) and nothing else: the
// export input is built from named fields only (no emails or contacts), which `publicSheetDoc` checks again. Athlete ids are
// replaced by opaque ones first: an id carries the birth date when two athletes in a club share a name (review of PR #8).
import type { SessionExportInput } from './pdf/collate';

export const PUBLIC_SHEET_VERSION = 1;

export interface PublicSheetDoc {
  v: number;
  /** `Session 1 – Orange`. */
  title: string;
  /** The export input as JSON: Firestore cannot store its nested arrays directly. */
  input: string;
}

export interface PublicSheet {
  title: string;
  input: SessionExportInput;
  /** When it was last published; null when unknown. */
  publishedAt: Date | null;
}

const EMAIL = /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
/** An athlete id (`WAG_<club>_<name>`, maybe `_<birth date>`, maybe `~<n>`), alone or inside a card key. */
const ATHLETE_ID = /\b(?:WAG|MAG|TNT)_[a-z0-9-]+_[a-z0-9-]+(?:_\d{4}-\d{2}-\d{2})?(?:~\d+)?/g;

/**
 * Every athlete id in the JSON becomes `p00001`, `p00002`… The numbers follow the ids' own order (`localeCompare`, as the sheets'
 * tiebreaks use), so the same id always maps the same way and the pages come out identical.
 */
export function anonymizeIds(json: string): string {
  const ids = [...new Set(json.match(ATHLETE_ID) ?? [])].sort((a, b) => a.localeCompare(b));
  const to = new Map(ids.map((id, i) => [id, `p${String(i + 1).padStart(5, '0')}`]));
  return json.replace(ATHLETE_ID, (id) => to.get(id)!);
}

/** The document for one session, athlete ids made opaque. Throws if anything that looks like an email address or a date
 *  (`yyyy-mm-dd`, e.g. a birth date) is left in the input. */
export function publicSheetDoc(title: string, input: SessionExportInput): PublicSheetDoc {
  const json = anonymizeIds(JSON.stringify(input));
  if (EMAIL.test(json)) throw new Error(`${title}: the sheet data contains an email address, so it was not published.`);
  if (ISO_DATE.test(json)) throw new Error(`${title}: the sheet data contains a date like a birth date, so it was not published.`);
  return { v: PUBLIC_SHEET_VERSION, title, input: json };
}

/** A stored document, or null when it is missing, from a newer version, or not readable. */
export function parsePublicSheet(raw: unknown): PublicSheet | null {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!d || d.v !== PUBLIC_SHEET_VERSION || typeof d.title !== 'string' || typeof d.input !== 'string') return null;
  let input: SessionExportInput;
  try {
    input = JSON.parse(d.input) as SessionExportInput;
  } catch {
    return null;
  }
  if (!input || (input.type !== 'artistic' && input.type !== 'tnt') || !input.input) return null;
  const at = d.publishedAt as { toDate?: () => Date } | undefined;
  return { title: d.title, input, publishedAt: at && typeof at.toDate === 'function' ? at.toDate() : null };
}

export type SheetKind = 'rotation' | 'scorecards';

/** `?doc=` on the page: rotation sheet unless it says scorecards. */
export const sheetKindOf = (q: string | null): SheetKind => (q === 'scorecards' ? 'scorecards' : 'rotation');
