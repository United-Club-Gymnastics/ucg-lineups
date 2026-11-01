// Pure: the athletes' Session details emails as ONE iContact list and ONE email (Julia 2026-10-31: coaches are sent from Lineups,
// athletes through iContact so everything can be scheduled for one day without Gmail's daily limit). iContact keeps one contact
// per address; an athlete is in at most one session per discipline, so each contact carries one set of fields per discipline,
// the same custom fields as last year's iContact email (Julia 2026-10-31, reused each year: last year's people are not emailed
// again): `[wagsession]` (the session's name), `[wagrotation]` and `[wagscorecard]` (links to its sheets page), and the same for
// mag and tnt. `[wagtimes]` is new (Julia 2026-11-01): the date and the open stretch time, when athletes should arrive. A
// discipline the contact is not in is blank, and the email shows nothing for it.
//  - `<meet> - contacts.csv`: Email, First Name, Last Name, then the twelve fields.
//  - `<meet> - email.html`: the email as a whole HTML page, with the merge tags in it.
//  - `How to use.txt`: the steps and the field names.
// The people are the athlete emails in Send, so an athlete who is also a coach in a session is left out of that session (Lineups
// sends them the coach email). Two people sharing an address become one contact ("Ava & Mia"); if they are in two sessions of
// the same discipline, the contact gets the first and How to use.txt lists the address so the admin can sort it out.
import { emailButtonHtml, renderEmail } from './email/email-layout';
import { fillReminderPlaceholders, type ReminderContext, type ReminderTemplate } from './email/session-reminder-email';
import type { StoredAthlete } from './import/diff';
import type { Discipline } from './apparatus';
import type { Session } from './import/types';
import type { StoredClub } from './data/plan';
import { sessionDateText } from './email/session-date';
import { formatTime, type ScheduleFields } from './schedule';
import { buildSessionRecipients, publicSheetUrl, sessionEmailLabel } from './session-details';

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
  /** Contacts in more than one session (more than one discipline). */
  multiSession: number;
  /** Addresses with two sessions in one discipline (two people sharing it): only the first is in the list. */
  clashes: string[];
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

/** Last year's iContact custom fields, one set per discipline. */
const FIELD_KEY: Record<Discipline, string> = { WAG: 'wag', MAG: 'mag', TNT: 'tnt' };
const DISCIPLINES: Discipline[] = ['WAG', 'MAG', 'TNT'];
export const ICONTACT_FIELDS = DISCIPLINES.flatMap((d) => ['session', 'times', 'rotation', 'scorecard'].map((f) => `${FIELD_KEY[d]}${f}`));

/** The times field: the date and the open stretch time (when athletes arrive), e.g. "Friday, April 9, 2027 · Open stretch
 *  7:30 AM". Only the parts that are set. */
