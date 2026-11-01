// Pure: the athletes' Session details emails for iContact, ONE list and ONE email per discipline (Julia 2026-11-01: WAG, MAG and
// T&T have different instructions; coaches are sent from Lineups, athletes through iContact so everything can be scheduled for
// one day without Gmail's daily limit). An athlete is in at most one session per discipline, so each list's contacts carry that
// discipline's custom fields, the same as last year's iContact email (reused each year: last year's people are not emailed
// again): `[wagsession]` (the session's name), `[wagrotation]` and `[wagscorecard]` (links to its sheets page), and the same for
// mag and tnt. `[wagtimes]` is new (Julia 2026-11-01): the date and the open stretch time, when athletes should arrive. Fields of
// different disciplines never overlap, so a contact on two lists keeps both sets.
//  - `<meet> - WAG contacts.csv`: Email, First Name, Last Name, then the four wag fields. Same for MAG and T&T.
//  - `<meet> - WAG email.html`: the Lineups athlete email from that discipline's saved text, with the merge tags in it.
//  - `How to use.txt`: the steps and the field names.
// The people are the athlete emails in Send, so an athlete who is also a coach in a session is left out of that session (Lineups
// sends them the coach email). Two people sharing an address become one contact ("Ava & Mia"); if they are in two sessions of
// the same discipline, the contact gets the first and How to use.txt lists the address so the admin can sort it out.
import { buildSessionReminderEmail, fillReminderPlaceholders, type ReminderTemplate } from './email/session-reminder-email';
import { sessionDateText } from './email/session-date';
import type { StoredAthlete } from './import/diff';
import type { Discipline } from './apparatus';
import type { Session } from './import/types';
import type { StoredClub } from './data/plan';
import { formatTime, type ScheduleFields } from './schedule';
import { buildSessionRecipients, DISCIPLINE_LABEL, publicSheetUrl, SESSION_DISCIPLINES, sessionEmailLabel, type SessionTemplates } from './session-details';

/** iContact's first-name personalization tag. The screen lets the admin change it. */
export const ICONTACT_FIRST_NAME_TAG = '[fname]';

export interface IcontactFile {
  name: string;
  content: string;
}

export interface IcontactList {
  discipline: Discipline;
  /** `UCG Nationals 2027 - WAG`: the list name to create in iContact. */
  list: string;
  fields: string[];
  subject: string;
  contacts: number;
  csv: string;
  html: string;
  /** Addresses with two sessions in this discipline (two people sharing it): only the first is in the list. */
  clashes: string[];
}

