import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClubLinkDoc } from '../../src/lib/club-links';
import type { LevelOrder } from '../../src/lib/club-order-model';

vi.mock('../../src/lib/firebase', () => ({ db: {} }));
const store = vi.hoisted(() => ({
  loadClubLink: vi.fn(),
  loadOrderDeadline: vi.fn(),
  loadLevelOrders: vi.fn(),
  saveLevelOrder: vi.fn(),
}));
vi.mock('../../src/lib/data/club-store', () => store);

import ClubPage from '../../src/pages/ClubPage';

const NAMES = ['Ava', 'Bea', 'Cy', 'Dee', 'Eve', 'Fay', 'Gia', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lou', 'Mia', 'Nat'];
const ath = (n: number, shuffle = false) => {
  const xs = NAMES.slice(0, n).map((first, i) => ({ id: `W${i}`, first, last: 'Test', apparatus: ['VT', 'UB'] }));
  return shuffle ? xs.reverse() : xs;
};

function link(n: number): ClubLinkDoc {
  return {
    clubId: 'club-a',
    clubName: 'Invented Gymnastics',
    sessions: [
      { sessionId: 's1-green', label: 'Session 1 · Green', discipline: 'WAG', gym: 'Green', number: 1, levels: [
        { levelCode: 'Dev', levelName: 'Developmental', levelKey: 's1-green__Dev', athletes: ath(n, true) },
        { levelCode: 'Int', levelName: 'Intermediate', levelKey: 's1-green__Int', athletes: [{ id: 'X1', first: 'Zed', last: 'Test', apparatus: ['VT'] }] },
      ] },
      { sessionId: 's5-red', label: 'Session 5 · Red', discipline: 'TNT', gym: 'Red', number: 5, levels: [] },
    ],
    levelKeys: ['s1-green__Dev', 's1-green__Int'],
  };
}

function setup(n: number, opts: { deadline?: Date | null; orders?: Record<string, LevelOrder>; invalid?: boolean } = {}) {
  store.loadClubLink.mockResolvedValue(opts.invalid ? null : link(n));
  store.loadOrderDeadline.mockResolvedValue(opts.deadline ?? null);
  store.loadLevelOrders.mockResolvedValue(opts.orders ?? {});
  store.saveLevelOrder.mockResolvedValue(undefined);
  return render(
    <MemoryRouter initialEntries={['/c/tok123']}>
      <Routes><Route path="/c/:token" element={<ClubPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { vi.clearAllMocks(); });

describe('club page', () => {
  it('shows a friendly message for an unknown link', async () => {
    setup(3, { invalid: true });
    expect(await screen.findByRole('heading', { name: /link isn.t valid/i })).toBeInTheDocument();
    expect(store.loadClubLink).toHaveBeenCalledWith({}, 'tok123');
  });

  it('lists sessions with status pills; T&T is "Set by UCG" and not a button', async () => {
    setup(5);
    expect(await screen.findByRole('heading', { name: 'Invented Gymnastics' })).toBeInTheDocument();
    const sessions = screen.getByRole('list', { name: 'Your sessions' });
    const wag = within(sessions).getByRole('button', { name: /Session 1/ });
    expect(wag).toHaveTextContent('Still A–Z (default)');
    const tnt = within(sessions).getByText('Session 5 · Red').closest('.club-chip')!;
    expect(tnt).toHaveTextContent('Set by UCG');
    expect(tnt.tagName).not.toBe('BUTTON');
  });

  it('defaults to A-Z by first name even when the roster arrives reversed, with no submit button', async () => {
    setup(5);
    const list = await screen.findByTestId('co-0-VT');
    const text = list.textContent ?? '';
    for (let i = 1; i < 5; i++) expect(text.indexOf(NAMES[i - 1])).toBeLessThan(text.indexOf(NAMES[i]));
    expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
    expect(store.saveLevelOrder).not.toHaveBeenCalled();
  });

  it('switches level and event tabs', async () => {
    const user = userEvent.setup();
    setup(5);
    await screen.findByTestId('co-0-VT');
    expect(screen.getByRole('tab', { name: 'Vault' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Uneven Bars' }));
    expect(screen.getByTestId('co-0-UB')).toBeInTheDocument();
    expect(screen.queryByTestId('co-0-VT')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Intermediate' }));
    expect((await screen.findAllByText('Zed Test')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Intermediate: Nothing to order/)).toBeInTheDocument();
  });

  it('autosaves a change after the debounce and shows Saved', async () => {
    const user = userEvent.setup();
    setup(14, { orders: { 's1-green__Dev': { groups: [NAMES.slice(0, 7).map((_, i) => `W${i}`), NAMES.slice(7).map((_, i) => `W${i + 7}`)], sections: {}, splitDecided: true } } });
    await screen.findByTestId('co-group-0');
    await user.click(screen.getByRole('button', { name: 'Move Ava Test to Group B' }));
    expect(screen.getByTestId('club-save')).toHaveTextContent('Saving');
    expect(store.saveLevelOrder).not.toHaveBeenCalled();
    await waitFor(() => expect(store.saveLevelOrder).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const [, token, key, order] = store.saveLevelOrder.mock.calls[0];
    expect(token).toBe('tok123');
    expect(key).toBe('s1-green__Dev');
    expect(order.groups[1][0]).toBe('W0');
    expect(order.splitDecided).toBe(true);
    await waitFor(() => expect(screen.getByTestId('club-save')).toHaveTextContent(/^Saved · /));
  });

  it('shows an error banner when saving fails', async () => {
    const user = userEvent.setup();
    setup(5);
    await screen.findByTestId('co-group-0');
    store.saveLevelOrder.mockRejectedValue(new Error('Missing or insufficient permissions.'));
    await user.click(screen.getByRole('button', { name: '+ Add group' }));
    expect(await screen.findByRole('alert', undefined, { timeout: 2000 })).toHaveTextContent('did not save');
  });

  it('offers a suggested split when over the cap; Keep this split saves with splitDecided', async () => {
    const user = userEvent.setup();
    setup(14);
    const split = await screen.findByTestId('club-split');
    expect(split).toHaveTextContent('We suggest 2 groups (A: 7, B: 7)');
    expect(screen.getByRole('button', { name: /Session 1/ })).toHaveTextContent('Needs to decide a split');
    await user.click(within(split).getByRole('button', { name: 'Keep this split' }));
    await waitFor(() => expect(store.saveLevelOrder).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(store.saveLevelOrder.mock.calls[0][3].splitDecided).toBe(true);
    expect(store.saveLevelOrder.mock.calls[0][3].groups.map((g: string[]) => g.length)).toEqual([7, 7]);
    expect(screen.queryByTestId('club-split')).toBeNull();
  });

  it('moving an athlete between groups also decides the split', async () => {
    const user = userEvent.setup();
    setup(14);
    await screen.findByTestId('club-split');
    await user.click(screen.getByRole('button', { name: 'Move Ava Test to Group B' }));
    await waitFor(() => expect(store.saveLevelOrder).toHaveBeenCalled(), { timeout: 2000 });
    expect(store.saveLevelOrder.mock.calls[0][3].splitDecided).toBe(true);
    expect(screen.queryByTestId('club-split')).toBeNull();
  });

  it('is read-only after the deadline, with a clear note', async () => {
    setup(14, { deadline: new Date(Date.now() - 3600e3) });
    expect(await screen.findByTestId('club-locked')).toHaveTextContent(/deadline has passed/);
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep this split' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Auto-split evenly' })).toBeNull();
  });

  it('stays editable before the deadline and says when orders lock', async () => {
    setup(5, { deadline: new Date(Date.now() + 86400e3) });
    expect(await screen.findByText(/Orders lock on/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add group' })).toBeInTheDocument();
  });
});
