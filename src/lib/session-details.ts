// Pure: the "Session details" email (Julia 2026-10-30): who gets it for one session, and what each person's email says. The
// wording, fields and HTML come from the platform's session reminder email (src/lib/email/session-reminder-email.ts, copied).
//  - Athletes: everyone competing in the session with an Athletes_Export email. One email each.
//  - Coaches: the club contacts whose League Communications role the admin counts as a coach. One email per address per
//    session, listing their club's athletes in it by name (the platform's R-02). Independents have no coaches here.
//  - An address that is both an athlete and a coach in the session gets the coach email, without their own name in the list.
//  - People with no address are listed so the admin can follow up.
// The two links open the public sheets page for the session (`#/sheets/<meetId>/<sessionId>?doc=…`).
import { DEFAULT_REMINDER_TEMPLATE, validateReminderTemplate, type ReminderContext, type ReminderTemplate } from './email/session-reminder-email';
import { sessionDateText } from './email/session-date';
import type { StoredAthlete } from './import/diff';
import { LICENSED_COACH } from './import/normalize';
import type { ClubContact, Discipline, Session } from './import/types';
import type { StoredClub } from './data/plan';
import { sessionLocation, sessionName } from './session-names';
import type { ScheduleFields } from './schedule';

/** The platform's default, with a footnote that is true here: the page shows what was last published, not a live view. */
export const LINEUPS_SESSION_TEMPLATE: ReminderTemplate = {
  ...DEFAULT_REMINDER_TEMPLATE,
  footnote: "The links above show the latest published rotation sheet and scorecards. If your session changes after this email, we'll send you a new one.",
};

/** A stored template, or the default when there is none or it does not validate. */
export function parseSessionTemplate(raw: unknown): ReminderTemplate {
  const v = raw ? validateReminderTemplate(raw) : null;
  return v?.ok ? v.template : LINEUPS_SESSION_TEMPLATE;
}

/** The roles counted as coaches before the admin picks: any role with "coach" in it. */
export const isDefaultCoachRole = (role: string): boolean => /coach/i.test(role);

/** The role the Licensed Coaches import gives its coaches (`src/lib/import/normalize.ts`). */
export { LICENSED_COACH };

/** Every role on the clubs' contacts, A–Z, with how many contacts have it. */
export function contactRoles(clubs: Pick<StoredClub, 'contacts'>[]): { role: string; count: number }[] {
  const n = new Map<string, number>();
  for (const c of clubs) for (const x of c.contacts ?? []) if (x.role) n.set(x.role, (n.get(x.role) ?? 0) + 1);
  return [...n].map(([role, count]) => ({ role, count })).sort((a, b) => a.role.localeCompare(b.role));
}

/** The saved choice, or the default: only Licensed Coach when the Licensed Coaches export was imported (it says who counts,
 *  Julia 2026-10-31), else every role with "coach" in it. */
export const coachRolesOrDefault = (saved: string[] | null, roles: { role: string }[]): string[] =>
  saved ?? (roles.some((r) => r.role === LICENSED_COACH) ? [LICENSED_COACH] : roles.map((r) => r.role).filter(isDefaultCoachRole));

export interface SessionRecipient {
  /** Unique within the session: `a:<athleteId>` or `c:<address>`. */
  key: string;
  role: 'athlete' | 'coach';
  /** Full name ('' when the export had none). */
  name: string;
  firstName: string;
  email: string;
  /** Athlete: their club. Coach: the club(s) they coach in this session. */
  clubName: string;
  /** Coach only: their athletes in the session, by name, in club then first-name order. */
  athletes?: { name: string; club: string }[];
}

export interface MissingAddress {
  role: 'athlete' | 'coach';
  name: string;
  clubName: string;
}

export interface SessionRecipients {
  athletes: SessionRecipient[];
  coaches: SessionRecipient[];
  missing: MissingAddress[];
  /** Athletes competing in the session (with or without an address). */
  athleteCount: number;
}

const fullName = (a: { first: string; last: string }) => `${a.first} ${a.last}`.trim();
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** Athletes who compete in this session: imported, not removed, on at least one apparatus or event. */
export const sessionAthletes = (athletes: StoredAthlete[], sessionId: string): StoredAthlete[] =>
  athletes.filter((a) => a.sessionId === sessionId && !a.removed && a.competes);

