import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetInfo } from '../../src/lib/data/meet-store';

vi.mock('../../src/lib/firebase', () => ({
  db: {},
  isDomainAdmin: () => true,
  onUser: (cb: (u: unknown) => void) => { cb({ email: 'julia@unitedclubgymnastics.org', emailVerified: true }); return () => {}; },
  signInAdmin: vi.fn(),
  signOutAdmin: vi.fn(),
}));

// An in-memory meet list standing in for Firestore.
const mem = vi.hoisted(() => ({ meets: [] as { id: string; name: string; createdAt: number; archived: boolean }[], n: 0 }));
vi.mock('../../src/lib/data/meet-store', () => ({
  listMeets: vi.fn(async () => [...mem.meets].sort((a, b) => b.createdAt - a.createdAt)),
  createMeet: vi.fn(async (_db: unknown, name: string) => { const id = `m${++mem.n}`; mem.meets.push({ id, name, createdAt: 1000 + mem.n, archived: false }); return id; }),
  renameMeet: vi.fn(async (_db: unknown, id: string, name: string) => { mem.meets.find((m) => m.id === id)!.name = name; }),
  setMeetArchived: vi.fn(async (_db: unknown, id: string, a: boolean) => { mem.meets.find((m) => m.id === id)!.archived = a; }),
}));

const links = vi.hoisted(() => ({ old: false, unpublish: vi.fn(async () => 1) }));
vi.mock('../../src/lib/data/store', () => ({ hasTntSessions: vi.fn(async () => true), unpublishMeetFromLinks: links.unpublish }));
vi.mock('../../src/lib/data/club-links-upgrade-store', () => ({
  hasOldStyleLinks: vi.fn(async () => links.old), loadUpgradePlan: vi.fn(), applyUpgrade: vi.fn(),
}));

// Screens are stubbed: this test is about which meet they are handed, and that they remount on a switch.
const mounts = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../src/pages/AdminImport', () => ({ default: ({ meetId }: { meetId: string }) => <p>Import for {meetId}</p> }));
// Artistic Squads is the landing tab (Julia 2026-10-18), so it counts mounts.
vi.mock('../../src/pages/AdminSquads', async () => {
  const React = await import('react');
  function SquadsStub({ meetId }: { meetId: string }) { React.useEffect(() => { mounts.n++; }, []); return <p data-testid="squads">Squads for {meetId}</p>; }
  return { default: SquadsStub };
});
vi.mock('../../src/pages/AdminTnt', () => ({ default: ({ meetId }: { meetId: string }) => <p>T&T for {meetId}</p> }));
vi.mock('../../src/pages/AdminExports', () => ({ default: ({ meetId }: { meetId: string }) => <p>Exports for {meetId}</p> }));

import AdminLanding from '../../src/pages/AdminLanding';
import { SELECTED_MEET_KEY } from '../../src/lib/selected-meet';
import * as meetStore from '../../src/lib/data/meet-store';
import { choose, optionLabels } from '../helpers/select';

const seed = (...ms: Partial<MeetInfo>[]) => {
  mem.meets = ms.map((m, i) => ({ id: `s${i}`, name: `Seed ${i}`, createdAt: i + 1, archived: false, ...m }));
};

beforeEach(() => {
  links.old = false;
  links.unpublish.mockClear();
  mem.meets = [];
  mem.n = 0;
  mounts.n = 0;
  localStorage.clear();
  vi.clearAllMocks();
});

