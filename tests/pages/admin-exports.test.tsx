import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportsInput } from '../../src/lib/data/export-store';

vi.mock('../../src/lib/firebase', () => ({ db: {} }));
const store = vi.hoisted(() => ({ loadExportsInput: vi.fn(), saveMeetNameDate: vi.fn(), saveScheduleRow: vi.fn(), saveScheduleOverride: vi.fn(), runScheduleMigration: vi.fn(), saveSheetLists: vi.fn(), loadPublishedSheets: vi.fn(), publishSheets: vi.fn(), unpublishSheets: vi.fn() }));
vi.mock('../../src/lib/data/export-store', () => store);
const files = vi.hoisted(() => ({ sessionPdf: vi.fn(), allSessionsPdf: vi.fn(), allSessionsZip: vi.fn() }));
vi.mock('../../src/lib/pdf/files', () => files);

import AdminExports from '../../src/pages/AdminExports';
import { MEET, magFixture, tntFixture, wagInfinityFixture } from '../pdf/fixtures';
import { choose, optionLabels } from '../helpers/select';

function input(over: Partial<ExportsInput> = {}): ExportsInput {
  const mag = magFixture();
  const wag = wagInfinityFixture();
  const tnt = tntFixture();
  return {
    sessions: [mag.session, wag.session, tnt.session, { id: 's3-red', number: 3, gym: 'Red', discipline: 'WAG', levelCodes: ['XS'] }],
    athletes: [...mag.athletes, ...wag.athletes, ...tnt.athletes],
    gymOrder: ['Green', 'Red', 'Yellow', 'Orange', 'Purple'],
    ordersByClub: {},
    meet: { meetName: MEET.name, meetDate: MEET.date, gymOrder: ['Green', 'Red', 'Yellow', 'Orange', 'Purple'], schedule: {} },
    squadDocs: { [mag.session.id]: mag.stored, [wag.session.id]: wag.stored, [tnt.session.id]: tnt.stored },
    synchroPairs: tnt.pairs.map((p) => ({ id: p.id, level: p.level, a1: '', name1: p.name1, club1: p.club1, a2: '', name2: p.name2, club2: p.club2, createdAt: null, source: '' })),
    ...over,
  };
}