export function buildSessionRecipients(input: {
  sessionId: string;
  athletes: StoredAthlete[];
  clubs: Pick<StoredClub, 'id' | 'name' | 'contacts'>[];
  coachRoles: string[];
}): SessionRecipients {
  const inSession = sessionAthletes(input.athletes, input.sessionId)
    .sort((a, b) => a.clubName.localeCompare(b.clubName) || a.first.localeCompare(b.first) || a.last.localeCompare(b.last));
  const roles = new Set(input.coachRoles);
  const clubById = new Map(input.clubs.map((c) => [c.id, c]));
  const missing: MissingAddress[] = [];

  // Coaches, merged by address: one person may coach (or be listed for) more than one club.
  const coaches = new Map<string, SessionRecipient & { clubs: Set<string>; athleteIds: Set<string> }>();
  const clubsInSession = new Map<string, StoredAthlete[]>();
  for (const a of inSession) if (!a.independent) clubsInSession.set(a.clubId, [...(clubsInSession.get(a.clubId) ?? []), a]);
  for (const [clubId, list] of clubsInSession) {
    const club = clubById.get(clubId);
    const coachContacts: ClubContact[] = (club?.contacts ?? []).filter((c) => roles.has(c.role));
    if (coachContacts.length === 0) {
      missing.push({ role: 'coach', name: '', clubName: club?.name ?? list[0].clubName });
      continue;
    }
    for (const c of coachContacts) {
      const email = c.email.toLowerCase();
      let r = coaches.get(email);
      if (!r) {
        r = { key: `c:${email}`, role: 'coach', name: c.name, firstName: c.name.split(/\s+/)[0] ?? '', email, clubName: '', clubs: new Set(), athleteIds: new Set() };
        coaches.set(email, r);
      }
      if (!r.name && c.name) { r.name = c.name; r.firstName = c.name.split(/\s+/)[0]; }
      r.clubs.add(club?.name ?? list[0].clubName);
      for (const a of list) r.athleteIds.add(a.id);
    }
  }

  const athletes: SessionRecipient[] = [];
  for (const a of inSession) {
    if (!a.email) {
      missing.push({ role: 'athlete', name: fullName(a), clubName: a.clubName });
      continue;
    }
    // Also a coach in this session: they get the coach email (it lists everyone else), not a second one.
    if (coaches.has(a.email.toLowerCase())) continue;
    athletes.push({ key: `a:${a.id}`, role: 'athlete', name: fullName(a), firstName: a.first, email: a.email.toLowerCase(), clubName: a.clubName });
  }

  const byAddress = new Map(inSession.filter((a) => a.email).map((a) => [a.email!.toLowerCase(), a.id]));
  const coachList: SessionRecipient[] = [...coaches.values()].map(({ clubs, athleteIds, ...r }) => {
    const self = byAddress.get(r.email);
    return {
      ...r,
      clubName: [...clubs].sort((x, y) => x.localeCompare(y)).join(', '),
      athletes: inSession.filter((a) => athleteIds.has(a.id) && a.id !== self).map((a) => ({ name: fullName(a), club: a.clubName })),
    };
  });

  return {
    athletes,
    coaches: coachList.sort((a, b) => a.clubName.localeCompare(b.clubName) || byName(a, b) || a.email.localeCompare(b.email)),
    missing,
    athleteCount: inSession.length,
  };
}

const DISCIPLINE_LABEL: Record<Discipline, string> = { WAG: 'WAG', MAG: 'MAG', TNT: 'T&T' };

/** `Session 2 - Orange (MAG)`: the email's heading and `{session}`. */
export function sessionEmailLabel(s: Session): string {
  const where = [sessionName(s), sessionLocation(s)].filter(Boolean).join(' - ');
  return `${where} (${DISCIPLINE_LABEL[s.discipline]})`;
}

export type SheetDoc = 'rotation' | 'scorecards';

/** The public sheets page for one session. `base` is the site address without a hash. */
export function publicSheetUrl(base: string, meetId: string, sessionId: string, docKind: SheetDoc): string {
  return `${base.replace(/#.*$/, '').replace(/\/?$/, '/')}#/sheets/${encodeURIComponent(meetId)}/${encodeURIComponent(sessionId)}?doc=${docKind}`;
}

/** What the email builder needs for one recipient. Times are shown as typed on the Exports screen; Lineups has no end time. */
export function sessionEmailContext(input: {
  meetName: string;
  meetId: string;
  session: Session;
  schedule: ScheduleFields;
  recipient: SessionRecipient;
  linkBase: string;
}): ReminderContext {
  const { session, schedule, recipient } = input;
  return {
    eventName: input.meetName || 'UCG',
    sessionLabel: sessionEmailLabel(session),
    dateText: sessionDateText(schedule.date),
    times: { stretch: schedule.stretch, warmup: schedule.warmups, start: schedule.competition, end: '' },
    firstName: recipient.firstName || (recipient.role === 'coach' ? 'Coach' : 'there'),
    recipient: recipient.role,
    athletes: recipient.athletes,
    rotationUrl: publicSheetUrl(input.linkBase, input.meetId, session.id, 'rotation'),
    scorecardsUrl: publicSheetUrl(input.linkBase, input.meetId, session.id, 'scorecards'),
  };
}
