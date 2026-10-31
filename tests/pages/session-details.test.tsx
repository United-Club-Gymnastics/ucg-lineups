// Session reminders on Clubs & email (Julia 2026-10-30), laid out like the UCG platform's: Draft email, Publish sheets, Send,
// Send log (2026-10-31). Invented people only.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClubsScreenData } from '../../src/lib/data/email-store';
import { DEFAULT_TEMPLATES } from '../../src/lib/email-templates';
import { LINEUPS_SESSION_TEMPLATE } from '../../src/lib/session-details';
import { ATHLETES, CLUBS, SAVED, SESSIONS } from '../lib/clubs-fixtures';

const fb = vi.hoisted(() => ({ db: {}, auth: { currentUser: { email: 'admin@unitedclubgymnastics.org' } }, connectGmail: vi.fn() }));
vi.mock('../../src/lib/firebase', () => fb);
const store = vi.hoisted(() => ({
  watchClubsLive: vi.fn(() => () => {}),
  loadClubsScreenData: vi.fn(), saveClubEmails: vi.fn(), saveOrderDeadline: vi.fn(), saveEmailTemplates: vi.fn(), addEmailLog: vi.fn(), regenerateClubLink: vi.fn(),
  saveSessionTemplate: vi.fn(), saveCoachRoles: vi.fn(), loadOtherSessionTemplates: vi.fn(),
}));
vi.mock('../../src/lib/data/email-store', () => store);
vi.mock('../../src/lib/data/meet-store', () => ({ listMeets: vi.fn() }));
vi.mock('../../src/lib/data/orders-copy-store', () => ({ loadOrderCopyInput: vi.fn(), applyOrderCopy: vi.fn() }));
const sheets = vi.hoisted(() => ({ loadPublishedSheets: vi.fn(), loadExportsInput: vi.fn(), publishSheets: vi.fn(), unpublishSheets: vi.fn() }));
vi.mock('../../src/lib/data/export-store', () => sheets);

import AdminClubs from '../../src/pages/AdminClubs';
import { choose } from '../helpers/select';

// Session 1 Orange: Alpha's three XS athletes get addresses (Bea's is missing); Alpha has a head coach and a treasurer.
const athletes = ATHLETES.map((a) => (a.sessionId === 's1-orange' && a.clubId === 'alpha-gymnastics' && a.first !== 'Bea' ? { ...a, email: `${a.first.toLowerCase()}@example.org` } : a));
const clubs = CLUBS.map((c) => (c.id === 'alpha-gymnastics'
  ? { ...c, contacts: [{ name: 'Casey Coach', email: 'casey@example.org', role: 'Head Coach' }, { name: 'Tess Treasurer', email: 'tess@example.org', role: 'Treasurer' }] }
  : { ...c }));

