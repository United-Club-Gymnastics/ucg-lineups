// Copied from ucg-platform@5824208e supabase/functions/_shared/session-date.ts — keep in sync by hand
// _shared/session-date.ts — ISO session-date display helpers, shared by the client (src/lib/meet-exports/schedule.ts and
// src/lib/session-sheets.ts re-export them) and the session reminder edge function. PURE (no Deno / network imports).

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

/** `2027-04-09` -> `Friday, April 9, 2027`; '' for a blank date; free text is returned as typed. */
export function sessionDateText(date: string | null | undefined): string {
  const d = (date ?? '').trim();
  if (!d) return '';
  const day = weekdayOf(d);
  const formatted = formatDate(d);
  return day ? `${day}, ${formatted}` : formatted;
}
