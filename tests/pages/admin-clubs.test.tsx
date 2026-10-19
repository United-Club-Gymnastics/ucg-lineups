import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClubsScreenData } from '../../src/lib/data/email-store';
import { DEFAULT_TEMPLATES } from '../../src/lib/email-templates';
import { ATHLETES, CLUBS, SAVED, SESSIONS } from '../lib/clubs-fixtures';

const fb = vi.hoisted(() => ({ db: {}, auth: { currentUser: { email: 'admin@unitedclubgymnastics.org' } }, connectGmail: vi.fn() }));
vi.mock('../../src/lib/firebase', () => fb);
const store = vi.hoisted(() => ({
  loadClubsScreenData: vi.fn(), saveClubEmails: vi.fn(), saveOrderDeadline: vi.fn(), saveEmailTemplates: vi.fn(), addEmailLog: vi.fn(), regenerateClubLink: vi.fn(),
}));
vi.mock('../../src/lib/data/email-store', () => store);

import AdminClubs from '../../src/pages/AdminClubs';

function data(over: Partial<ClubsScreenData> = {}): ClubsScreenData {
  return {
    sessions: SESSIONS, athletes: ATHLETES, clubs: CLUBS.map((c) => ({ ...c })), gymOrder: ['Green', 'Red', 'Yellow', 'Orange', 'Purple'], saved: SAVED,
    meetName: 'Test Nationals', deadline: new Date('2027-03-27T06:59:00Z'), templates: DEFAULT_TEMPLATES, log: [], ...over,
  };
}

const fetchMock = vi.fn();
async function open(d = data()) {
  store.loadClubsScreenData.mockResolvedValue(d);
  const user = userEvent.setup();
  render(<AdminClubs meetId="m1" pauseMs={0} />);
  await screen.findByRole('heading', { name: 'Clubs' });
  return user;
}
const decodeTo = (body: string) => {
  const raw = (JSON.parse(body) as { raw: string }).raw.replace(/-/g, '+').replace(/_/g, '/');
  return /^To: (.*)$/m.exec(Buffer.from(raw, 'base64').toString('utf8'))?.[1];
};

beforeEach(() => {
  vi.clearAllMocks();
  store.saveClubEmails.mockResolvedValue(undefined);
  store.saveOrderDeadline.mockResolvedValue(undefined);
  store.saveEmailTemplates.mockResolvedValue(undefined);
  store.addEmailLog.mockResolvedValue(undefined);
  fb.connectGmail.mockResolvedValue('mock-token');
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
});

describe('Clubs table', () => {
  it('shows each club with sessions, level counts, status and last change', async () => {
    await open();
    const row = screen.getByRole('row', { name: /Alpha Gymnastics/ });
    expect(within(row).getByText('Session 1 · Orange')).toBeInTheDocument();
    expect(within(row).getByText('Silver XS 3')).toBeInTheDocument();
    expect(within(row).getByText('Still A–Z (default)')).toBeInTheDocument();
    expect(within(row).getByText('Order set')).toBeInTheDocument();
    expect(within(row).getByText('Oct 18, 3:40 PM PT')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Bravo Academy/ })).getByText('Needs to decide a split')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Charlie Club/ })).getByText('Set by UCG')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Echo Elite/ })).getByText('Nothing to order')).toBeInTheDocument();
  });

  it('filters by status and by search text', async () => {
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Status'), 'split');
    expect(screen.getByText('1 of 5 clubs')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Alpha/ })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'all');
    await user.type(screen.getByLabelText('Search clubs or emails'), 'echo@');
    expect(screen.getByText('1 of 5 clubs')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Echo Elite/ })).toBeInTheDocument();
  });

  it('saves edited contact emails on blur (parsed, lower-cased) and refuses junk', async () => {
    const user = await open();
    const box = screen.getByLabelText('Contact emails for Delta Gym');
    await user.type(box, 'New@Delta.example; other@delta.example');
    await user.tab();
    await waitFor(() => expect(store.saveClubEmails).toHaveBeenCalledWith(fb.db, 'm1', 'delta-gym', ['new@delta.example', 'other@delta.example']));
    await user.clear(box);
    await user.type(box, 'not an address');
    await user.tab();
    expect(await screen.findByText(/Not an email address: not, an, address/)).toBeInTheDocument();
    expect(store.saveClubEmails).toHaveBeenCalledTimes(1);
  });

  it('Regenerate link asks first, then calls the store once and reports the result', async () => {
    store.regenerateClubLink.mockResolvedValue({ token: 'newTok', copied: 2, oldLinkRemoved: true });
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Regenerate link for Alpha Gymnastics' }));
    const dlg = screen.getByRole('dialog');
    expect(dlg).toHaveTextContent('The old link stops working straight away');
    expect(dlg).toHaveTextContent('saved orders are copied');
    expect(store.regenerateClubLink).not.toHaveBeenCalled();
    await user.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(store.regenerateClubLink).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Regenerate link for Alpha Gymnastics' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate link' }));
    await waitFor(() => expect(store.regenerateClubLink).toHaveBeenCalledTimes(1));
    expect(store.regenerateClubLink.mock.calls[0][2]).toEqual(expect.objectContaining({ id: 'alpha-gymnastics', token: 'tokAlpha' }));
    expect(await screen.findByText(/new link ready\. 2 saved orders were moved to it\. The old link no longer works\./)).toBeInTheDocument();
  });

  it('a failed regenerate says the link was not changed', async () => {
    store.regenerateClubLink.mockRejectedValue(new Error('network'));
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Regenerate link for Delta Gym' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regenerate link' }));
    expect(await screen.findByText(/the link was NOT changed \(network\)\. Nothing was lost\./)).toBeInTheDocument();
  });
});