function data(over: Partial<ClubsScreenData> = {}): ClubsScreenData {
  return {
    sessions: SESSIONS, athletes, clubs, gymOrder: ['Green', 'Red', 'Yellow', 'Orange', 'Purple'], saved: SAVED,
    meetName: 'Test Nationals', deadline: null, templates: DEFAULT_TEMPLATES, log: [],
    sessionTemplate: LINEUPS_SESSION_TEMPLATE, coachRoles: null, schedule: { 1: { date: '2027-04-09', competition: '8:45 AM' } }, meetDate: '', ...over,
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
type Step = 'Draft email' | 'Publish sheets' | 'Send' | 'Send log';
const pick = async (user: ReturnType<typeof userEvent.setup>, step: Step) => {
  await user.click(screen.getByRole('button', { name: 'Session reminders' }));
  await user.click(screen.getByRole('button', { name: step }));
};
const decode = (body: string) => Buffer.from((JSON.parse(body) as { raw: string }).raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

beforeEach(() => {
  vi.clearAllMocks();
  store.watchClubsLive.mockImplementation(() => () => {});
  store.addEmailLog.mockResolvedValue(undefined);
  store.saveSessionTemplate.mockResolvedValue(undefined);
  store.saveCoachRoles.mockResolvedValue(undefined);
  sheets.loadPublishedSheets.mockResolvedValue({ 's1-orange': new Date('2027-04-01T16:00:00Z') });
  store.loadOtherSessionTemplates.mockResolvedValue([{ meetId: 'm0', meetName: 'Prelims', template: { ...LINEUPS_SESSION_TEMPLATE, intro: 'Copied intro.' } }]);
  fb.connectGmail.mockResolvedValue('mock-token');
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
});

describe('Session details', () => {
  it('has its own pill with four steps; the club reminders no longer offer it', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Message & preview' }));
    expect(screen.queryByRole('button', { name: 'Session details' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Session reminders' }));
    expect(['Draft email', 'Publish sheets', 'Send', 'Send log'].map((n) => screen.getByRole('button', { name: n }))).toHaveLength(4);
    expect(screen.getByRole('heading', { name: 'Email text' })).toBeInTheDocument();
    expect(screen.getByText(/^This meet’s saved text\.$/)).toBeInTheDocument();
    await pick(user, 'Publish sheets');
    expect(await screen.findByRole('link', { name: /^Open the sheets page for Session 1/ })).toHaveAttribute('href', expect.stringContaining('#/sheets/m1/s1-orange?doc=rotation'));
    await pick(user, 'Send log');
    const logCard = screen.getAllByRole('heading', { name: 'Send log' }).find((h) => !h.closest('[hidden]'))!.closest('section')!;
    expect(logCard).toHaveTextContent('Nothing sent yet.');
  });

  it('Draft email: edit, Preview a real athlete or coach, copy text from another meet, save', async () => {
    const user = await open(data({ sessionTemplateSaved: false }));
    await pick(user, 'Draft email');
    expect(screen.getByText(/^Starting text: UCG default, not saved yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const frame = () => screen.getByTitle(/^Session details email to/) as HTMLIFrameElement;
    expect(frame().getAttribute('srcdoc')).toContain('Hello Ada!');
    expect(frame().getAttribute('srcdoc')).toContain('Session 1 - Orange (WAG): Competition Details');
    expect(frame().getAttribute('srcdoc')).toContain('#/sheets/m1/s1-orange?doc=rotation');
    expect(screen.getByText('Friday, April 9, 2027', { exact: false, selector: 'pre' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Coach' }));
    expect(frame().getAttribute('srcdoc')).toContain('Hello Casey!');
    expect(frame().getAttribute('srcdoc')).toContain('Your athletes in this session');

    await user.click(screen.getByRole('button', { name: 'View draft' }));
    await choose(user, screen.getByLabelText('Copy text from'), 'm0');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.getByLabelText('Introduction')).toHaveValue('Copied intro.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.saveSessionTemplate).toHaveBeenCalledWith(fb.db, 'm1', expect.objectContaining({ intro: 'Copied intro.' })));
  });

  it('refuses a call-out link that is not http(s)', async () => {
    const user = await open();
    await pick(user, 'Draft email');
    await user.type(screen.getByLabelText('Call-out button link'), 'example.org');
    expect(screen.getByRole('alert')).toHaveTextContent('A link must start with http:// or https://.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('lists the session’s athletes and coaches, flags who has no address, and sends to test aliases with a log row each', async () => {
    const user = await open();
    await pick(user, 'Send');
    // Roles: "Head Coach" ticked by default, Treasurer not.
    expect(screen.getByRole('checkbox', { name: 'Head Coach (1)' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Treasurer (1)' })).not.toBeChecked();
    const list = screen.getByRole('list', { name: 'People to send the session details email to' });
    expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('label')!.textContent)).toEqual(['Casey Coach', 'Ada Test', 'Cy Test']);
    expect(screen.getByText(/No address/).closest('details')).toHaveTextContent('Bea Test (Alpha Gymnastics)');
    expect(screen.getByText(/Bravo Academy: no coach address/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Connect Gmail' }));
    await user.click(screen.getByRole('button', { name: 'Send 3 test emails' }));
    const dlg = screen.getByRole('dialog');
    expect(dlg).toHaveTextContent('Nothing goes to athletes or coaches');
    await user.click(within(dlg).getByRole('button', { name: 'Send 3 test emails' }));
    await screen.findByText('Sent 3 of 3 test emails.');
    const to = fetchMock.mock.calls.map((c) => /^To: (.*)$/m.exec(decode(c[1].body))![1]);
    expect(to.every((t) => /^jzsharpe\+[a-z0-9-]+@gmail\.com$/.test(t))).toBe(true);
    expect(to.join(' ')).not.toMatch(/example\.org/);
    expect(store.addEmailLog).toHaveBeenCalledTimes(3);
    expect(store.addEmailLog.mock.calls[0][2]).toMatchObject({ template: 'session', sessionId: 's1-orange', recipientKey: 'c:casey@example.org' });
    // Already sent this session: skipped by default.
    expect(screen.getByRole('button', { name: 'Send 0 test emails' })).toBeDisabled();
    await pick(user, 'Send log');
    const log = screen.getAllByRole('table').find((t) => !t.closest('[hidden]'))!;
    expect(within(log).getAllByRole('row')).toHaveLength(4);
    expect(log).toHaveTextContent('Casey Coach · Session 1 - Orange (WAG)');
  });

  it('Preview on a person in Send shows their email in Draft email', async () => {
    const user = await open();
    await pick(user, 'Send');
    await user.click(screen.getByRole('button', { name: 'Preview Casey Coach' }));
    expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument();
    expect((screen.getByTitle(/^Session details email to/) as HTMLIFrameElement).getAttribute('srcdoc')).toContain('Hello Casey!');
  });

  it('saving coach roles stores the ticked roles', async () => {
    const user = await open();
    await pick(user, 'Send');
    await user.click(screen.getByRole('checkbox', { name: 'Treasurer (1)' }));
    expect(within(screen.getByRole('list', { name: 'People to send the session details email to' })).getByText('Tess Treasurer')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save coach roles' }));
    await waitFor(() => expect(store.saveCoachRoles).toHaveBeenCalledWith(fb.db, 'm1', ['Head Coach', 'Treasurer']));
  });
});
