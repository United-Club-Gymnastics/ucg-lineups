// Pure: the order deadline is entered and shown as a Pacific wall-clock time (America/Los_Angeles, daylight saving handled).
const ZONE = 'America/Los_Angeles';

function parts(ms: number, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: ZONE, ...opts }).formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** Pacific offset from UTC in minutes at an instant (negative: -420 in summer, -480 in winter). */
function offsetMinutes(ms: number): number {
  const p = parts(ms, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** `2026-03-27` + `23:59` as Pacific wall-clock time -> the instant. null when either part is missing or invalid. */
export function pacificToDate(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return null;
  const [y, mo, da, h, mi] = [+d[1], +d[2], +d[3], +t[1], +t[2]];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, da, h, mi);
  if (new Date(wall).getUTCMonth() !== mo - 1) return null; // e.g. Feb 31
  // The offset depends on the instant, so settle it in two passes (correct except for the nonexistent hour at the spring change).
  let guess = wall - offsetMinutes(wall) * 60000;
  guess = wall - offsetMinutes(guess) * 60000;
  return new Date(guess);
}

/** The Pacific date (`yyyy-mm-dd`) and time (`HH:mm`) of an instant, for the date/time inputs. */
export function dateToPacific(d: Date): { date: string; time: string } {
  const p = parts(d.getTime(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** `Fri Mar 27, 11:59 PM PT` */
export function formatDeadline(d: Date): string {
  const p = parts(d.getTime(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  return `${p.weekday} ${p.month} ${p.day}, ${p.hour}:${p.minute} ${p.dayPeriod} PT`;
}

/** The Pacific calendar day of an instant (`yyyy-mm-dd`): what "today" means for "already sent today". */
export function pacificDay(d: Date): string {
  return dateToPacific(d).date;
}

/** `Oct 18, 3:40 PM PT` for the "last change" and log columns. */
export function formatWhen(d: Date | number): string {
  const ms = typeof d === 'number' ? d : d.getTime();
  const p = parts(ms, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  return `${p.month} ${p.day}, ${p.hour}:${p.minute} ${p.dayPeriod} PT`;
}