describe('Deadline', () => {
  it('shows the saved deadline in Pacific time and saves a new one as an instant', async () => {
    const user = await open();
    expect(screen.getByLabelText('Date')).toHaveValue('2027-03-26');
    expect(screen.getByLabelText('Time (Pacific)')).toHaveValue('23:59');
    expect(screen.getByText('Saved deadline: Fri Mar 26, 11:59 PM PT')).toBeInTheDocument();
    const dateBox = screen.getByLabelText('Date');
    await user.clear(dateBox);
    await user.type(dateBox, '2027-04-01');
    await user.click(screen.getByRole('button', { name: 'Save deadline' }));
    await waitFor(() => expect(store.saveOrderDeadline).toHaveBeenCalledWith(fb.db, 'm1', new Date('2027-04-02T06:59:00Z')));
  });
});

describe('Reminders', () => {
  it('shows the two lists with counts and the clubs with no email separately', async () => {
    const user = await open();
    expect(screen.getByRole('button', { name: 'Still A–Z (1)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Needs to decide a split (1)' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: /Still A–Z reminder/ });
    expect(within(list).getByText('Alpha Gymnastics')).toBeInTheDocument();
    expect(within(list).getByText('Session 1 · Orange')).toBeInTheDocument();
    expect(screen.getByText('No email — add one above')).toBeInTheDocument();
    expect(screen.getByText(/Delta Gym/, { selector: '.adm-banner' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Needs to decide a split (1)' }));
    expect(within(screen.getByRole('list', { name: /Needs to decide a split reminder/ })).getByText('Bravo Academy')).toBeInTheDocument();
  });

  it('previews From, To (test alias + struck-through real address), Subject, the HTML and the text version', async () => {
    const user = await open();
    const head = screen.getByRole('heading', { name: 'Preview' }).parentElement!;
    expect(head).toHaveTextContent('United Club Gymnastics <info@unitedclubgymnastics.org>');
    expect(within(head).getByText('jzsharpe+alpha-gymnastics@gmail.com')).toBeInTheDocument();
    const real = within(head).getByText('coach@alpha.example');
    expect(real.tagName).toBe('S');
    expect(head).toHaveTextContent('Reminder: set your competing order for Test Nationals');
    const frame = head.querySelector('iframe')!;
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('srcdoc')).toContain('<li>Session 1 · Orange</li>');
    expect(frame.getAttribute('srcdoc')).toContain('Fri Mar 26, 11:59 PM PT');
    expect(frame.getAttribute('srcdoc')).toContain('/#/c/tokAlpha');
    expect(head).toHaveTextContent('Plain-text version');
    await user.click(screen.getByRole('radio', { name: 'nssharpe+…@gmail.com' }));
    expect(within(head).getByText('nssharpe+alpha-gymnastics@gmail.com')).toBeInTheDocument();
  });

  it('edited wording shows in the preview at once and saves to emailSettings; Reset restores the default', async () => {
    const user = await open();
    const subject = screen.getByLabelText('Subject');
    await user.clear(subject);
    await user.type(subject, 'Hello {{club}');
    expect(screen.getByRole('heading', { name: 'Preview' }).parentElement).toHaveTextContent('Hello Alpha Gymnastics');
    await user.click(screen.getByRole('button', { name: 'Save messages' }));
    await waitFor(() => expect(store.saveEmailTemplates).toHaveBeenCalledWith(fb.db, 'm1', expect.objectContaining({ az: expect.objectContaining({ subject: 'Hello {club}' }), split: DEFAULT_TEMPLATES.split })));
    await user.click(screen.getByRole('button', { name: 'Reset this message to the default' }));
    expect(screen.getByLabelText('Subject')).toHaveValue(DEFAULT_TEMPLATES.az.subject);
  });
});

describe('Sending (test mode, Gmail mocked)', () => {
  it('has a disabled real-send control with the note, and send needs a Gmail connection', async () => {
    await open();
    const real = screen.getByRole('checkbox', { name: /Send to real club addresses/ });
    expect(real).toBeDisabled();
    expect(screen.getByText("Needs Julia's go-ahead for each send")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send 1 test email' })).toBeDisabled();
  });

  it('sends only to test aliases, shows progress and per-recipient results, logs the send, then skips the club the next time', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Connect Gmail' }));
    expect(await screen.findByText('Connected as admin@unitedclubgymnastics.org.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send 1 test email' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send 1 test email' }));
    await screen.findByText('Sent 1 of 1 test email.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(decodeTo(fetchMock.mock.calls[0][1].body)).toBe('jzsharpe+alpha-gymnastics@gmail.com');
    expect(fetchMock.mock.calls[0][1].body).not.toContain('coach@alpha.example');
    expect(store.addEmailLog).toHaveBeenCalledWith(fb.db, 'm1', expect.objectContaining({
      template: 'az', clubId: 'alpha-gymnastics', club: 'Alpha Gymnastics', to: 'jzsharpe+alpha-gymnastics@gmail.com', by: 'admin@unitedclubgymnastics.org',
    }));
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Send results' })).getByText(/→ jzsharpe\+alpha-gymnastics@gmail.com: Sent/)).toBeInTheDocument();
    const log = within(screen.getByRole('heading', { name: 'Send log' }).parentElement!);
    expect(log.getByRole('row', { name: /Alpha Gymnastics/ })).toHaveTextContent('test');
    // Same reminder, same day: nothing left to send.
    expect(screen.getByRole('button', { name: 'Send 0 test emails' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Skip clubs already sent this reminder today/ }));
    expect(screen.getByRole('button', { name: 'Send 1 test email' })).toBeEnabled();
  });

  it('lets the admin pick nssharpe, and a club can be unticked', async () => {
    const user = await open();
    await user.click(screen.getByRole('radio', { name: 'nssharpe+…@gmail.com' }));
    await user.click(screen.getByRole('button', { name: 'Connect Gmail' }));
    await screen.findByText(/Connected as/);
    await user.click(screen.getByRole('button', { name: 'Send 1 test email' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send 1 test email' }));
    await screen.findByText('Sent 1 of 1 test email.');
    expect(decodeTo(fetchMock.mock.calls[0][1].body)).toBe('nssharpe+alpha-gymnastics@gmail.com');
    await user.click(screen.getByRole('checkbox', { name: 'Alpha Gymnastics' }));
    expect(screen.getByRole('button', { name: 'Send 0 test emails' })).toBeDisabled();
  });

  it('reports a failed send per recipient and does not log it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { message: 'API off' } }) });
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Connect Gmail' }));
    await screen.findByText(/Connected as/);
    await user.click(screen.getByRole('button', { name: 'Send 1 test email' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send 1 test email' }));
    await screen.findByText('Sent 0 of 1 test email.');
    expect(screen.getByText(/Gmail refused: API off/)).toBeInTheDocument();
    expect(store.addEmailLog).not.toHaveBeenCalled();
  });

  it('shows the existing log, newest first, and skips clubs the log says were sent today', async () => {
    const earlier = { id: 'old', template: 'az' as const, clubId: 'alpha-gymnastics', club: 'Alpha Gymnastics', to: 'jzsharpe+alpha-gymnastics@gmail.com', subject: 'S', at: new Date(), by: 'x@unitedclubgymnastics.org', mode: 'test' as const };
    await open(data({ log: [earlier] }));
    expect(screen.getByRole('button', { name: 'Send 0 test emails' })).toBeDisabled();
    expect(screen.getByText(/sent today/)).toBeInTheDocument();
    expect(screen.getByText('x@unitedclubgymnastics.org')).toBeInTheDocument();
  });
});

describe('Loading', () => {
  it('a failed load shows the error and a retry, never default statuses', async () => {
    store.loadClubsScreenData.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(<AdminClubs meetId="m1" />);
    expect(await screen.findByText('offline')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Gymnastics')).not.toBeInTheDocument();
    store.loadClubsScreenData.mockResolvedValue(data());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Clubs' })).toBeInTheDocument();
  });
});
