// Pure: the athletes' Session details emails as files for iContact (Julia 2026-10-31: coaches are sent from Lineups, athletes
// through iContact so every session can be scheduled for one day without Gmail's daily limit). One iContact list per session,
// because iContact keeps one contact per address and an athlete in two or three disciplines is in that many sessions:
//  - `<NN> <session> - contacts.csv`: Email, First Name, Last Name, Club. The same people as the athlete emails in Send, so an
//    athlete who is also a coach in the session is left out (Lineups sends them the coach email). Two people sharing an address
//    in one session become one row ("Ava & Mia").
//  - `<NN> <session> - email.html`: that session's email as a whole HTML page, the first name left as an iContact merge tag.
//  - `Sessions.csv`: one row per session with its list name, the two file names, the subject and how many contacts.
import { buildSessionReminderEmail, type ReminderTemplate } from './email/session-reminder-email';
import type { StoredAthlete } from './import/diff';
import type { Session } from './import/types';
import type { StoredClub } from './data/plan';
import { buildSessionRecipients, sessionEmailContext, sessionEmailLabel } from './session-details';
import type { ScheduleFields } from './schedule';

/** iContact's first-name personalization tag. The screen lets the admin change it. */
export const ICONTACT_FIRST_NAME_TAG = '[fname]';

export interface IcontactFile {
  name: string;
  content: string;
}

export interface IcontactSession {
  /** `Session 2 - Orange (MAG)`: the list name to create in iContact. */
  list: string;
  subject: string;
  contacts: number;
  csv: string;
  html: string;
}

export interface IcontactExport {
  files: IcontactFile[];
  sessions: IcontactSession[];
  /** Rows across every session's list. */
  total: number;
}

/** One CSV cell: quoted when it holds a comma, quote or line break; a leading = + - @ is prefixed with ' so a spreadsheet
 *  never runs it as a formula. */
export function csvCell(v: string): string {
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: string[]): string => cells.map(csvCell).join(',');

/** A file name from a session label: no characters that are awkward on Windows or in a zip. */
export const fileSafe = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();

const page = (subject: string, body: string) =>
  `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${subject.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>\n</head>\n<body style="margin:0;padding:0;">\n${body}\n</body>\n</html>\n`;

export function icontactAthleteExport(input: {
  meetName: string;
  meetId: string;
  linkBase: string;
  /** In display order; numbered 01, 02… so the files sort the same way. */
  sessions: { session: Session; schedule: ScheduleFields }[];
  athletes: StoredAthlete[];
  clubs: Pick<StoredClub, 'id' | 'name' | 'contacts'>[];
  coachRoles: string[];
  template: ReminderTemplate;
  firstNameTag?: string;
}): IcontactExport {
  const tag = input.firstNameTag?.trim() || ICONTACT_FIRST_NAME_TAG;
  const width = Math.max(2, String(input.sessions.length).length);
  const out: IcontactSession[] = [];
  const files: IcontactFile[] = [];
  const index = [csvLine(['#', 'iContact list', 'Contacts file', 'Email file', 'Subject', 'Contacts'])];
  input.sessions.forEach(({ session, schedule }, i) => {
    const list = sessionEmailLabel(session);
    const { athletes } = buildSessionRecipients({ sessionId: session.id, athletes: input.athletes, clubs: input.clubs, coachRoles: input.coachRoles });
    // One row per address: first names joined when two people share one.
    const byEmail = new Map<string, { first: string[]; last: string; club: string }>();
    const byId = new Map(input.athletes.map((a) => [a.id, a]));
    for (const r of athletes) {
      const a = byId.get(r.key.slice(2));
      const row = byEmail.get(r.email);
      if (row) { if (!row.first.includes(r.firstName)) row.first.push(r.firstName); continue; }
      byEmail.set(r.email, { first: [r.firstName], last: a?.last ?? '', club: r.clubName });
    }
    const csv = [csvLine(['Email', 'First Name', 'Last Name', 'Club'])]
      .concat([...byEmail].map(([email, r]) => csvLine([email, r.first.join(' & '), r.first.length > 1 ? '' : r.last, r.club])))
      .join('\r\n') + '\r\n';
    const ctx = sessionEmailContext({
      meetName: input.meetName, meetId: input.meetId, session, schedule, linkBase: input.linkBase,
      recipient: { key: 'icontact', role: 'athlete', name: '', firstName: tag, email: '', clubName: '' },
    });
    const email = buildSessionReminderEmail(input.template, ctx);
    const base = `${String(i + 1).padStart(width, '0')} ${fileSafe(list)}`;
    const html = page(email.subject, email.html);
    files.push({ name: `${base} - contacts.csv`, content: csv }, { name: `${base} - email.html`, content: html });
    index.push(csvLine([String(i + 1), list, `${base} - contacts.csv`, `${base} - email.html`, email.subject, String(byEmail.size)]));
    out.push({ list, subject: email.subject, contacts: byEmail.size, csv, html });
  });
  files.unshift({ name: 'Sessions.csv', content: index.join('\r\n') + '\r\n' });
  return { files, sessions: out, total: out.reduce((n, s) => n + s.contacts, 0) };
}