export interface IcontactExport {
  files: IcontactFile[];
  /** One per discipline with athletes, in WAG, MAG, T&T order. */
  lists: IcontactList[];
  /** Different addresses across the lists. */
  people: number;
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

/** Last year's iContact custom fields (plus the new times field), one set per discipline. */
const FIELD_KEY: Record<Discipline, string> = { WAG: 'wag', MAG: 'mag', TNT: 'tnt' };
export const icontactFields = (d: Discipline): string[] => ['session', 'times', 'rotation', 'scorecard'].map((f) => `${FIELD_KEY[d]}${f}`);
export const ICONTACT_FIELDS = SESSION_DISCIPLINES.flatMap(icontactFields);

/** The times field: the date and the open stretch time (when athletes arrive), e.g. "Friday, April 9, 2027 · Open stretch
 *  7:30 AM". Only the parts that are set. */
export function icontactTimesText(schedule: ScheduleFields | undefined): string {
  if (!schedule) return '';
  const stretch = formatTime(schedule.stretch);
  return [sessionDateText(schedule.date), stretch && `Open stretch ${stretch}`].filter(Boolean).join(' · ');
}

// Stand-ins for the two links: the email builder only links http(s) addresses, so these go in and are swapped for the tags.
const ROTATION_STANDIN = 'https://icontact-rotation.invalid/';
const SCORECARDS_STANDIN = 'https://icontact-scorecards.invalid/';

/** The discipline's email: the same as the Lineups athlete email, with the merge tags where that session's details go. The
 *  subject says the discipline instead of the session (e.g. "UCG Nationals 2027: WAG Session Information"). */
function buildEmail(t: ReminderTemplate, meetName: string, d: Discipline, first: string) {
  const k = FIELD_KEY[d];
  const ctx = {
    eventName: meetName || 'UCG', sessionLabel: `[${k}session]`, dateText: `[${k}times]`, times: {}, firstName: first, recipient: 'athlete' as const,
    rotationUrl: ROTATION_STANDIN, scorecardsUrl: SCORECARDS_STANDIN,
  };
  const built = buildSessionReminderEmail(t, ctx);
  const subject = fillReminderPlaceholders(t.subject, { ...ctx, sessionLabel: `${DISCIPLINE_LABEL[d]} Session` }).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const body = built.html.split(ROTATION_STANDIN).join(`[${k}rotation]`).split(SCORECARDS_STANDIN).join(`[${k}scorecard]`);
  const title = subject.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return {
    subject,
    html: `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${title}</title>\n</head>\n<body style="margin:0;padding:0;">\n${body}\n</body>\n</html>\n`,
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
  templates: SessionTemplates;
  firstNameTag?: string;
}): IcontactExport {
  const first = input.firstNameTag?.trim() || ICONTACT_FIRST_NAME_TAG;
  const byId = new Map(input.athletes.map((a) => [a.id, a]));
  const base = fileSafe(input.meetName) || 'Meet';
  const lists: IcontactList[] = [];
  const everyone = new Set<string>();
  for (const d of SESSION_DISCIPLINES) {
    const sessions = input.sessions.filter((s) => s.discipline === d);
    // One contact per address, in the order first met (session order, then the athletes' order in it).
    const people = new Map<string, { first: string[]; last: string; session: Session }>();
    const clashes = new Set<string>();
    for (const session of sessions) {
      const { athletes } = buildSessionRecipients({ sessionId: session.id, athletes: input.athletes, clubs: input.clubs, coachRoles: input.coachRoles });
      for (const r of athletes) {
        const email = r.email.trim().toLowerCase();
        const p = people.get(email) ?? people.set(email, { first: [], last: byId.get(r.key.slice(2))?.last ?? '', session }).get(email)!;
        if (!p.first.includes(r.firstName)) p.first.push(r.firstName);
        if (p.session.id !== session.id) clashes.add(email);
      }
    }
    if (!people.size) continue;
    const fields = icontactFields(d);
    const rows = [csvLine(['Email', 'First Name', 'Last Name', ...fields])];
    for (const [email, p] of people) {
      const s = p.session;
      everyone.add(email);
      rows.push(csvLine([
        email, p.first.join(' & '), p.first.length > 1 ? '' : p.last,
        sessionEmailLabel(s), icontactTimesText(input.schedules[s.id]),
        publicSheetUrl(input.linkBase, input.meetId, s.id, 'rotation'), publicSheetUrl(input.linkBase, input.meetId, s.id, 'scorecards'),
      ]));
    }
    const email = buildEmail(input.templates[d], input.meetName, d, first);
    lists.push({
      discipline: d, list: `${base} - ${DISCIPLINE_LABEL[d]}`, fields, subject: email.subject, contacts: people.size,
      csv: rows.join('\r\n') + '\r\n', html: email.html, clashes: [...clashes],
    });
  }
  const file = (l: IcontactList, what: string) => `${base} - ${DISCIPLINE_LABEL[l.discipline].replace('&', 'and')} ${what}`;
  const howTo = [
    `${input.meetName || 'Meet'}: athlete Session details for iContact, one list and one email per discipline`,
    '',
    `Before importing: iContact needs these custom fields. The session, rotation and scorecard ones are last year's; the`,
    `times ones (date and open stretch time) are new, so add them if they aren't there yet:`,
    `     ${ICONTACT_FIELDS.join(', ')}`,
    '',
    ...lists.flatMap((l) => [
      `${DISCIPLINE_LABEL[l.discipline]}: ${l.contacts} contacts`,
      `1. Import "${file(l, 'contacts.csv')}" as a new list named "${l.list}". Match Email, First Name and Last Name to`,
      `   iContact's fields, and each other column to the custom field of the same name (${l.fields.join(', ')}).`,
      `2. Make a new message, paste in the HTML from "${file(l, 'email.html')}", and use this subject:`,
      `     ${l.subject}`,
      `3. Send yourself a test, then schedule it to the "${l.list}" list.`,
      ...(l.clashes.length
        ? [`These addresses have two people in different ${DISCIPLINE_LABEL[l.discipline]} sessions. The list has only the first session; send the other by hand:`, ...l.clashes.map((e) => `     ${e}`)]
        : []),
      '',
    ]),
    `${everyone.size} different addresses in all: an athlete in two disciplines is on both lists and gets both emails.`,
    'Publish sheets in Lineups before the emails go out, so the links work.',
    '',
  ].join('\r\n');
  return {
    files: [
      ...lists.flatMap((l) => [{ name: file(l, 'contacts.csv'), content: l.csv }, { name: file(l, 'email.html'), content: l.html }]),
      { name: 'How to use.txt', content: howTo },
    ],
    lists,
    people: everyone.size,
  };
}
