import { describe, expect, it, vi } from 'vitest';
import { assertTestRecipient, buildMime, clubSlug, headerValue, isTestAlias, sendTestBatch, sendTestEmail, testAlias, type FetchLike, type ReminderMessage } from '../../src/lib/email-send';

/** Undo base64url, then pull the readable parts out of the MIME message. */
function decode(raw: string) {
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  const msg = Buffer.from(b64, 'base64').toString('utf8');
  const header = (name: string) => new RegExp(`^${name}: (.*)$`, 'm').exec(msg)?.[1] ?? '';
  const part = (type: string) => {
    const m = new RegExp(`Content-Type: ${type}; charset=UTF-8\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`).exec(msg);
    return m ? Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString('utf8') : '';
  };
  return { msg, from: header('From'), to: header('To'), subject: header('Subject'), text: part('text/plain'), html: part('text/html') };
}

const message = (clubId: string, over: Partial<ReminderMessage> = {}): ReminderMessage => ({ clubId, clubName: clubId, subject: 'Reminder – set order', html: '<p>Hi</p>', text: 'Hi', ...over });

function okFetch() {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const fn: FetchLike = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({}) }; };
  return { fn, calls };
}

describe('test aliases', () => {
  it('builds jzsharpe+<club>@gmail.com or nssharpe+…', () => {
    expect(testAlias('jz', 'alpha-gymnastics')).toBe('jzsharpe+alpha-gymnastics@gmail.com');
    expect(testAlias('ns', 'alpha-gymnastics')).toBe('nssharpe+alpha-gymnastics@gmail.com');
    expect(clubSlug('Weird Name!!/..')).toBe('weird-name');
    expect(clubSlug('')).toBe('club');
  });
  it('only test aliases pass the recipient check', () => {
    expect(isTestAlias('jzsharpe+x@gmail.com')).toBe(true);
    expect(isTestAlias('nssharpe+a-b2@gmail.com')).toBe(true);
    for (const bad of ['coach@club.example', 'jzsharpe@gmail.com', 'jzsharpe+x@gmail.com.evil.org', 'x@jzsharpe+x@gmail.com', 'jzsharpe+x@gmail.com, other@x.org', 'someone+x@gmail.com']) {
      expect(isTestAlias(bad), bad).toBe(false);
      expect(() => assertTestRecipient(bad)).toThrow(/Test mode/);
    }
  });
});

describe('MIME', () => {
  it('is multipart/alternative with plain text and HTML, From the info@ alias, UTF-8 safe', () => {
    const raw = buildMime({ fromName: 'United Club Gymnastics', fromAddress: 'info@unitedclubgymnastics.org', to: ['jzsharpe+a@gmail.com'], subject: 'Reminder – A–Z é', html: '<p>Zażółć – A–Z</p>', text: 'Zażółć – A–Z' }, 'BND');
    expect(raw).not.toMatch(/[+/=]/);
    const d = decode(raw);
    expect(d.msg).toContain('Content-Type: multipart/alternative; boundary="BND"');
    expect(d.from).toBe('"United Club Gymnastics" <info@unitedclubgymnastics.org>');
    expect(d.to).toBe('jzsharpe+a@gmail.com');
    expect(d.subject).toMatch(/^=\?UTF-8\?B\?/);
    expect(Buffer.from(/\?B\?(.*)\?=/.exec(d.subject)![1], 'base64').toString('utf8')).toBe('Reminder – A–Z é');
    expect(d.text).toBe('Zażółć – A–Z');
    expect(d.html).toBe('<p>Zażółć – A–Z</p>');
  });
  it('a line break in a value cannot start a new header', () => {
    expect(headerValue('Hi\r\nBcc: x@y.z')).toBe('Hi Bcc: x@y.z');
  });
});

