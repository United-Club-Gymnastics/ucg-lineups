// Pure: the athletes' Session details emails as ONE iContact list and ONE email (Julia 2026-10-31: coaches are sent from Lineups,
// athletes through iContact so everything can be scheduled for one day without Gmail's daily limit). iContact keeps one contact
// per address, and an athlete in two or three disciplines is in that many sessions, so each contact carries its sessions in
// custom fields and the email fills them in with merge tags:
//  - `<meet> - contacts.csv`: Email, First Name, Last Name, then `<prefix>_session1`… (one line per session: name, date, times)
//    and `<prefix>_sheets` (a link to that session's sheets page, or to a page listing all of the person's sessions). The prefix
//    comes from the meet name, so next year's meet gets new fields and this year's stay as they were (Julia 2026-10-31).
//  - `<meet> - email.html`: the email as a whole HTML page, with the merge tags in it.
//  - `How to use.txt`: the steps and the field names.
// The people are the athlete emails in Send, so an athlete who is also a coach in a session is left out of that session (Lineups
// sends them the coach email). Two people sharing an address become one contact ("Ava & Mia") with both their sessions.
import { emailButtonHtml, renderEmail } from './email/email-layout';
import { fillReminderPlaceholders, type ReminderContext, type ReminderTemplate } from './email/session-reminder-email';
import { sessionDateText } from './email/session-date';
import { fmtSessionTime } from './email/session-time';
import type { StoredAthlete } from './import/diff';
import type { Session } from './import/types';
import type { StoredClub } from './data/plan';
import { buildSessionRecipients, publicSessionsUrl, publicSheetUrl, sessionEmailLabel } from './session-details';
import type { ScheduleFields } from './schedule';

/** iContact's first-name personalization tag. The screen lets the admin change it. */
export const ICONTACT_FIRST_NAME_TAG = '[fname]';

export interface IcontactFile {
  name: string;
  content: string;
}

export interface IcontactExport {
  files: IcontactFile[];
  /** The custom fields to create in iContact, in column order. */
  fields: string[];
  subject: string;
  csv: string;
  html: string;
  /** Contacts (rows) in the list. */
  contacts: number;
  /** Contacts in more than one session. */
  multiSession: number;
}

/** One CSV cell: quoted when it holds a comma, quote or line break; a leading = + - @ is prefixed with ' so a spreadsheet
 *  never runs it as a formula. */
export function csvCell(v: string): string {
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: string[]): string => cells.map(csvCell).join(',');

/** A file name: no characters that are awkward on Windows or in a zip. */
export const fileSafe = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();

/** The custom-field prefix from the meet name: `UCG Nationals 2027` -> `ucgnationals2027`. Lowercase letters and digits only. */
export const fieldPrefix = (meetName: string): string => meetName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 30) || 'meet';