describe('meet switcher', () => {
  it('with no meets shows "Create your first meet" and no tabs; creating one opens it', async () => {
    const user = userEvent.setup();
    render(<AdminLanding />);
    expect(await screen.findByRole('heading', { name: 'Create your first meet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Artistic Squads' })).toBeNull();
    const create = screen.getByRole('button', { name: 'Create meet' });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText('Meet name'), 'Nationals 2027');
    await user.click(create);
    expect(await screen.findByText('Squads for m1')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Meet' })).toHaveTextContent('Nationals 2027');
    expect(meetStore.createMeet).toHaveBeenCalledWith({}, 'Nationals 2027');
  });

  it('lists meets newest first, opens the newest, and hides archived ones', async () => {
    seed({ name: 'Old' }, { name: 'Newest' }, { name: 'Hidden', archived: true, createdAt: 99 });
    render(<AdminLanding />);
    const select = await screen.findByRole('combobox', { name: 'Meet' });
    expect(await optionLabels(userEvent.setup(), select)).toEqual(['Newest', 'Old']);
    expect(select).toHaveTextContent('Newest');
    expect(await screen.findByText('Squads for s1')).toBeInTheDocument();
  });

  it("switching remounts the screens on the other meet and remembers the choice; the tab stays", async () => {
    seed({ name: 'Nationals' }, { name: 'NE Regionals' });
    const user = userEvent.setup();
    render(<AdminLanding />);
    await screen.findByText('Squads for s1');
    expect(mounts.n).toBe(1);
    await user.click(screen.getByRole('button', { name: 'T&T Squads' }));
    expect(await screen.findByText('T&T for s1')).toBeInTheDocument();
    await choose(user, screen.getByRole('combobox', { name: 'Meet' }), 's0');
    expect(await screen.findByText('T&T for s0')).toBeInTheDocument();
    expect(localStorage.getItem(SELECTED_MEET_KEY)).toBe('s0');
    await user.click(screen.getByRole('button', { name: 'Exports' }));
    expect(await screen.findByText('Exports for s0')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Import for s0')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Artistic Squads' }));
    expect(await screen.findByText('Squads for s0')).toBeInTheDocument();
    await choose(user, screen.getByRole('combobox', { name: 'Meet' }), 's1');
    expect(await screen.findByText('Squads for s1')).toBeInTheDocument();
    expect(mounts.n).toBe(3); // squads mounted for s1, then s0 (after the tab round trip), then s1 again
    expect(meetStore.createMeet).not.toHaveBeenCalled(); // switching writes nothing
    expect(meetStore.renameMeet).not.toHaveBeenCalled();
    expect(meetStore.setMeetArchived).not.toHaveBeenCalled();
  });

  it('returns to the meet remembered in this browser', async () => {
    seed({ name: 'Nationals' }, { name: 'NE Regionals' });
    localStorage.setItem(SELECTED_MEET_KEY, 's0');
    render(<AdminLanding />);
    expect(await screen.findByText('Squads for s0')).toBeInTheDocument();
  });

  it('ignores a remembered meet that is gone or archived', async () => {
    seed({ name: 'A' }, { name: 'B' });
    localStorage.setItem(SELECTED_MEET_KEY, 'ghost');
    const { unmount } = render(<AdminLanding />);
    expect(await screen.findByText('Squads for s1')).toBeInTheDocument();
    unmount();
    mem.meets[0].archived = true;
    localStorage.setItem(SELECTED_MEET_KEY, 's0');
    render(<AdminLanding />);
    expect(await screen.findByText('Squads for s1')).toBeInTheDocument();
  });

  it('still works when localStorage throws', async () => {
    seed({ name: 'A' }, { name: 'B' });
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const user = userEvent.setup();
    render(<AdminLanding />);
    expect(await screen.findByText('Squads for s1')).toBeInTheDocument();
    await choose(user, screen.getByRole('combobox', { name: 'Meet' }), 's0');
    expect(await screen.findByText('Squads for s0')).toBeInTheDocument();
    get.mockRestore();
    set.mockRestore();
  });

  it('New meet adds and opens it, leaving the other meet in the list', async () => {
    seed({ name: 'Nationals' });
    const user = userEvent.setup();
    render(<AdminLanding />);
    await screen.findByText('Squads for s0');
    await user.click(screen.getByRole('button', { name: 'New meet' }));
    await user.type(screen.getByLabelText('Meet name'), 'NE Regionals');
    await user.click(screen.getByRole('button', { name: 'Create meet' }));
    expect(await screen.findByText('Squads for m1')).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'Meet' });
    expect(await optionLabels(userEvent.setup(), select)).toEqual(['NE Regionals', 'Nationals']);
  });

  it('Rename changes the name in the list', async () => {
    seed({ name: 'Nationals' });
    const user = userEvent.setup();
    render(<AdminLanding />);
    await screen.findByText('Squads for s0');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Meet name');
    expect(input).toHaveValue('Nationals');
    await user.clear(input);
    await user.type(input, 'Nationals 2027');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Meet' })).toHaveTextContent('Nationals 2027'));
    expect(meetStore.renameMeet).toHaveBeenCalledWith({}, 's0', 'Nationals 2027');
  });

  it('Archive hides the meet (nothing deleted) and moves to the next one; the last one leaves "Create your first meet"', async () => {
    seed({ name: 'Nationals' }, { name: 'NE Regionals' });
    const user = userEvent.setup();
    render(<AdminLanding />);
    await screen.findByText('Squads for s1');
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Nothing is deleted');
    await user.click(screen.getByRole('button', { name: 'Archive meet' }));
    expect(await screen.findByText('Squads for s0')).toBeInTheDocument();
    expect(meetStore.setMeetArchived).toHaveBeenCalledWith({}, 's1', true);
    expect(links.unpublish).toHaveBeenCalledWith({}, 's1'); // clubs stop seeing (and writing) the archived meet
    expect(mem.meets).toHaveLength(2); // still there
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await user.click(screen.getByRole('button', { name: 'Archive meet' }));
    expect(await screen.findByRole('heading', { name: 'Create your first meet' })).toBeInTheDocument();
  });

  it('shows a retry when the meets cannot be read', async () => {
    vi.mocked(meetStore.listMeets).mockRejectedValueOnce(new Error('offline'));
    seed({ name: 'A' });
    const user = userEvent.setup();
    render(<AdminLanding />);
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Squads for s0')).toBeInTheDocument();
  });
});

describe('Upgrade club links', () => {
  it('shows the action only while links in the old per-meet shape exist', async () => {
    seed({ name: 'Nationals' });
    links.old = false;
    const first = render(<AdminLanding />);
    await screen.findByText('Squads for s0');
    expect(screen.queryByRole('button', { name: 'Upgrade club links' })).toBeNull();
    first.unmount();
    links.old = true;
    render(<AdminLanding />);
    expect(await screen.findByRole('button', { name: 'Upgrade club links' })).toBeInTheDocument();
  });
});
