import { describe, expect, it } from 'vitest';
import { buildClubRows } from '../../src/lib/club-overview';
import { clubLinkUrl, DEFAULT_TEMPLATES, fillTemplate, parseTemplates, renderReminder, textToHtml } from '../../src/lib/email-templates';
import { buildReminders } from '../../src/lib/reminders';
import { ATHLETES, CLUBS, SAVED, SESSIONS } from './clubs-fixtures';

const r = buildReminders(buildClubRows(ATHLETES, SESSIONS, CLUBS, SAVED));
const ctx = { meetName: 'Test Nationals', deadline: 'Fri Mar 27, 11:59 PM PT', link: 'https://lineups.example.org/#/c/tokAlpha' };

describe('templates', () => {
  it('fill: known placeholders replaced, unknown ones left visible, values inserted literally', () => {
    expect(fillTemplate('Hi {club} {oops} {meet}', { club: '$& <b>', meet: 'M' })).toBe('Hi $& <b> {oops} M');
  });

  it('A–Z default lists only the sessions still A–Z, with deadline, link and meet', () => {
    const e = renderReminder(DEFAULT_TEMPLATES.az, r.az[0], ctx);
    expect(e.subject).toBe('Reminder: set your competing order for Test Nationals');
    expect(e.html).toContain('<ul><li>Session 1 · Orange</li></ul>');
    expect(e.html).not.toContain('Session 2');
    expect(e.html).toContain('<strong>Fri Mar 27, 11:59 PM PT</strong>');
    expect(e.html).toContain('<a href="https://lineups.example.org/#/c/tokAlpha"');
    expect(e.text).toContain('- Session 1 · Orange');
    expect(e.text).toContain('Fri Mar 27, 11:59 PM PT');
    expect(e.text).not.toContain('**');
    expect(e.text).toContain('A–Z is fine');
  });

  it('split default names the levels that are too big', () => {
    const e = renderReminder(DEFAULT_TEMPLATES.split, r.split[0], ctx);
    expect(e.subject).toBe('Action needed: split your athletes into squads for Test Nationals');
    expect(e.text).toContain('Platinum XP in Session 1 · Orange (14 athletes)');
    expect(e.text).toContain('Keep this split');
  });

  it('escapes HTML from club names and keeps the subject on one line', () => {
    const evil = { ...r.az[0], clubName: '<script>x</script>\r\nBcc: a@b.c' };
    const e = renderReminder({ subject: 'Hi {club}', body: 'Hi {club}' }, evil, ctx);
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.subject).not.toMatch(/[\r\n]/);
  });

  it('textToHtml: paragraphs, bullets, bold, bare links', () => {
    expect(textToHtml('A **b**\n\n- x\n- y\n\nsee https://a.org/x.')).toBe('<p>A <strong>b</strong></p>\n<ul><li>x</li><li>y</li></ul>\n<p>see <a href="https://a.org/x" style="color:#1e2b38">https://a.org/x</a>.</p>');
  });

  it('parseTemplates falls back to the defaults for anything missing', () => {
    expect(parseTemplates(null)).toEqual(DEFAULT_TEMPLATES);
    const t = parseTemplates({ templates: { az: { subject: 'S' }, split: 5 } });
    expect(t.az).toEqual({ subject: 'S', body: DEFAULT_TEMPLATES.az.body });
    expect(t.split).toEqual(DEFAULT_TEMPLATES.split);
  });

  it('clubLinkUrl puts the token after #/c/ whatever the base looks like', () => {
    expect(clubLinkUrl('https://x.org', 't')).toBe('https://x.org/#/c/t');
    expect(clubLinkUrl('https://x.org/app/#/old', 't')).toBe('https://x.org/app/#/c/t');
  });
});
