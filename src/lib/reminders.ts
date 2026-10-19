// Pure: who gets which reminder (spec §7).
//  - split: clubs with at least one level over one squad's cap that they have not kept or changed. They get ONLY the split email.
//  - az:    clubs with no split pending and at least one MAG/WAG session still in the default A-Z order. The email lists only those sessions.
// Clubs with no contact email are listed separately and are never sent to. T&T ("Set by UCG"), "Nothing to order" and "Order set" get nothing.
import type { ClubRow } from './club-overview';

export type ReminderKind = 'az' | 'split';

export interface ReminderEntry {
  clubId: string;
  clubName: string;
  emails: string[];
  /** az: the sessions still A-Z. split: the sessions that have a level to split. */
  sessions: { sessionId: string; label: string }[];
  /** split only: the levels that are too big. */
  levels: { sessionLabel: string; levelName: string; count: number }[];
}

export interface Reminders {
  az: ReminderEntry[];
  split: ReminderEntry[];
  /** Clubs that would be reminded but have no contact email: "No email — add one above". */
  noEmail: Record<ReminderKind, ReminderEntry[]>;
}

export const REMINDER_LABEL: Record<ReminderKind, string> = { az: 'Still A–Z', split: 'Needs to decide a split' };

export function buildReminders(rows: ClubRow[]): Reminders {
  const out: Reminders = { az: [], split: [], noEmail: { az: [], split: [] } };
  for (const r of rows) {
    const splitLevels = r.sessions.flatMap((s) => s.levels.filter((l) => l.status === 'split').map((l) => ({ sessionLabel: s.label, levelName: l.name, count: l.count })));
    let kind: ReminderKind | null = null;
    let entry: ReminderEntry | null = null;
    const base = { clubId: r.id, clubName: r.name, emails: r.emails };
    if (splitLevels.length > 0) {
      kind = 'split';
      entry = { ...base, sessions: r.sessions.filter((s) => s.status === 'split').map((s) => ({ sessionId: s.sessionId, label: s.label })), levels: splitLevels };
    } else {
      const still = r.sessions.filter((s) => s.status === 'default');
      if (still.length > 0) {
        kind = 'az';
        entry = { ...base, sessions: still.map((s) => ({ sessionId: s.sessionId, label: s.label })), levels: [] };
      }
    }
    if (!kind || !entry) continue;
    (r.emails.length > 0 ? out[kind] : out.noEmail[kind]).push(entry);
  }
  return out;
}

/** `a`, `a and b`, `a, b and c`. */
export function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

/** "a@x.org; b@y.org, c@z.org" -> unique lower-cased addresses, and whatever did not look like an address. */
export function parseEmails(raw: string): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const piece of raw.split(/[;,\s]+/).map((p) => p.trim()).filter(Boolean)) {
    const e = piece.toLowerCase();
    if (!EMAIL.test(e)) invalid.push(piece);
    else if (!emails.includes(e)) emails.push(e);
  }
  return { emails, invalid };
}