describe('sending (Gmail mocked; nothing leaves the process)', () => {
  it('posts one message to the club\'s TEST alias with the bearer token, never a club address', async () => {
    const { fn, calls } = okFetch();
    const to = await sendTestEmail({ token: 'tok123', who: 'jz', message: message('alpha-gymnastics'), fetchImpl: fn });
    expect(to).toBe('jzsharpe+alpha-gymnastics@gmail.com');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok123');
    const sent = decode(JSON.parse(calls[0].init.body).raw);
    expect(sent.to).toBe('jzsharpe+alpha-gymnastics@gmail.com');
    expect(sent.from).toContain('<info@unitedclubgymnastics.org>');
  });

  it('there is no way to pass a real address: even a club id that looks like an address becomes a safe alias', async () => {
    const { fn, calls } = okFetch();
    await sendTestEmail({ token: 't', who: 'ns', message: message('coach@club.example'), fetchImpl: fn });
    const sent = decode(JSON.parse(calls[0].init.body).raw);
    expect(sent.to).toBe('nssharpe+coach-club-example@gmail.com');
    expect(sent.msg).not.toContain('coach@club.example');
  });

  it('sends the batch in order with a pause between messages (not after the last), logs each, and reports progress', async () => {
    const { fn, calls } = okFetch();
    const events: string[] = [];
    const pause = vi.fn(async (ms: number) => { events.push(`pause ${ms}`); });
    const out = await sendTestBatch({
      token: 't', who: 'jz', messages: [message('a'), message('b'), message('c')], fetchImpl: async (u, i) => { events.push('post'); return fn(u, i); }, pause,
      onSent: async (r) => { events.push(`log ${r.clubId}`); },
      onProgress: (d, t) => events.push(`progress ${d}/${t}`),
    });
    expect(out.map((r) => [r.clubId, r.ok, r.to])).toEqual([['a', true, 'jzsharpe+a@gmail.com'], ['b', true, 'jzsharpe+b@gmail.com'], ['c', true, 'jzsharpe+c@gmail.com']]);
    expect(events).toEqual(['post', 'log a', 'progress 1/3', 'pause 400', 'post', 'log b', 'progress 2/3', 'pause 400', 'post', 'log c', 'progress 3/3']);
    expect(calls).toHaveLength(3);
  });

  it('a failed message is reported and not logged; the batch carries on', async () => {
    let n = 0;
    const fetchImpl: FetchLike = async () => (++n === 2 ? { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) } : { ok: true, status: 200, json: async () => ({}) });
    const logged: string[] = [];
    const out = await sendTestBatch({ token: 't', who: 'jz', messages: [message('a'), message('b'), message('c')], fetchImpl, pause: async () => {}, onSent: async (r) => { logged.push(r.clubId); } });
    expect(out.map((r) => r.ok)).toEqual([true, false, true]);
    expect(out[1].error).toBe('boom');
    expect(logged).toEqual(['a', 'c']);
  });

  it('stops at an expired connection (401) and says so', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const out = await sendTestBatch({ token: 't', who: 'jz', messages: [message('a'), message('b')], fetchImpl, pause: async () => {}, onSent: async () => {} });
    expect(out).toHaveLength(1);
    expect(out[0].error).toMatch(/expired/);
  });

  it('a log failure after a successful send is flagged, not lost', async () => {
    const { fn } = okFetch();
    const out = await sendTestBatch({ token: 't', who: 'jz', messages: [message('a')], fetchImpl: fn, pause: async () => {}, onSent: async () => { throw new Error('permission-denied'); } });
    expect(out[0]).toEqual(expect.objectContaining({ ok: true, logError: 'permission-denied' }));
  });
});

describe('test-mode guard (static)', () => {
  it('the Gmail endpoint is referenced only by email-send.ts, and only sendTestEmail/sendTestBatch can send', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    const files = walk('src').filter((f) => /\.tsx?$/.test(f));
    expect(files.filter((f) => readFileSync(f, 'utf8').includes('gmail.googleapis.com'))).toEqual([join('src', 'lib', 'email-send.ts')]);
    const mod = await import('../../src/lib/email-send');
    expect(Object.keys(mod).filter((k) => /^(send|post)/.test(k)).sort()).toEqual(['sendTestBatch', 'sendTestEmail']);
    // The one function that calls fetch refuses non-alias recipients.
    const src = readFileSync(join('src', 'lib', 'email-send.ts'), 'utf8');
    expect(src).toMatch(/async function postToGmail[\s\S]*?assertTestRecipient\(addr\)[\s\S]*?fetchImpl\(GMAIL_SEND_URL/);
  });
});