export function icontactTimesText(schedule: ScheduleFields | undefined): string {
  if (!schedule) return '';
  const stretch = formatTime(schedule.stretch);
  return [sessionDateText(schedule.date), stretch && `Open stretch ${stretch}`].filter(Boolean).join(' · ');
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

/** The email: the saved template's text around the merge tags. `{session}` reads "Session"; the template's date and times
 *  are blank (the times field under each session has them). The scorecard fields are in the list for iContact but not used here: the page switches between the
 *  rotation sheet and scorecards. Tags are inserted as given, not escaped: they are the admin's own text. */
function buildEmail(t: ReminderTemplate, meetName: string, first: string) {
  const ctx: ReminderContext = {
    eventName: meetName || 'UCG', sessionLabel: 'Session', dateText: '', times: {}, firstName: first, recipient: 'athlete',
    rotationUrl: '', scorecardsUrl: '',
  };
  const fill = (s: string) => multiline(fillReminderPlaceholders(esc(s), ctx, esc));
  const subject = fillReminderPlaceholders(t.subject, ctx).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const html: string[] = [];
  html.push(`<p style="${P}color:${NAVY};font-size:16px;font-weight:700;">Hello ${first}!</p>`);
  if (t.intro.trim()) html.push(`<p style="${P}">${fill(t.intro)}</p>`);
  // Each session's name links to its sheets page, with its date and arrival time under it. A discipline the contact is not in
  // has blank fields, so nothing shows (an empty div has no height).
  html.push(`<div style="background:${PANEL};border-radius:8px;padding:12px 16px;margin:0 0 14px;color:${NAVY};">
<div style="font-weight:700;margin:0 0 6px;">Your sessions</div>
${DISCIPLINES.map((d) => `<div><a href="[${FIELD_KEY[d]}rotation]" style="color:${LINK};font-weight:700;text-decoration:underline;">[${FIELD_KEY[d]}session]</a></div>
<div style="font-size:14px;margin:0 0 6px;">[${FIELD_KEY[d]}times]</div>`).join('\n')}
<div style="margin:8px 0 0;font-size:14px;">Please arrive by the open stretch time. Each session opens its page with all the times, the rotation sheet and the scorecards.</div>
</div>`);
  if (t.facilityNote.trim()) html.push(`<p style="${P}">${fill(t.facilityNote)}</p>`);
  html.push(`<h2 style="${H}">Competition Documents</h2>`);
  html.push(`<p style="${P}"><b style="color:${NAVY};">Rotation Sheet:</b> ${fill(t.rotationNote)}</p>`);
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
  /** In display order. */
  sessions: Session[];
  /** Each session's schedule, by session id. */
  schedules: Record<string, ScheduleFields>;
  athletes: StoredAthlete[];
  clubs: Pick<StoredClub, 'id' | 'name' | 'contacts'>[];
  coachRoles: string[];
  template: ReminderTemplate;
  firstNameTag?: string;
}): IcontactExport {
  const first = input.firstNameTag?.trim() || ICONTACT_FIRST_NAME_TAG;
  const byId = new Map(input.athletes.map((a) => [a.id, a]));
  // One contact per address, in the order first met (session order, then the athletes' order in it).
  const people = new Map<string, { first: string[]; last: string; sessions: Partial<Record<Discipline, Session>> }>();
  const clashes = new Set<string>();
  for (const session of input.sessions) {
    const { athletes } = buildSessionRecipients({ sessionId: session.id, athletes: input.athletes, clubs: input.clubs, coachRoles: input.coachRoles });
    for (const r of athletes) {
      const email = r.email.trim().toLowerCase();
      const p = people.get(email) ?? people.set(email, { first: [], last: byId.get(r.key.slice(2))?.last ?? '', sessions: {} }).get(email)!;
      if (!p.first.includes(r.firstName)) p.first.push(r.firstName);
      const had = p.sessions[session.discipline];
      if (!had) p.sessions[session.discipline] = session;
      else if (had.id !== session.id) clashes.add(email);
    }
  }
  const rows = [csvLine(['Email', 'First Name', 'Last Name', ...ICONTACT_FIELDS])];
  for (const [email, p] of people) {
    const cells = DISCIPLINES.flatMap((d) => {
      const s = p.sessions[d];
      return s
        ? [sessionEmailLabel(s), icontactTimesText(input.schedules[s.id]), publicSheetUrl(input.linkBase, input.meetId, s.id, 'rotation'), publicSheetUrl(input.linkBase, input.meetId, s.id, 'scorecards')]
        : ['', '', '', ''];
    });
    rows.push(csvLine([email, p.first.join(' & '), p.first.length > 1 ? '' : p.last, ...cells]));
  }
  const csv = rows.join('\r\n') + '\r\n';
  const email = buildEmail(input.template, input.meetName, first);
  const base = fileSafe(input.meetName) || 'Meet';
  const multiSession = [...people.values()].filter((p) => Object.keys(p.sessions).length > 1).length;
  const howTo = [
    `${input.meetName || 'Meet'}: athlete Session details for iContact`,
    '',
    `1. Import "${base} - contacts.csv" into iContact as one new list. Match Email, First Name and Last Name to iContact's`,
    `   fields, and each other column to the custom field of the same name. Last year's fields are reused; the three`,
    `   *times fields (date and open stretch time) are new, so add them in iContact first:`,
    `     ${ICONTACT_FIELDS.join(', ')}`,
    `   Importing fills them with this year's sessions; a discipline the athlete is not in is blank.`,
    `2. Make a new message, paste in the HTML from "${base} - email.html", and use this subject:`,
    `     ${email.subject}`,
    `3. Send yourself a test, then schedule it to the list.`,
    '',
    `${people.size} contacts; ${multiSession} of them are in more than one discipline.`,
    ...(clashes.size
      ? ['', `These addresses have two people in different sessions of the same discipline. The list has only the first session; send the other by hand:`, ...[...clashes].map((e) => `     ${e}`)]
      : []),
    'Publish sheets in Lineups before the email goes out, so the links work.',
    '',
  ].join('\r\n');
  return {
    files: [
      { name: `${base} - contacts.csv`, content: csv },
      { name: `${base} - email.html`, content: email.html },
      { name: 'How to use.txt', content: howTo },
    ],
    fields: ICONTACT_FIELDS, subject: email.subject, csv, html: email.html, contacts: people.size, multiSession, clashes: [...clashes],
  };
}
