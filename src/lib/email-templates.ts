// Pure: reminder wording, placeholders and rendering (HTML + plain-text alternative). Nothing here sends anything.
// Message markup is the small subset the nationals-tools emails use: blank-line paragraphs, "- " bullets, **bold**, bare links.
import { joinList, type ReminderEntry, type ReminderKind } from './reminders';

export interface TemplateText {
  subject: string;
  body: string;
}
export type Templates = Record<ReminderKind, TemplateText>;

export const PLACEHOLDERS = ['{club}', '{sessions}', '{levels}', '{deadline}', '{link}', '{meet}'] as const;

/** The prototype's wording: plain, friendly, A–Z is fine if they do nothing, keep the link private. */
export const DEFAULT_TEMPLATES: Templates = {
  az: {
    subject: 'Reminder: set your competing order for {meet}',
    body: `Hi {club},

For {meet}, your athletes in these sessions are still in the default order, A–Z by first name:

{sessions}

If you'd like a different competing order on any event, set it by **{deadline}**. Changes save as you go. Your other sessions are already set.

Set your competing order: {link}

This is your club's private link. Please don't share it outside your club.

If A–Z is fine, there's nothing you need to do.

Thanks,
The UCG Team`,
  },
  split: {
    subject: 'Action needed: split your athletes into squads for {meet}',
    body: `Hi {club},

You have more athletes than fit in one squad at: {levels}. We've suggested a split into groups. Each group competes as its own squad.

Please check the groups, move athletes between them if you'd like, then click **Keep this split**. Do this by **{deadline}**. You can set your competing order on the same page.

Check your groups: {link}

This is your club's private link. Please don't share it outside your club.

If you don't decide, we'll use the suggested split.

Thanks,
The UCG Team`,
  },
};

/** Stored templates over the defaults; anything missing or not a string falls back to the default. */
export function parseTemplates(raw: unknown): Templates {
  const t = (raw && typeof raw === 'object' ? (raw as { templates?: unknown }).templates : null) as Partial<Record<ReminderKind, Partial<TemplateText>>> | null;
  const pick = (k: ReminderKind): TemplateText => ({
    subject: typeof t?.[k]?.subject === 'string' ? t[k]!.subject! : DEFAULT_TEMPLATES[k].subject,
    body: typeof t?.[k]?.body === 'string' ? t[k]!.body! : DEFAULT_TEMPLATES[k].body,
  });
  return { az: pick('az'), split: pick('split') };
}

export interface MessageContext {
  meetName: string;
  deadline: string;
  link: string;
}

/** The text each placeholder stands for. In the body `{sessions}` is a bulleted list; in the subject it is inline. */
export function placeholderValues(entry: ReminderEntry, ctx: MessageContext, where: 'subject' | 'body'): Record<string, string> {
  const labels = entry.sessions.map((s) => s.label);
  const levels = entry.levels.map((l) => `${l.levelName} in ${l.sessionLabel} (${l.count} athletes)`);
  return {
    club: entry.clubName,
    sessions: where === 'body' ? labels.map((l) => `- ${l}`).join('\n') : joinList(labels),
    levels: joinList(levels),
    deadline: ctx.deadline,
    link: ctx.link,
    meet: ctx.meetName,
  };
}

/** Unknown `{words}` are left as typed, so a typo is visible in the preview. Values are inserted literally. */
export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(values, k) ? values[k] : m));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** One line -> HTML: **bold** and bare https links; everything else is escaped. */
function inline(text: string): string {
  const links: string[] = [];
  const stash = (html: string) => `\uE000${links.push(html) - 1}\uE001`;
  const withLinks = text.replace(/https?:\/\/[^\s<)\uE000]+[^\s<).,;:!?\uE000]/g, (url) => stash(`<a href="${esc(url)}" style="color:#1e2b38">${esc(url)}</a>`));
  return esc(withLinks)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\uE000(\d+)\uE001/g, (_, i: string) => links[Number(i)]);
}

/** Plain text with blank-line paragraphs and "- " bullets -> HTML. */
export function textToHtml(text: string): string {
  return text.trim().split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n');
    const isBullet = (l: string) => /^\s*-\s+/.test(l);
    const first = lines.findIndex(isBullet);
    if (first >= 0 && lines.slice(first).every(isBullet)) {
      const items = `<ul>${lines.slice(first).map((l) => `<li>${inline(l.replace(/^\s*-\s+/, ''))}</li>`).join('')}</ul>`;
      return first ? `<p>${lines.slice(0, first).map(inline).join('<br>')}</p>${items}` : items;
    }
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Subject (no line breaks), HTML body and plain-text alternative for one club. */
export function renderReminder(template: TemplateText, entry: ReminderEntry, ctx: MessageContext): RenderedEmail {
  const subject = fillTemplate(template.subject, placeholderValues(entry, ctx, 'subject')).replace(/\s+/g, ' ').trim();
  const body = fillTemplate(template.body, placeholderValues(entry, ctx, 'body'));
  const html = `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#1e2b38;font-size:15px;line-height:1.5;overflow-wrap:anywhere">\n${textToHtml(body)}\n</body></html>`;
  const text = body.replace(/\*\*(.+?)\*\*/g, '$1').trim();
  return { subject, html, text };
}

/** The club's private page. `base` is the page address without a hash, e.g. `https://lineups.unitedclubgymnastics.org/`. */
export function clubLinkUrl(base: string, token: string): string {
  return `${base.replace(/#.*$/, '').replace(/\/?$/, '/')}#/c/${token}`;
}
