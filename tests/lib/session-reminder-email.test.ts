// Copied from ucg-platform@5824208e tests/session-reminder-email.test.ts — keep in sync by hand
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REMINDER_TEMPLATE, REMINDER_TEMPLATE_KEYS, REMINDER_TEMPLATE_LIMITS, REMINDER_PLACEHOLDERS,
  buildSessionReminderEmail, fillReminderPlaceholders, validateReminderTemplate,
  type ReminderContext, type ReminderTemplate,
} from '../../src/lib/email/session-reminder-email';

const ctx: ReminderContext = {
  eventName: 'Nationals 2027',
  sessionLabel: 'Session 2 - Orange (MAG)',
  dateText: 'Friday, April 9, 2027',
  times: { stretch: '07:30', warmup: '08:00', start: '08:45', end: '12:30' },
  firstName: 'Sam',
  recipient: 'athlete',
  rotationUrl: 'https://example.com/rot',
  scorecardsUrl: 'https://example.com/score',
};
const tpl = (over: Partial<ReminderTemplate> = {}): ReminderTemplate => ({ ...DEFAULT_REMINDER_TEMPLATE, ...over });

describe('buildSessionReminderEmail', () => {
  it('fills placeholders in subject and body, with 12-hour times', () => {
    const r = buildSessionReminderEmail(tpl({ intro: 'Hi at {event}, warm-up {warmup}, start {start}, {date}, {session}.' }), ctx);
    expect(r.subject).toBe('Nationals 2027: Session 2 - Orange (MAG) Information');
    expect(r.html).toContain('Hi at Nationals 2027, warm-up 8:00 AM, start 8:45 AM, Friday, April 9, 2027, Session 2 - Orange (MAG).');
    expect(r.html).toContain('Open stretch');
    expect(r.html).toContain('Est. end');
    expect(r.html).toContain('12:30 PM');
    expect(r.html).toContain('Hello Sam!');
    expect(r.text).toContain('Rotation Sheet: https://example.com/rot');
    expect(r.text).toContain('Scorecards: https://example.com/score');
    expect(r.html).not.toMatch(/\{(first_name|event|session|date|stretch|warmup|start|end)\}/);
  });

  it('escapes template fields, names and athlete names', () => {
    const r = buildSessionReminderEmail(
      tpl({ intro: '<script>alert(1)</script> {first_name}', reminders: ['<img src=x onerror=1>'], signoff: 'a<b' }),
      { ...ctx, firstName: '<script>x</script>', recipient: 'coach', athletes: [{ name: '<script>a</script> C&D' }] },
    );
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('<img');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).toContain('C&amp;D');
  });

  it('escapes placeholder values (event name) after filling', () => {
    const r = buildSessionReminderEmail(tpl(), { ...ctx, eventName: '<b>X</b>' });
    expect(r.html).not.toContain('<b>X</b>');
    expect(r.html).toContain('&lt;b&gt;X&lt;/b&gt;');
  });

  it('omits blank sections', () => {
    const r = buildSessionReminderEmail(tpl({ facilityNote: '', callout: '', reminders: [], scheduleNote: '' }), ctx);
    expect(r.html).not.toContain('Reminders');
    expect(r.html).not.toContain('#faebbc');
    expect(r.text).not.toContain('REMINDERS');
  });

  it('shows the call-out box, and its button only with both label and url', () => {
    const base = { callout: 'Parking is limited.' };
    const none = buildSessionReminderEmail(tpl(base), ctx);
    expect(none.html).toContain('#faebbc');
    expect(none.html).not.toContain('<a href="https://example.com/btn"');
    const label = buildSessionReminderEmail(tpl({ ...base, calloutButton: 'Map' }), ctx);
    expect(label.html).not.toContain('>Map</a>');
    const both = buildSessionReminderEmail(tpl({ ...base, calloutButton: 'Map', calloutUrl: 'https://example.com/btn' }), ctx);
    expect(both.html).toContain('href="https://example.com/btn"');
    expect(both.html).toContain('>Map</a>');
    expect(both.text).toContain('Map: https://example.com/btn');
  });

  it('adds the livestream bullet only when set', () => {
    expect(buildSessionReminderEmail(tpl(), ctx).html).not.toContain('livestreaming');
    const r = buildSessionReminderEmail(tpl({ livestreamUrl: 'https://example.com/live' }), ctx);
    expect(r.html).toContain('livestreaming the event <a href="https://example.com/live"');
    expect(r.text).toContain('livestreaming the event here: https://example.com/live');
  });

  it('lists athletes for coaches only', () => {
    const athletes = [{ name: 'Ann Lee', club: 'Club A' }];
    const coach = buildSessionReminderEmail(tpl(), { ...ctx, recipient: 'coach', athletes });
    expect(coach.html).toContain('Your athletes in this session');
    expect(coach.html).toContain('Ann Lee');
    expect(coach.html).not.toContain('Club A');
    expect(coach.text).toContain('- Ann Lee');
    expect(coach.text).not.toContain('Club A');
    const ath = buildSessionReminderEmail(tpl(), { ...ctx, recipient: 'athlete', athletes });
    expect(ath.html).not.toContain('Your athletes in this session');
    expect(ath.html).not.toContain('Ann Lee');
  });

  it('omits unset time rows, and the whole block with no date and no times', () => {
    const some = buildSessionReminderEmail(tpl(), { ...ctx, times: { start: '09:00' } });
    expect(some.html).toContain('Competition');
    expect(some.html).not.toContain('Open stretch');
    expect(some.html).not.toContain('Warm-ups</td>');
    expect(some.html).not.toContain('Est. end');
    const none = buildSessionReminderEmail(tpl(), { ...ctx, dateText: '', times: {} });
    expect(none.html).not.toContain('Competition</td>');
    expect(none.html).not.toContain('Friday');
  });

  it('never turns a non-http(s) URL into an href', () => {
    const r = buildSessionReminderEmail(
      tpl({ callout: 'x', calloutButton: 'Go', calloutUrl: 'javascript:alert(1)', livestreamUrl: 'javascript:alert(2)' }),
      { ...ctx, rotationUrl: 'javascript:alert(3)', scorecardsUrl: 'data:text/html,hi' },
    );
    expect(r.html).not.toMatch(/href="(javascript|data):/i);
    expect(r.html).toContain('Rotation Sheet →');
  });

  it('has no white-on-coral pairs (CTA text is navy)', () => {
    const r = buildSessionReminderEmail(tpl({ callout: 'x', calloutButton: 'Go', calloutUrl: 'https://example.com' }), ctx);
    expect(r.html).toContain('background:#F4694A;color:#1E2B38');
  });

  it('puts the heading and footnote in the layout', () => {
    const r = buildSessionReminderEmail(tpl(), ctx);
    expect(r.html).toContain('Session 2 - Orange (MAG): Competition Details');
    expect(r.html).toContain('send you a new one');
  });
});