/** `Session 3 - Orange (WAG): Friday, April 9, 2027 | Open stretch 7:30 AM | Warm-ups 8:00 AM | Competition 8:45 AM` (plain ASCII separators: the CSV goes through iContact's import). */
export function sessionLine(session: Session, schedule: ScheduleFields): string {
  const times: [string, string][] = [['Open stretch', schedule.stretch], ['Warm-ups', schedule.warmups], ['Competition', schedule.competition]];
  const when = [sessionDateText(schedule.date), ...times.map(([l, t]) => [l, fmtSessionTime(t)]).filter(([, t]) => t).map(([l, t]) => `${l} ${t}`)];
  const rest = when.filter(Boolean).join(' | ');
  return rest ? `${sessionEmailLabel(session)}: ${rest}` : sessionEmailLabel(session);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const multiline = (h: string) => h.replace(/\r?\n/g, '<br>');

// The same look as the Session details email (session-reminder-email.ts).
const NAVY = '#1E2B38';
const CALLOUT_FILL = '#faebbc';
const PANEL = '#eef1f4';
const LINK = '#bd3f27';
const P = 'margin:0 0 14px;';
const H = `color:${NAVY};font-size:16px;font-weight:700;margin:22px 0 8px;`;

/** The email: the saved template's text around the merge tags. `{session}` reads "Session", date and times are blank (each
 *  session's line has them). Tags are inserted as given, not escaped: they are the admin's own text. */
function buildEmail(t: ReminderTemplate, meetName: string, tags: { first: string; sessions: string[]; sheets: string }) {
  const ctx: ReminderContext = {
    eventName: meetName || 'UCG', sessionLabel: 'Session', dateText: '', times: {}, firstName: tags.first, recipient: 'athlete',
    rotationUrl: '', scorecardsUrl: '',
  };
  const fill = (s: string) => multiline(fillReminderPlaceholders(esc(s), ctx, esc));
  const subject = fillReminderPlaceholders(t.subject, ctx).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const html: string[] = [];
  html.push(`<p style="${P}color:${NAVY};font-size:16px;font-weight:700;">Hello ${tags.first}!</p>`);
  if (t.intro.trim()) html.push(`<p style="${P}">${fill(t.intro)}</p>`);
  // An empty field leaves an empty line, so contacts with one session see one line.
  html.push(`<div style="background:${PANEL};border-radius:8px;padding:12px 16px;margin:0 0 14px;color:${NAVY};">
<div style="font-weight:700;margin:0 0 6px;">Your session details</div>
${tags.sessions.map((s) => `<div style="margin:0 0 4px;">${s}</div>`).join('\n')}
</div>`);
  if (t.facilityNote.trim()) html.push(`<p style="${P}">${fill(t.facilityNote)}</p>`);
  html.push(`<h2 style="${H}">Competition Documents</h2>`);
  html.push(emailButtonHtml({ text: 'Rotation Sheet and Scorecards →', href: tags.sheets }));
  html.push(`<p style="${P}margin-top:14px;"><b style="color:${NAVY};">Rotation Sheet:</b> ${fill(t.rotationNote)}</p>`);
  html.push(`<p style="${P}"><b style="color:${NAVY};">Scorecards:</b> ${fill(t.scorecardsNote)}</p>`);
  if (t.callout.trim()) {
    const btn = t.calloutButton.trim() && /^https?:\/\//i.test(t.calloutUrl) ? emailButtonHtml({ text: fill(t.calloutButton), href: esc(t.calloutUrl) }) : '';
    html.push(`<div style="background:${CALLOUT_FILL};color:${NAVY};border-radius:8px;padding:14px 16px;margin:18px 0;"><div style="font-weight:700;line-height:1.5;">${fill(t.callout)}</div>${btn}</div>`);
  }
  if (t.scheduleNote.trim()) html.push(`<p style="${P}">${fill(t.scheduleNote)}</p>`);
  const bullets = t.reminders.filter((r) => r.trim()).map(fill);
  if (/^https?:\/\//i.test(t.livestreamUrl)) {
    bullets.push(`Don't forget that we will be livestreaming the event <a href="${esc(t.livestreamUrl)}" style="color:${LINK};font-weight:700;text-decoration:underline;">here</a>.`);
  }
  if (bullets.length) html.push(`<h2 style="${H}">Reminders</h2><ul style="margin:0 0 14px;padding-left:20px;">${bullets.map((b) => `<li style="margin:0 0 6px;">${b}</li>`).join('')}</ul>`);
  if (t.signoff.trim()) html.push(`<p style="${P}">${fill(t.signoff)}</p>`);
  const body = renderEmail({
    heading: `${esc(meetName || 'UCG')}: Competition Details`,
    bodyHtml: html.join('\n'),
    footnoteHtml: t.footnote.trim() ? fill(t.footnote) : undefined,
  });
  return {
    subject,
    html: `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(subject)}</title>\n</head>\n<body style="margin:0;padding:0;">\n${body}\n</body>\n</html>\n`,
  };
}

export function icontactAthleteExport(input: {
  meetName: string;
  meetId: string;
  linkBase: string;
  /** In display order: each contact's sessions are listed in this order. */
  sessions: { session: Session; schedule: ScheduleFields }[];
  athletes: StoredAthlete[];
  clubs: Pick<StoredClub, 'id' | 'name' | 'contacts'>[];
  coachRoles: string[];
  template: ReminderTemplate;
  firstNameTag?: string;
  /** Defaults to `fieldPrefix(meetName)`. */
  prefix?: string;
}): IcontactExport {
  const first = input.firstNameTag?.trim() || ICONTACT_FIRST_NAME_TAG;
  const prefix = fieldPrefix(input.prefix?.trim() || input.meetName);
  const byId = new Map(input.athletes.map((a) => [a.id, a]));
  // One contact per address, in the order first met (session order, then the athletes' order in it).
  const people = new Map<string, { first: string[]; last: string; sessions: number[] }>();
  input.sessions.forEach(({ session }, i) => {
    const { athletes } = buildSessionRecipients({ sessionId: session.id, athletes: input.athletes, clubs: input.clubs, coachRoles: input.coachRoles });
    for (const r of athletes) {
      const email = r.email.trim().toLowerCase();
      const p = people.get(email) ?? people.set(email, { first: [], last: byId.get(r.key.slice(2))?.last ?? '', sessions: [] }).get(email)!;
      if (!p.first.includes(r.firstName)) p.first.push(r.firstName);
      if (!p.sessions.includes(i)) p.sessions.push(i);
    }
  });
  const slots = Math.max(1, ...[...people.values()].map((p) => p.sessions.length));
  const sessionFields = Array.from({ length: slots }, (_, i) => `${prefix}_session${i + 1}`);
  const sheetsField = `${prefix}_sheets`;
  const fields = [...sessionFields, sheetsField];
  const lines = input.sessions.map(({ session, schedule }) => sessionLine(session, schedule));
  const rows = [csvLine(['Email', 'First Name', 'Last Name', ...fields])];
  for (const [email, p] of people) {
    const ids = p.sessions.map((i) => input.sessions[i].session.id);
    const link = ids.length === 1 ? publicSheetUrl(input.linkBase, input.meetId, ids[0], 'rotation') : publicSessionsUrl(input.linkBase, input.meetId, ids);
    rows.push(csvLine([email, p.first.join(' & '), p.first.length > 1 ? '' : p.last, ...sessionFields.map((_, s) => (p.sessions[s] === undefined ? '' : lines[p.sessions[s]])), link]));
  }
  const csv = rows.join('\r\n') + '\r\n';
  const email = buildEmail(input.template, input.meetName, { first, sessions: sessionFields.map((f) => `[${f}]`), sheets: `[${sheetsField}]` });
  const base = fileSafe(input.meetName) || 'Meet';
  const multiSession = [...people.values()].filter((p) => p.sessions.length > 1).length;
  const howTo = [
    `${input.meetName || 'Meet'}: athlete Session details for iContact`,
    '',
    `1. In iContact, create these custom fields (text), named exactly:`,
    ...fields.map((f) => `     ${f}`),
    `   They carry the meet name, so last year's fields keep last year's details.`,
    `2. Import "${base} - contacts.csv" as one new list. Match Email, First Name and Last Name to iContact's fields`,
    `   and each ${prefix}_ column to the custom field of the same name.`,
    `3. Make a new message, paste in the HTML from "${base} - email.html", and use this subject:`,
    `     ${email.subject}`,
    `4. Check the merge tags with iContact's personalization menu: ${first} for the first name, and ${fields.map((f) => `[${f}]`).join(', ')}.`,
    `   Send yourself a test, then schedule it to the list.`,
    '',
    `${people.size} contacts; ${multiSession} of them are in more than one session (their link opens a page listing each session).`,
    'Publish sheets in Lineups before the email goes out, so the links work.',
    '',
  ].join('\r\n');
  return {
    files: [
      { name: `${base} - contacts.csv`, content: csv },
      { name: `${base} - email.html`, content: email.html },
      { name: 'How to use.txt', content: howTo },
    ],
    fields, subject: email.subject, csv, html: email.html, contacts: people.size, multiSession,
  };
}
