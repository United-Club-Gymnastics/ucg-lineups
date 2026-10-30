// Copied from ucg-platform@5824208e supabase/functions/_shared/session-reminder-email.ts — keep in sync by hand
// _shared/session-reminder-email.ts — the per-competition-session reminder email (docs/specs/2026-10-24-session-reminder-emails.md §3).
//
// PURE (no Deno globals, no npm deps) so the client imports it for the live preview and the edge function for the send.
// The template is PLAIN TEXT only (never host HTML, so no sanitizeHostHtml): every field and every context string is
// HTML-escaped first, THEN placeholders are filled (placeholder values escaped too).
//
// LOCKSTEP with the SQL RPC that will validate/save the template (PR 2): REMINDER_TEMPLATE_KEYS / REMINDER_TEMPLATE_LIMITS.

import { renderEmail, emailButtonHtml } from './email-layout.ts';
import { fmtSessionTime } from './session-time.ts';

export interface ReminderTemplate {
  subject: string;
  intro: string;
  facilityNote: string;
  rotationNote: string;
  scorecardsNote: string;
  callout: string;
  calloutButton: string;
  calloutUrl: string;
  scheduleNote: string;
  reminders: string[];
  livestreamUrl: string;
  signoff: string;
  footnote: string;
}

export const DEFAULT_REMINDER_TEMPLATE: ReminderTemplate = {
  subject: '{event}: {session} Information',
  intro: 'We are so excited to have you at {event}. To help things run smoothly, here are a few key details.',
  facilityNote: '',
  rotationNote:
    'Use this to find your event order. Rotation order may change up to the start time of your session in the case of travel complications for participating athletes.',
  scorecardsNote:
    'Use these as a REFERENCE ONLY to see the order athletes compete on each event. Do not email us with requests to change lineups. Scratches and additions will be handled live during the competition.',
  callout: '',
  calloutButton: '',
  calloutUrl: '',
  scheduleNote:
    'We depend on all competitors to keep the meet on schedule. Be mindful of time, know where you need to be, and stay on track.',
  reminders: [
    'Warm-ups are for warming up, not learning new skills.',
    'Athletes will receive 15 minutes to warm up each event and will be allowed additional bump touches as long as their turn ends before the judges are ready for the next competitor.',
    'You must be ready to warm up your next event as soon as you are instructed to do so by a UCG volunteer.',
    'When it is your turn to compete, you must be present and prepared or you will be considered a scratch.',
    'If you would like to file a score inquiry regarding your start value or neutral deductions, please do not approach the judge. Volunteers in the yellow t-shirts will help you file your inquiry.',
  ],
  livestreamUrl: '',
  signoff: 'Patience is key. We appreciate your cooperation. Wishing you a great competition. Stay safe and have fun!\nUCG Volunteer Staff',
  footnote: "The links above always show the latest rotation sheet and scorecards. If your session changes after this email, we'll send you a new one.",
};

export const REMINDER_PLACEHOLDERS = ['{first_name}', '{event}', '{session}', '{date}', '{stretch}', '{warmup}', '{start}', '{end}'] as const;

export const REMINDER_TEMPLATE_KEYS = [
  'subject', 'intro', 'facilityNote', 'rotationNote', 'scorecardsNote', 'callout', 'calloutButton', 'calloutUrl',
  'scheduleNote', 'reminders', 'livestreamUrl', 'signoff', 'footnote',
] as const;

export const REMINDER_TEMPLATE_LIMITS = {
  subject: 200,
  calloutButton: 60,
  text: 2000,
  url: 2000,
  remindersMax: 20,
  reminderMax: 500,
} as const;

const URL_KEYS = new Set<string>(['calloutUrl', 'livestreamUrl']);

export type ReminderValidation = { ok: true; template: ReminderTemplate } | { ok: false; errors: string[] };