describe('fillReminderPlaceholders', () => {
  it('lists every placeholder it fills', () => {
    const out = fillReminderPlaceholders(REMINDER_PLACEHOLDERS.join('|'), ctx);
    expect(out).toBe('Sam|Nationals 2027|Session 2 - Orange (MAG)|Friday, April 9, 2027|7:30 AM|8:00 AM|8:45 AM|12:30 PM');
  });
  it('blanks unset times', () => {
    expect(fillReminderPlaceholders('[{stretch}]', { ...ctx, times: {} })).toBe('[]');
  });
});

describe('validateReminderTemplate', () => {
  const bad = (t: unknown) => { const v = validateReminderTemplate(t); return v.ok ? [] : v.errors; };
  it('accepts the default template and keys match', () => {
    const v = validateReminderTemplate(DEFAULT_REMINDER_TEMPLATE);
    expect(v.ok).toBe(true);
    expect(Object.keys(DEFAULT_REMINDER_TEMPLATE).sort()).toEqual([...REMINDER_TEMPLATE_KEYS].sort());
  });
  it('rejects unknown keys, missing keys and non-objects', () => {
    expect(bad({ ...DEFAULT_REMINDER_TEMPLATE, extra: 'x' }).join()).toContain('Unknown field: extra');
    const rest: Record<string, unknown> = { ...DEFAULT_REMINDER_TEMPLATE };
    delete rest.subject;
    expect(bad(rest).join()).toContain('Missing field: subject');
    expect(bad(null).length).toBe(1);
    expect(bad([]).length).toBe(1);
  });
  it('rejects wrong types', () => {
    expect(bad({ ...DEFAULT_REMINDER_TEMPLATE, intro: 5 }).join()).toContain('intro must be text');
    expect(bad({ ...DEFAULT_REMINDER_TEMPLATE, reminders: 'x' }).join()).toContain('reminders');
    expect(bad({ ...DEFAULT_REMINDER_TEMPLATE, reminders: [1] }).join()).toContain('reminders');
  });
  it('enforces length caps', () => {
    const L = REMINDER_TEMPLATE_LIMITS;
    expect(bad({ ...DEFAULT_REMINDER_TEMPLATE, subject: 'x'.repeat(L.subject + 1) }).length).toBe(1);
    expect(bad({ ...DEFAULT_REMINDER_TEMPLATE, subject: 'x'.repeat(L.subject) }).length).toBe(0);
    expect(bad({ ...DEFAULT_REMINDER_TEMPLATE, calloutButton: 'x'.repeat(L.calloutButton + 1) }).length).toBe(1);
    expect(bad({ ...DEFAULT_REMINDER_TEMPLATE, intro: 'x'.repeat(L.text + 1) }).length).toBe(1);
    expect(bad({ ...DEFAULT_REMINDER_TEMPLATE, reminders: Array(L.remindersMax + 1).fill('a') }).length).toBe(1);
    expect(bad({ ...DEFAULT_REMINDER_TEMPLATE, reminders: ['x'.repeat(L.reminderMax + 1)] }).length).toBe(1);
    expect(bad({ ...DEFAULT_REMINDER_TEMPLATE, calloutUrl: 'https://e.com/' + 'x'.repeat(L.url) }).length).toBeGreaterThan(0);
  });
  it('rejects non-http(s) URLs but accepts blank', () => {
    for (const u of ['javascript:alert(1)', 'ftp://x', 'example.com', 'data:text/html,x']) {
      expect(bad({ ...DEFAULT_REMINDER_TEMPLATE, calloutUrl: u }).join()).toContain('calloutUrl');
      expect(bad({ ...DEFAULT_REMINDER_TEMPLATE, livestreamUrl: u }).join()).toContain('livestreamUrl');
    }
    expect(bad({ ...DEFAULT_REMINDER_TEMPLATE, calloutUrl: 'http://a.com', livestreamUrl: 'https://a.com' })).toEqual([]);
  });
  it('trims reminders and drops blank items', () => {
    const v = validateReminderTemplate({ ...DEFAULT_REMINDER_TEMPLATE, reminders: ['  a  ', '', '   ', 'b'] });
    expect(v.ok && v.template.reminders).toEqual(['a', 'b']);
  });
});
