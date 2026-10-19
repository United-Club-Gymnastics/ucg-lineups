import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClubLinkDoc, MeetLinkEntry } from '../../src/lib/club-links';
import type { LevelOrder } from '../../src/lib/club-order-model';

vi.mock('../../src/lib/firebase', () => ({ db: {} }));
const store = vi.hoisted(() => ({
  loadClubLink: vi.fn(),
  loadPublicMeet: vi.fn(),
  loadLevelOrders: vi.fn(),
  saveLevelOrder: vi.fn(),
}));
vi.mock('../../src/lib/data/club-store', () => store);

import ClubPage from '../../src/pages/ClubPage';
import { choose } from '../helpers/select';

const NAMES = ['Ava', 'Bea', 'Cy', 'Dee', 'Eve', 'Fay', 'Gia', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lou', 'Mia', 'Nat'];
const ath = (n: number, shuffle = false) => {
  const xs = NAMES.slice(0, n).map((first, i) => ({ id: `W${i}`, first, last: 'Test', apparatus: ['VT', 'UB'] }));
  return shuffle ? xs.reverse() : xs;
};

function entry(n: number, name = 'NE Regionals', createdAt = 1000): MeetLinkEntry {
  return {
    meetName: name,
    createdAt,
    sessions: [
      { sessionId: 's1-green', label: 'Session 1 · Green', discipline: 'WAG', gym: 'Green', name: 'Session 1', location: 'Green', number: 1, levels: [
        { levelCode: 'Dev', levelName: 'Developmental', levelKey: 's1-green__Dev', athletes: ath(n, true) },
        { levelCode: 'Int', levelName: 'Intermediate', levelKey: 's1-green__Int', athletes: [{ id: 'X1', first: 'Zed', last: 'Test', apparatus: ['VT'] }] },
      ] },
      { sessionId: 's5-red', label: 'Session 5 · Red', discipline: 'TNT', gym: 'Red', name: 'Session 5', location: 'Red', number: 5, levels: [] },
    ],
    levelKeys: ['s1-green__Dev', 's1-green__Int'],
  };
}

function link(n: number): ClubLinkDoc {
  return { clubId: 'club-a', clubName: 'Invented Gymnastics', meets: { 'meet-x': entry(n) } };
}

interface MeetSetup { deadline?: Date | null; orders?: Record<string, LevelOrder>; name?: string }

function setup(n: number, opts: { deadline?: Date | null; orders?: Record<string, LevelOrder>; invalid?: boolean; meetName?: string; link?: ClubLinkDoc; meets?: Record<string, MeetSetup> } = {}) {
  store.loadClubLink.mockResolvedValue(opts.invalid ? null : opts.link ?? link(n));
  const per: Record<string, MeetSetup> = opts.meets ?? { 'meet-x': { deadline: opts.deadline ?? null, orders: opts.orders ?? {}, name: opts.meetName ?? 'NE Regionals' } };
  store.loadPublicMeet.mockImplementation(async (_db: unknown, id: string) => ({ deadline: per[id]?.deadline ?? null, name: per[id]?.name ?? '' }));
  store.loadLevelOrders.mockImplementation(async (_db: unknown, _t: string, id: string) => per[id]?.orders ?? {});
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

  it("reads each meet's deadline and name from the meet named in the link, and shows the meet name", async () => {
    setup(3, { deadline: new Date(Date.now() - 3600e3), meetName: 'NE Regionals 2027' });
    expect(await screen.findByTestId('club-locked')).toBeInTheDocument();
    expect(store.loadPublicMeet).toHaveBeenCalledWith({}, 'meet-x');
    expect(store.loadLevelOrders).toHaveBeenCalledWith({}, 'tok123', 'meet-x');
    expect(screen.getByText('NE Regionals 2027')).toBeInTheDocument();
  });

  it('a link in the old per-meet shape comes back from the store as null: not valid, no meet read', async () => {
    setup(3, { invalid: true });
    expect(await screen.findByRole('heading', { name: /link isn.t valid/i })).toBeInTheDocument();
    expect(store.loadPublicMeet).not.toHaveBeenCalled();
    expect(store.loadLevelOrders).not.toHaveBeenCalled();
  });

  it('a club with no open meets says so instead of showing an empty page', async () => {
    setup(3, { link: { clubId: 'c', clubName: 'Invented Gymnastics', meets: { gone: { ...entry(3), archived: true } } } });
    expect(await screen.findByText(/No meets are open for your club yet/)).toBeInTheDocument();
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
    const [, token, meetId, key, order] = store.saveLevelOrder.mock.calls[0];
    expect(token).toBe('tok123');
    expect(meetId).toBe('meet-x');
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
    expect(store.saveLevelOrder.mock.calls[0][4].splitDecided).toBe(true);
    expect(store.saveLevelOrder.mock.calls[0][4].groups.map((g: string[]) => g.length)).toEqual([7, 7]);
    expect(screen.queryByTestId('club-split')).toBeNull();
  });

  it('moving an athlete between groups also decides the split', async () => {
    const user = userEvent.setup();
    setup(14);
    await screen.findByTestId('club-split');
    await user.click(screen.getByRole('button', { name: 'Move Ava Test to Group B' }));
    await waitFor(() => expect(store.saveLevelOrder).toHaveBeenCalled(), { timeout: 2000 });
    expect(store.saveLevelOrder.mock.calls[0][4].splitDecided).toBe(true);
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

describe('meet switcher (one private link across meets)', () => {
  const day = 86400e3;
  /** Prelims (older, locked) and Finals (newer, open). Finals has a saved custom order; Prelims is at the default. */
  const twoMeets = () => {
    const l: ClubLinkDoc = { clubId: 'club-a', clubName: 'Invented Gymnastics', meets: { prelims: entry(5, 'Prelims', 1000), finals: entry(5, 'Finals', 2000) } };
    const custom: LevelOrder = { groups: [['W4', 'W3', 'W2', 'W1', 'W0']], sections: { VT: [['W4', 'W3', 'W2', 'W1', 'W0']], UB: [['W4', 'W3', 'W2', 'W1', 'W0']] }, splitDecided: false };
    return {
      link: l,
      meets: {
        prelims: { name: 'Prelims', deadline: new Date(Date.now() - day), orders: {} as Record<string, LevelOrder> },
        finals: { name: 'Finals', deadline: new Date(Date.now() + day), orders: { 's1-green__Dev': custom } },
      },
    };
  };

  it('lists the meets with their deadlines, newest selected by default, and shows that meet\'s statuses', async () => {
    setup(5, twoMeets());
    const meets = await screen.findByRole('list', { name: 'Your meets' });
    const [finals, prelims] = within(meets).getAllByRole('button');
    expect(finals).toHaveTextContent('Finals');
    expect(finals).toHaveTextContent(/Locks /);
    expect(prelims).toHaveTextContent('Prelims');
    expect(prelims).toHaveTextContent('Locked');
    expect(finals).toHaveAttribute('aria-pressed', 'true');
    expect(prelims).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Session 1/ })).toHaveTextContent('Order set');
    expect(screen.queryByTestId('club-locked')).toBeNull();
  });

  it('switching shows the other meet: its own statuses and its own lock; Prelims is read-only', async () => {
    const user = userEvent.setup();
    setup(5, twoMeets());
    await screen.findByRole('list', { name: 'Your meets' });
    await user.click(screen.getByRole('button', { name: /Prelims/ }));
    expect(screen.getByRole('button', { name: /Session 1/ })).toHaveTextContent('Still A–Z (default)');
    expect(screen.getByTestId('club-locked')).toHaveTextContent('The order deadline has passed for Prelims');
    expect(screen.queryByRole('button', { name: '+ Add group' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Finals/ }));
    expect(screen.queryByTestId('club-locked')).toBeNull();
    expect(screen.getByRole('button', { name: /Session 1/ })).toHaveTextContent('Order set');
    expect(screen.getByRole('button', { name: '+ Add group' })).toBeInTheDocument();
  });

  it('autosave writes to the meet that is selected, with that meet\'s id', async () => {
    const user = userEvent.setup();
    const t = twoMeets();
    t.meets.prelims.deadline = new Date(Date.now() + day); // both open this time
    setup(5, t);
    await screen.findByRole('list', { name: 'Your meets' });
    await user.click(screen.getByRole('button', { name: '+ Add group' }));
    await waitFor(() => expect(store.saveLevelOrder).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(store.saveLevelOrder.mock.calls[0].slice(1, 4)).toEqual(['tok123', 'finals', 's1-green__Dev']);
    await user.click(screen.getByRole('button', { name: /Prelims/ }));
    await user.click(screen.getByRole('button', { name: '+ Add group' }));
    await waitFor(() => expect(store.saveLevelOrder).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(store.saveLevelOrder.mock.calls[1].slice(1, 4)).toEqual(['tok123', 'prelims', 's1-green__Dev']);
    // The change made in Prelims did not touch Finals' view.
    await user.click(screen.getByRole('button', { name: /Finals/ }));
    expect(screen.getByRole('button', { name: /Session 1/ })).toHaveTextContent('Order set');
  });

  it('a club in one meet only gets no switcher, just the meet name', async () => {
    setup(5);
    await screen.findByRole('heading', { name: 'Invented Gymnastics' });
    expect(screen.queryByRole('list', { name: 'Your meets' })).toBeNull();
    expect(screen.getByText('NE Regionals')).toBeInTheDocument();
  });

  it('more than four meets use a dropdown instead of pills', async () => {
    const user = userEvent.setup();
    const meets: Record<string, MeetLinkEntry> = {};
    const per: Record<string, MeetSetup> = {};
    for (let i = 0; i < 5; i++) { meets[`m${i}`] = entry(5, `Meet ${i}`, 1000 + i); per[`m${i}`] = { name: `Meet ${i}`, deadline: null, orders: {} }; }
    setup(5, { link: { clubId: 'c', clubName: 'Invented Gymnastics', meets }, meets: per });
    const box = await screen.findByRole('combobox', { name: 'Meet' });
    expect(box).toHaveTextContent('Meet 4');
    expect(screen.queryByRole('list', { name: 'Your meets' })).toBeNull();
    await choose(user, box, 'm1');
    expect(screen.getByRole('combobox', { name: 'Meet' })).toHaveTextContent('Meet 1');
  });
});
