// Copied from ucg-platform@5824208e supabase/functions/_shared/session-time.ts — keep in sync by hand
// _shared/session-time.ts — session time display helpers, shared by the client (src/lib/session-time.ts re-exports them)
// and the session reminder email. PURE (no Deno / network imports).

/** Session start times are stored as 24-hour "HH:MM" text (the `<input type="time">`
 *  value). Display them as "9:00 AM" / "2:00 PM" everywhere (UAT R-03, 2026-10-13).
 *  Accepts "H:MM", "HH:MM" and "HH:MM:SS"; returns '' for empty and the raw string
 *  for anything that doesn't parse. Storage format is unchanged. */
export function fmtSessionTime(time: string | null | undefined): string {
  if (!time) return '';
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!m) return time;
  const h = Number(m[1]);
  if (h > 23) return time;
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m[2]} ${suffix}`;
}


/**
 * "Open stretch 8:00 AM · Warm-ups 8:30 AM · Competition 8:45 AM · Est. end 12:30 PM" - only the parts that are set.
 * `onlyWhenExtras`: '' when none of stretch / warm-ups / end is set (a plain session keeps its existing display).
 * `includeCompetition: false` leaves the competition time out, for places that already show the start time next to the line.
 */
export function sessionTimesLine(
  s: { time?: string | null; stretchTime?: string | null; warmupTime?: string | null; endTime?: string | null },
  opts: { onlyWhenExtras?: boolean; includeCompetition?: boolean } = {},
): string {
  const { onlyWhenExtras = false, includeCompetition = true } = opts;
  const extras = !!(s.stretchTime || s.warmupTime || s.endTime);
  if (onlyWhenExtras && !extras) return '';
  const parts: string[] = [];
  if (s.stretchTime) parts.push(`Open stretch ${fmtSessionTime(s.stretchTime)}`);
  if (s.warmupTime) parts.push(`Warm-ups ${fmtSessionTime(s.warmupTime)}`);
  if (includeCompetition && s.time) parts.push(`Competition ${fmtSessionTime(s.time)}`);
  if (s.endTime) parts.push(`Est. end ${fmtSessionTime(s.endTime)}`);
  return parts.join(' · ');
}
