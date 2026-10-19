// Sending reminders through the signed-in admin's own Gmail (gmail.send token from connectGmail(), nothing stored).
// Pattern from nationals-tools public/registration/{email,admin-email}.js: Gmail API raw MIME, From = the admin's
// "Send mail as" alias info@unitedclubgymnastics.org, a pause between messages, a log row per send.
//
// TEST MODE ONLY (step 7). There is deliberately no way to name a recipient from outside this module:
//  - `sendTestEmail` computes its own recipient with `testAlias(...)` from the club id and the admin's choice of jz / ns,
//  - `postToGmail` (the only function that calls fetch) is not exported and refuses anything `isTestAlias` rejects,
//  - no club contact address is ever passed in. Real sends are a later, separately reviewed change.

export const SEND_MODE = 'test' as const;

export const FROM = { name: 'United Club Gymnastics', address: 'info@unitedclubgymnastics.org' } as const;

export type TestWho = 'jz' | 'ns';
const LOCAL_PART: Record<TestWho, string> = { jz: 'jzsharpe', ns: 'nssharpe' };

export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
export const PAUSE_MS = 400; // stay well under Gmail's per-second sending limits

/** Plus-address suffix for a club: its id, lower-case letters, digits and dashes only. */
export function clubSlug(clubId: string): string {
  return clubId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'club';
}

/** `jzsharpe+<club-slug>@gmail.com` (or `nssharpe+…`). Every test send goes to one of these. */
export function testAlias(who: TestWho, clubId: string): string {
  return `${LOCAL_PART[who]}+${clubSlug(clubId)}@gmail.com`;
}

export function isTestAlias(address: string): boolean {
  return /^(jzsharpe|nssharpe)\+[a-z0-9-]+@gmail\.com$/.test(address);
}

export function assertTestRecipient(address: string): string {
  if (!isTestAlias(address)) throw new Error(`Test mode: refusing to send to ${address}. Only jzsharpe+…/nssharpe+…@gmail.com aliases are allowed.`);
  return address;
}

// ---------- MIME ----------

const b64 = (str: string): string => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const wrap76 = (s: string) => s.replace(/.{76}/g, '$&\r\n');

/** One header value: no line breaks (a club name cannot inject a header), RFC 2047 encoded when not plain ASCII. */
export function headerValue(s: string): string {
  const flat = s.replace(/[\r\n]+/g, ' ').trim();
  return /^[\x20-\x7e]*$/.test(flat) ? flat : `=?UTF-8?B?${b64(flat)}?=`;
}

export interface MimeInput {
  fromName: string;
  fromAddress: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}

/** multipart/alternative (plain text, then HTML), base64url-encoded the way the Gmail API's messages.send wants it. */
export function buildMime(m: MimeInput, boundary = `ucg-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`): string {
  const message = [
    `From: ${headerValue(`"${m.fromName.replace(/"/g, '')}"`)} <${m.fromAddress}>`,
    `To: ${m.to.join(', ')}`,
    `Subject: ${headerValue(m.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(m.text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(m.html)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return b64(message).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------- sending ----------

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export class GmailError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** The only place a request is made. Not exported: callers go through sendTestEmail, which picks the recipient itself. */
async function postToGmail(token: string, to: string[], mime: Omit<MimeInput, 'to'>, fetchImpl: FetchLike): Promise<void> {
  for (const addr of to) assertTestRecipient(addr);
  const raw = buildMime({ ...mime, to });
  const res = await fetchImpl(GMAIL_SEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GmailError(body.error?.message ?? `Gmail returned ${res.status}`, res.status);
  }
}

export interface ReminderMessage {
  clubId: string;
  clubName: string;
  subject: string;
  html: string;
  text: string;
}

/** Send one reminder to the club's TEST alias. Returns the alias used. */
export async function sendTestEmail(opts: { token: string; who: TestWho; message: ReminderMessage; fetchImpl?: FetchLike }): Promise<string> {
  const { token, who, message } = opts;
  const to = testAlias(who, message.clubId);
  await postToGmail(token, [to], { fromName: FROM.name, fromAddress: FROM.address, subject: message.subject, html: message.html, text: message.text }, opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike));
  return to;
}

export function explainGmailError(err: unknown): string {
  if (err instanceof GmailError) {
    if (err.status === 401) return 'Your Gmail connection expired (it lasts about an hour). Click Reconnect Gmail and try again.';
    if (err.status === 403) return `Gmail refused: ${err.message}. Check that the Gmail API is turned on for the Firebase project.`;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Could not send.';
}

export interface SendResult {
  clubId: string;
  clubName: string;
  /** The test alias the message went to. */
  to: string;
  ok: boolean;
  error?: string;
  /** Set when the message was sent but writing the log row failed. */
  logError?: string;
}

/**
 * Send messages one at a time to their clubs' test aliases, pausing between them. Stops at a 401 (expired connection): the
 * clubs not reached get no result, so the screen can say how many are left. `onSent` records the log row after each success.
 */
export async function sendTestBatch(opts: {
  token: string;
  who: TestWho;
  messages: ReminderMessage[];
  fetchImpl?: FetchLike;
  pauseMs?: number;
  pause?: (ms: number) => Promise<void>;
  onSent: (result: SendResult, message: ReminderMessage) => Promise<void>;
  onProgress?: (done: number, total: number, result: SendResult) => void;
}): Promise<SendResult[]> {
  const pause = opts.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pauseMs = opts.pauseMs ?? PAUSE_MS;
  const results: SendResult[] = [];
  for (let i = 0; i < opts.messages.length; i++) {
    const message = opts.messages[i];
    let result: SendResult;
    let stop = false;
    try {
      const to = await sendTestEmail({ token: opts.token, who: opts.who, message, fetchImpl: opts.fetchImpl });
      result = { clubId: message.clubId, clubName: message.clubName, to, ok: true };
      try {
        await opts.onSent(result, message);
      } catch (e) {
        result.logError = e instanceof Error ? e.message : 'Could not write the log row.';
      }
    } catch (e) {
      result = { clubId: message.clubId, clubName: message.clubName, to: testAlias(opts.who, message.clubId), ok: false, error: explainGmailError(e) };
      if (e instanceof GmailError && e.status === 401) stop = true;
    }
    results.push(result);
    opts.onProgress?.(results.length, opts.messages.length, result);
    if (stop) break;
    if (i < opts.messages.length - 1) await pause(pauseMs);
  }
  return results;
}