async function open(inp = input()) {
  store.loadExportsInput.mockResolvedValue(inp);
  const user = userEvent.setup();
  render(<AdminExports meetId="m1" />);
  await screen.findByRole('heading', { name: 'Meet' });
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.saveMeetNameDate.mockResolvedValue(undefined);
  store.saveScheduleRow.mockResolvedValue(undefined);
  store.saveScheduleOverride.mockResolvedValue(undefined);
  store.runScheduleMigration.mockResolvedValue(undefined);
  store.saveSheetLists.mockResolvedValue(0);
  store.loadPublishedSheets.mockResolvedValue({});
  store.publishSheets.mockResolvedValue(undefined);
  store.unpublishSheets.mockResolvedValue(4);
  files.sessionPdf.mockResolvedValue({ name: 'Session 1 - Orange - Scorecards.pdf', bytes: new ArrayBuffer(8) });
  files.allSessionsPdf.mockResolvedValue({ name: 'All Sessions - Scorecards.pdf', bytes: new ArrayBuffer(8) });
  files.allSessionsZip.mockResolvedValue({ name: 'All Sessions - Scorecards.zip', bytes: new Blob(['z']) });
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('Exports screen', () => {
  it('lists sessions in gym order and previews every page of the first one', async () => {
    await open();
    const select = screen.getByLabelText('Session');
    expect(await optionLabels(userEvent.setup(), select)).toEqual([
      'Session 2 – Green (WAG)', 'Session 3 – Red (WAG)', 'Session 1 – Orange (MAG)', 'Session 1 – Purple (T&T)',
    ]);
    expect(select).toHaveTextContent('Session 2 – Green (WAG)');
    const pages = screen.getAllByRole('region', { name: /^Page \d+ of \d+:/ });
    expect(pages.length).toBeGreaterThan(10);
    expect(pages[0].getAttribute('aria-label')).toMatch(/^Page 1 of \d+: Vault, Squad A$/);
  });

  it('saves each session\'s sheet list for the scorecard photo app', async () => {
    await open();
    await waitFor(() => expect(store.saveSheetLists).toHaveBeenCalledTimes(1));
    const [, meetId, lists] = store.saveSheetLists.mock.calls[0];
    expect(meetId).toBe('m1');
    expect(Object.keys(lists).sort()).toEqual(['s1-orange', 's1-purple', 's2-green', 's3-red'].sort());
    const mag = lists['s1-orange'];
    expect(mag).toMatchObject({ name: 'Session 1', location: 'Orange', discipline: 'MAG' });
    expect(mag.sheets.length).toBeGreaterThan(0);
    expect(mag.keys[0]).toMatch(/^[A-Z]{2}\/[A-Z]\/1$/);
    expect(lists['s3-red'].sheets).toEqual([]);
    expect(screen.queryByText(/Could not save the sheet list/)).toBeNull();
  });

  it('says when the sheet list could not be saved', async () => {
    store.saveSheetLists.mockRejectedValue(new Error('offline'));
    await open();
    expect(await screen.findByText(/Could not save the sheet list/)).toBeInTheDocument();
  });

  it('shows the meet name and date in the pages, and Save writes them', async () => {
    const user = await open();
    const page = screen.getAllByRole('region', { name: /^Page 1 of/ })[0];
    expect(within(page).getByText(MEET.name)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Meet name'));
    await user.type(screen.getByLabelText('Meet name'), 'Nationals X');
    expect(within(screen.getAllByRole('region', { name: /^Page 1 of/ })[0]).getByText('Nationals X')).toBeInTheDocument();
    expect(screen.getByText(/Not saved yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.saveMeetNameDate).toHaveBeenCalledWith({}, 'm1', { meetName: 'Nationals X', meetDate: MEET.date }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('the jump bar has a row per apparatus with squad letters in arrival order, and moves to the page', async () => {
    const user = await open();
    await choose(user, screen.getByLabelText('Session'), 's1-orange');
    const nav = screen.getByRole('navigation', { name: 'Jump to a page' });
    const rows = [...nav.querySelectorAll('.ex-jump-row')].map((r) => r.textContent);
    expect(rows).toEqual(['FXAFEDCB', 'PHBAFEDC', 'SRCBAFED', 'VTDCBAFE', 'PBEDCBAF', 'HBFEDCBA']);
    await user.click(within(nav).getByRole('button', { name: 'FX F, page 2' }));
    const target = document.getElementById('ex-p2')!;
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(target).toHaveFocus();
  });

  it('switches to the rotation sheet: one page per session', async () => {
    const user = await open();
    await choose(user, screen.getByLabelText('Session'), 's1-orange');
    await user.click(screen.getByRole('button', { name: 'Rotation sheet' }));
    const pages = screen.getAllByRole('region', { name: /^Page \d+ of/ });
    expect(pages).toHaveLength(1);
    expect(within(pages[0]).getByText('UCG Nationals 2026 (sample) – Session 1 – Orange')).toBeInTheDocument();
    expect(within(pages[0]).getByText('MAG – Orange Gym – Dev, Int, Adv')).toBeInTheDocument();
    expect(within(pages[0]).getByText('Squad A')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Jump to a page' })).not.toBeInTheDocument();
  });

  it('lists sessions with no saved squads or unplaced athletes, and still allows the download', async () => {
    const inp = input();
    const mag = magFixture();
    inp.squadDocs = { ...inp.squadDocs, [mag.session.id]: { ...mag.stored, squads: mag.stored.squads.map((s, i) => (i === 0 ? { ...s, cards: [] } : s)) } };
    const user = await open(inp);
    const warn = screen.getByRole('heading', { name: 'Check before printing' }).closest('section')!;
    expect(within(warn).getByText(/Session 3 – Red:/)).toBeInTheDocument();
    expect(within(warn).getByText(/No squads saved yet/)).toBeInTheDocument();
    expect(within(warn).getByText(/Session 1 – Orange:/)).toBeInTheDocument();
    expect(within(warn).getByText(/not placed in a squad/)).toBeInTheDocument();
    await choose(user, screen.getByLabelText('Session'), 's3-red');
    expect(screen.getByText(/Nothing to print for Session 3 – Red/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All sessions, one PDF' })).toBeEnabled();
  });

  it('warns when the Synchro tool could not be read', async () => {
    await open(input({ synchroPairs: null }));
    expect(screen.getByText(/The Synchro tool could not be read/)).toBeInTheDocument();
  });

  it('downloads this session, all sessions in one PDF, and a zip', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Download this session' }));
    await waitFor(() => expect(files.sessionPdf).toHaveBeenCalledTimes(1));
    expect(files.sessionPdf.mock.calls[0][0]).toBe('scorecards');
    expect(files.sessionPdf.mock.calls[0][1]).toMatchObject({ type: 'artistic', id: 's2-green' });
    expect(await screen.findByText('Downloaded Session 1 - Orange - Scorecards.pdf.')).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Rotation sheet' }));
    await user.click(screen.getByRole('button', { name: 'All sessions, one PDF' }));
    await waitFor(() => expect(files.allSessionsPdf).toHaveBeenCalledTimes(1));
    const [kind, all, gymOrder] = files.allSessionsPdf.mock.calls[0];
    expect(kind).toBe('rotation');
    expect(all).toHaveLength(4);
    expect(gymOrder).toEqual(['Green', 'Red', 'Yellow', 'Orange', 'Purple']);

    await user.click(screen.getByRole('button', { name: 'All sessions, separate PDFs' }));
    await waitFor(() => expect(files.allSessionsZip).toHaveBeenCalledTimes(1));
  });

  it('reports a failed download without losing the screen', async () => {
    files.sessionPdf.mockRejectedValue(new Error('boom'));
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Download this session' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByRole('button', { name: 'Download this session' })).toBeEnabled();
  });

  it('the schedule table has a row per session name; typing shows in the sheets at once and Save writes just the changed rows', async () => {
    const user = await open();
    const table = screen.getByRole('table', { name: 'Session schedule by session name' });
    expect(within(table).getAllByRole('row').slice(1).map((r) => within(r).getByRole('rowheader').textContent)).toEqual(['Session 1', 'Session 2', 'Session 3']);
    await user.type(screen.getByLabelText('Session 1 date'), '2026-10-22');
    await user.type(screen.getByLabelText('Session 1 competition'), '7:30 AM');
    await user.type(screen.getByLabelText('Session 1 open stretch'), '6:45 AM');
    // T&T Session 1 – Purple: the rotation sheet title is weekday + competition; the header carries the session's date
    await choose(user, screen.getByLabelText('Session'), 's1-purple');
    await user.click(screen.getByRole('button', { name: 'Rotation sheet' }));
    expect(screen.getAllByText('T&T Session 1 – Purple · Thursday 7:30 AM').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Scorecards' }));
    expect(within(screen.getAllByRole('region', { name: /^Page 1 of/ })[0]).getByText('October 22, 2026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rotation sheet' }));
    // artistic rotation sheet: the times; Session 2 has no date so it still prints the single meet date
    await choose(user, screen.getByLabelText('Session'), 's1-orange');
    expect(screen.getByText('6:45 AM')).toBeInTheDocument();
    await choose(user, screen.getByLabelText('Session'), 's2-green');
    await user.click(screen.getByRole('button', { name: 'Scorecards' }));
    expect(within(screen.getAllByRole('region', { name: /^Page 1 of/ })[0]).getByText(MEET.date)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(store.saveScheduleRow).toHaveBeenCalledTimes(1));
    expect(store.saveScheduleRow).toHaveBeenCalledWith({}, 'm1', '1', { date: '2026-10-22', stretch: '6:45 AM', warmups: '', competition: '7:30 AM' });
  });

  it('a session override wins per field over its number\'s row, and saves on the session', async () => {
    const user = await open(input({ meet: { ...input().meet, schedule: { '1': { date: '2026-10-22', stretch: '6:45 AM', competition: '7:30 AM' } } } }));
    await choose(user, screen.getByLabelText('Session'), 's1-purple');
    await user.click(screen.getByRole('button', { name: 'Rotation sheet' }));
    expect(screen.getAllByText('T&T Session 1 – Purple · Thursday 7:30 AM').length).toBeGreaterThan(0);
    await user.click(screen.getByText(/Session overrides/));
    await user.type(screen.getByLabelText('Session 1 – Purple competition'), '9:00 AM');
    expect(screen.getAllByText('T&T Session 1 – Purple · Thursday 9:00 AM').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(() => expect(store.saveScheduleOverride).toHaveBeenCalledWith({}, 'm1', 's1-purple', { date: '', stretch: '', warmups: '', competition: '9:00 AM' }));
    // Orange is Session 1 too and keeps the row
    await choose(user, screen.getByLabelText('Session'), 's1-orange');
    expect(screen.getByText('6:45 AM')).toBeInTheDocument();
  });

  it('offers the one-time move of old times, and only runs it when asked', async () => {
    const inp = input({ meet: { ...input().meet, schedule: { '1': { competition: '7:30 AM' } } } });
    inp.sessions = inp.sessions.map((s) => (s.id === 's1-purple' ? { ...s, competitionTime: 'Thursday 9:00 AM' } : s));
    const mag = magFixture();
    const wag = wagInfinityFixture();
    inp.squadDocs = { ...inp.squadDocs, [wag.session.id]: { ...wag.stored, schedule: { stretch: '', warmups: '', competition: '' } }, [mag.session.id]: { ...mag.stored, schedule: { stretch: '6:45 AM', warmups: '', competition: '7:30 AM' } } };
    const user = await open(inp);
    const note = screen.getByTestId('schedule-migration');
    expect(note).toHaveTextContent('2 sessions have times saved the old way');
    expect(note).toHaveTextContent('2 times differ from the schedule above');
    expect(note).toHaveTextContent('1 already match and would be dropped');
    expect(store.runScheduleMigration).not.toHaveBeenCalled();
    await user.click(within(note).getByRole('button', { name: 'Move existing times into the schedule' }));
    await waitFor(() => expect(store.runScheduleMigration).toHaveBeenCalledTimes(1));
    const plan = store.runScheduleMigration.mock.calls[0][2];
    expect(plan.overrides).toEqual({ 's1-purple': { competition: 'Thursday 9:00 AM' }, 's1-orange': { stretch: '6:45 AM' } });
  });

  it('T&T scorecards jump bar: TR, DM, TU, SY', async () => {
    const user = await open();
    await choose(user, screen.getByLabelText('Session'), 's1-purple');
    const nav = screen.getByRole('navigation', { name: 'Jump to a page' });
    expect([...nav.querySelectorAll('.ex-jump-l')].map((e) => e.textContent)).toEqual(['TR', 'DM', 'TU', 'SY']);
  });

  it('shows an error with Try again when the data cannot be read', async () => {
    store.loadExportsInput.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(<AdminExports meetId="m1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    store.loadExportsInput.mockResolvedValue(input());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Meet' })).toBeInTheDocument();
  });
});

describe('Publish sheets (the public sheets page)', () => {
  it('publishes one document per session from what is saved; Unpublish asks first', async () => {
    const user = await open();
    expect(await screen.findByText('Not published.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Publish sheets' }));
    await waitFor(() => expect(store.publishSheets).toHaveBeenCalledTimes(1));
    const [, meetId, docs] = store.publishSheets.mock.calls[0];
    expect(meetId).toBe('m1');
    expect(Object.keys(docs).sort()).toEqual(['s1-orange', 's1-purple', 's2-green', 's3-red'].sort());
    expect(docs['s1-orange']).toMatchObject({ v: 1, title: 'Session 1 – Orange' });
    expect(JSON.parse(docs['s1-orange'].input).type).toBe('artistic');
    expect(await screen.findByText('Published 4 sessions.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /page$/ })).toHaveAttribute('href', expect.stringMatching(/#\/sheets\/m1\/[^?]+\?doc=scorecards$/));

    await user.click(screen.getByRole('button', { name: 'Unpublish' }));
    expect(store.unpublishSheets).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Unpublish' }));
    await waitFor(() => expect(store.unpublishSheets).toHaveBeenCalledWith({}, 'm1'));
    expect(await screen.findByText(/Unpublished 4 sessions/)).toBeInTheDocument();
  });

  it('waits for unsaved meet or schedule changes', async () => {
    const user = await open();
    await user.type(screen.getByLabelText('Meet name'), ' 2027');
    expect(screen.getByRole('button', { name: 'Publish sheets' })).toBeDisabled();
    expect(screen.getByText(/Save the meet name and schedule above first/)).toBeInTheDocument();
  });

  it('says what is already published', async () => {
    store.loadPublishedSheets.mockResolvedValue({ 's1-orange': new Date('2027-04-01T16:00:00Z'), 's2-green': null });
    await open();
    expect(await screen.findByText(/^Published: 2 of 4 sessions, last Apr 1, 9:00 AM PT\.$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish sheets again' })).toBeEnabled();
  });
});