/** Validate untrusted JSON (the host's saved template) into a ReminderTemplate. Blank reminder items are dropped and trimmed. */
export function validateReminderTemplate(raw: unknown): ReminderValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['Template must be an object.'] };
  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];
  const known = new Set<string>(REMINDER_TEMPLATE_KEYS);
  for (const k of Object.keys(obj)) if (!known.has(k)) errors.push(`Unknown field: ${k}.`);
  const out: Record<string, unknown> = {};
  for (const k of REMINDER_TEMPLATE_KEYS) {
    if (!(k in obj)) { errors.push(`Missing field: ${k}.`); continue; }
    const v = obj[k];
    if (k === 'reminders') {
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) { errors.push('reminders must be a list of text.'); continue; }
      const items = (v as string[]).map((x) => x.trim()).filter(Boolean);
      if (items.length > REMINDER_TEMPLATE_LIMITS.remindersMax) errors.push(`reminders has more than ${REMINDER_TEMPLATE_LIMITS.remindersMax} items.`);
      if (items.some((x) => x.length > REMINDER_TEMPLATE_LIMITS.reminderMax)) errors.push(`A reminder is longer than ${REMINDER_TEMPLATE_LIMITS.reminderMax} characters.`);
      out[k] = items;
      continue;
    }
    if (typeof v !== 'string') { errors.push(`${k} must be text.`); continue; }
    const cap = URL_KEYS.has(k) ? REMINDER_TEMPLATE_LIMITS.url
      : k === 'subject' ? REMINDER_TEMPLATE_LIMITS.subject
      : k === 'calloutButton' ? REMINDER_TEMPLATE_LIMITS.calloutButton
      : REMINDER_TEMPLATE_LIMITS.text;
    if (v.length > cap) errors.push(`${k} is longer than ${cap} characters.`);
    if (URL_KEYS.has(k) && v !== '' && !isHttpUrl(v)) errors.push(`${k} must be blank or start with http:// or https://.`);
    out[k] = v;
  }
  return errors.length ? { ok: false, errors } : { ok: true, template: out as unknown as ReminderTemplate };
}

const isHttpUrl = (u: string) => /^https?:\/\//i.test(u);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface ReminderContext {
  eventName: string;
  /** e.g. "Session 2 - Orange (MAG)", preformatted by the caller. */
  sessionLabel: string;
  /** e.g. "Friday, April 9, 2027" or ''. */
  dateText: string;
  /** Raw "HH:MM" strings, any may be empty. */
  times: { stretch?: string | null; warmup?: string | null; start?: string | null; end?: string | null };
  firstName: string;
  recipient: 'athlete' | 'coach';
  /** Coach emails only. */
  athletes?: { name: string; club?: string }[];
  rotationUrl: string;
  scorecardsUrl: string;
}

/** Fill `{placeholders}` in `text` from `ctx` (values inserted as given — escape before/after as the caller needs). */
export function fillReminderPlaceholders(text: string, ctx: ReminderContext, transform: (s: string) => string = (s) => s): string {
  const map: Record<string, string> = {
    '{first_name}': ctx.firstName,
    '{event}': ctx.eventName,
    '{session}': ctx.sessionLabel,
    '{date}': ctx.dateText,
    '{stretch}': fmtSessionTime(ctx.times.stretch),
    '{warmup}': fmtSessionTime(ctx.times.warmup),
    '{start}': fmtSessionTime(ctx.times.start),
    '{end}': fmtSessionTime(ctx.times.end),
  };
  return text.replace(/\{(first_name|event|session|date|stretch|warmup|start|end)\}/g, (m) => transform(map[m] ?? m));
}

// Palette: email-layout's navy text / muted body; coral TEXT on white for links (#bd3f27 is AA on white); navy on #faebbc call-out.
const NAVY = '#1E2B38';
const LINK = '#bd3f27';
const CALLOUT_FILL = '#faebbc';
const PANEL = '#eef1f4';

const P = 'margin:0 0 14px;';
const H = `color:${NAVY};font-size:16px;font-weight:700;margin:22px 0 8px;`;

const linkHtml = (url: string, label: string) =>
  isHttpUrl(url) ? `<a href="${esc(url)}" style="color:${LINK};font-weight:700;text-decoration:underline;">${esc(label)}</a>` : esc(label);

const multiline = (htmlEscaped: string) => htmlEscaped.replace(/\r?\n/g, '<br>');

