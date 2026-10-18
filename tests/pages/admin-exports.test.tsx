import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportsInput } from '../../src/lib/data/export-store';

vi.mock('../../src/lib/firebase', () => ({ db: {} }));
const store = vi.hoisted(() => ({ loadExportsInput: vi.fn(), saveMeetNameDate: vi.fn(), saveCompetitionTime: vi.fn() }));
vi.mock('../../src/lib/data/export-store', () => store);
const files = vi.hoisted(() => ({ sessionPdf: vi.fn(), allSessionsPdf: vi.fn(), allSessionsZip: vi.fn() }));
vi.mock('../../src/lib/pdf/files', () => files);

import AdminExports from '../../src/pages/AdminExports';
import { MEET, magFixture, tntFixture, wagInfinityFixture } from '../pdf/fixtures';

function input(over: Partial<ExportsInput> = {}): ExportsInput {
  const mag = magFixture();
  const wag = wagInfinityFixture();
  const tnt = tntFixture();
  return {
    sessions: [mag.session, wag.session, tnt.session, { id: 's3-red', number: 3, gym: 'Red', discipline: 'WAG', levelCodes: ['XS'] }],
    athletes: [...mag.athletes, ...wag.athletes, ...tnt.athletes],
    gymOrder: ['Green', 'Red', 'Yellow', 'Orange', 'Purple'],
    ordersByClub: {},
    meet: { meetName: MEET.name, meetDate: MEET.date, gymOrder: ['Green', 'Red', 'Yellow', 'Orange', 'Purple'] },
    squadDocs: { [mag.session.id]: mag.stored, [wag.session.id]: wag.stored, [tnt.session.id]: tnt.stored },
    synchroPairs: tnt.pairs.map((p) => ({ id: p.id, level: p.level, a1: '', name1: p.name1, club1: p.club1, a2: '', name2: p.name2, club2: p.club2, createdAt: null, source: '' })),
    ...over,
  };
}

async function open(inp = input()) {
  store.loadExportsInput.mockResolvedValue(inp);
  const user = userEvent.setup();
  render(<AdminExports />);
  await screen.findByRole('heading', { name: 'Meet' });
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.saveMeetNameDate.mockResolvedValue(undefined);
  store.saveCompetitionTime.mockResolvedValue(undefined);
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
    const select = screen.getByLabelText('Session') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Session 2 – Green (WAG)', 'Session 3 – Red (WAG)', 'Session 1 – Orange (MAG)', 'Session 1 – Purple (T&T)',
    ]);
    expect(select.value).toBe('s2-green');
    const pages = screen.getAllByRole('region', { name: /^Page \d+ of \d+:/ });
    expect(pages.length).toBeGreaterThan(10);
    expect(pages[0].getAttribute('aria-label')).toMatch(/^Page 1 of \d+: Vault, Squad A$/);
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
    await waitFor(() => expect(store.saveMeetNameDate).toHaveBeenCalledWith({}, { meetName: 'Nationals X', meetDate: MEET.date }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('the jump bar has a row per apparatus with squad letters in arrival order, and moves to the page', async () => {
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Session'), 's1-orange');
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
    await user.selectOptions(screen.getByLabelText('Session'), 's1-orange');
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
    await user.selectOptions(screen.getByLabelText('Session'), 's3-red');
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

  it('T&T: a competition time shows in the rotation sheet title and saves into the session', async () => {
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Session'), 's1-purple');
    await user.click(screen.getByRole('button', { name: 'Rotation sheet' }));
    const time = screen.getByLabelText(/Competition time/);
    expect(time).toHaveValue('Thursday 7:30 AM');
    await user.clear(time);
    await user.type(time, 'Friday 9:00 AM');
    expect(screen.getAllByText('T&T Session 1 – Purple · Friday 9:00 AM').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Save time' }));
    await waitFor(() => expect(store.saveCompetitionTime).toHaveBeenCalledWith({}, 's1-purple', 'Friday 9:00 AM'));
  });

  it('T&T scorecards jump bar: TR, DM, TU, SY', async () => {
    const user = await open();
    await user.selectOptions(screen.getByLabelText('Session'), 's1-purple');
    const nav = screen.getByRole('navigation', { name: 'Jump to a page' });
    expect([...nav.querySelectorAll('.ex-jump-l')].map((e) => e.textContent)).toEqual(['TR', 'DM', 'TU', 'SY']);
  });

  it('shows an error with Try again when the data cannot be read', async () => {
    store.loadExportsInput.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(<AdminExports />);
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    store.loadExportsInput.mockResolvedValue(input());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Meet' })).toBeInTheDocument();
  });
});