export function buildSessionReminderEmail(template: ReminderTemplate, ctx: ReminderContext): { subject: string; html: string; text: string } {
  const fillHtml = (s: string) => fillReminderPlaceholders(esc(s), ctx, esc);
  const fillText = (s: string) => fillReminderPlaceholders(s, ctx);
  const subject = fillText(template.subject).replace(/[\r\n]+/g, ' ').trim();

  const rows: [string, string][] = [];
  const addRow = (label: string, t: string | null | undefined) => { const d = fmtSessionTime(t); if (d) rows.push([label, d]); };
  addRow('Open stretch', ctx.times.stretch);
  addRow('Warm-ups', ctx.times.warmup);
  addRow('Competition', ctx.times.start);
  addRow('Est. end', ctx.times.end);

  const html: string[] = [];
  const text: string[] = [];

  html.push(`<p style="${P}color:${NAVY};font-size:16px;font-weight:700;">Hello ${esc(ctx.firstName)}!</p>`);
  text.push(`Hello ${ctx.firstName}!`);
  if (template.intro.trim()) {
    html.push(`<p style="${P}">${multiline(fillHtml(template.intro))}</p>`);
    text.push(fillText(template.intro));
  }

  if (ctx.recipient === 'coach' && ctx.athletes && ctx.athletes.length) {
    html.push(`<div style="background:${PANEL};border-radius:8px;padding:12px 16px;margin:0 0 14px;color:${NAVY};">
<div style="font-weight:700;margin:0 0 6px;">Your athletes in this session</div>
${ctx.athletes.map((a) => `<div>${esc(a.name)}</div>`).join('\n')}
</div>`);
    text.push(`Your athletes in this session:\n${ctx.athletes.map((a) => `- ${a.name}`).join('\n')}`);
  }

  if (ctx.dateText || rows.length) {
    const dateHtml = ctx.dateText ? `<div style="font-weight:700;margin:0 0 6px;">${esc(ctx.dateText)}</div>` : '';
    const rowsHtml = rows.map(([l, t]) => `<tr><td style="padding:2px 16px 2px 0;">${esc(l)}</td><td style="padding:2px 0;font-weight:700;">${esc(t)}</td></tr>`).join('');
    html.push(`<div style="background:${PANEL};border-radius:8px;padding:12px 16px;margin:0 0 14px;color:${NAVY};">${dateHtml}${rows.length ? `<table role="presentation" style="border-collapse:collapse;">${rowsHtml}</table>` : ''}</div>`);
    text.push([ctx.dateText, ...rows.map(([l, t]) => `${l}: ${t}`)].filter(Boolean).join('\n'));
  }

  if (template.facilityNote.trim()) {
    html.push(`<p style="${P}">${multiline(fillHtml(template.facilityNote))}</p>`);
    text.push(fillText(template.facilityNote));
  }

  html.push(`<h2 style="${H}">Competition Documents</h2>`);
  html.push(`<p style="${P}">${linkHtml(ctx.rotationUrl, 'Rotation Sheet →')}<br>${multiline(fillHtml(template.rotationNote))}</p>`);
  html.push(`<p style="${P}">${linkHtml(ctx.scorecardsUrl, 'Scorecards →')}<br>${multiline(fillHtml(template.scorecardsNote))}</p>`);
  text.push(`COMPETITION DOCUMENTS\nRotation Sheet: ${ctx.rotationUrl}\n${fillText(template.rotationNote)}`);
  text.push(`Scorecards: ${ctx.scorecardsUrl}\n${fillText(template.scorecardsNote)}`);

  if (template.callout.trim()) {
    const showBtn = !!(template.calloutButton.trim() && template.calloutUrl.trim() && isHttpUrl(template.calloutUrl));
    html.push(`<div style="background:${CALLOUT_FILL};color:${NAVY};border-radius:8px;padding:14px 16px;margin:18px 0;"><div style="font-weight:700;line-height:1.5;">${multiline(fillHtml(template.callout))}</div>${
      showBtn ? emailButtonHtml({ text: fillHtml(template.calloutButton), href: esc(template.calloutUrl) }) : ''}</div>`);
    text.push(fillText(template.callout) + (showBtn ? `\n${fillText(template.calloutButton)}: ${template.calloutUrl}` : ''));
  }

  if (template.scheduleNote.trim()) {
    html.push(`<p style="${P}">${multiline(fillHtml(template.scheduleNote))}</p>`);
    text.push(fillText(template.scheduleNote));
  }

  const bullets: { html: string; text: string }[] = template.reminders.filter((r) => r.trim()).map((r) => ({ html: fillHtml(r), text: fillText(r) }));
  if (template.livestreamUrl.trim()) {
    bullets.push({
      html: `Don't forget that we will be livestreaming the event ${linkHtml(template.livestreamUrl, 'here')}.`,
      text: `Don't forget that we will be livestreaming the event here: ${template.livestreamUrl}`,
    });
  }
  if (bullets.length) {
    html.push(`<h2 style="${H}">Reminders</h2><ul style="margin:0 0 14px;padding-left:20px;">${bullets.map((b) => `<li style="margin:0 0 6px;">${b.html}</li>`).join('')}</ul>`);
    text.push(`REMINDERS\n${bullets.map((b) => `- ${b.text}`).join('\n')}`);
  }

  if (template.signoff.trim()) {
    html.push(`<p style="${P}">${multiline(fillHtml(template.signoff))}</p>`);
    text.push(fillText(template.signoff));
  }

  const footnote = template.footnote.trim();
  if (footnote) text.push(fillText(template.footnote));

  return {
    subject,
    html: renderEmail({
      heading: `${esc(ctx.sessionLabel)}: Competition Details`,
      bodyHtml: html.join('\n'),
      footnoteHtml: footnote ? multiline(fillHtml(template.footnote)) : undefined,
    }),
    text: text.join('\n\n'),
  };
}
