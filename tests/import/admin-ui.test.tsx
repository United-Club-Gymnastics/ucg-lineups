import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ATH_HEADERS, athRow, makeWorkbook } from './helpers';

let currentUser: { email: string; emailVerified: boolean } | null = null;
vi.mock('../../src/lib/firebase', () => ({
  db: {},
  isDomainAdmin: (u: { email: string; emailVerified: boolean } | null) => !!u?.emailVerified && u.email.endsWith('@unitedclubgymnastics.org'),
  onUser: (cb: (u: unknown) => void) => { cb(currentUser); return () => {}; },
  signInAdmin: vi.fn(),
  signOutAdmin: vi.fn(),
}));
vi.mock('../../src/lib/data/meet-store', () => ({
  listMeets: vi.fn(async () => [{ id: 'm1', name: 'Test Meet', createdAt: 1, archived: false }]),
  createMeet: vi.fn(), renameMeet: vi.fn(), setMeetArchived: vi.fn(),
}));
vi.mock('../../src/lib/data/email-store', () => ({ loadClubsScreenData: vi.fn(() => new Promise(() => {})) }));
const h = vi.hoisted(() => ({ hasTnt: true }));
vi.mock('../../src/lib/data/store', () => ({
  loadStored: vi.fn(async () => ({ athletes: [], clubs: [], hasSettings: false })),
  loadAthletes: vi.fn(async () => []),
  saveNameFixesAndRepublish: vi.fn(),
  applyImport: vi.fn(),
  publishClubLinks: vi.fn(),
  hasTntSessions: vi.fn(async () => h.hasTnt),
}));

vi.mock('../../src/lib/data/name-fixes-store', () => ({ loadNameFixes: vi.fn(async () => []) }));

import AdminLanding from '../../src/pages/AdminLanding';

beforeEach(() => { currentUser = null; });

describe('admin shell', () => {
  it('blocks non-UCG accounts', async () => {
    currentUser = { email: 'someone@gmail.com', emailVerified: true };
    render(<AdminLanding />);
    expect(await screen.findByText(/Use your @unitedclubgymnastics.org account/)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Import' })).toBeNull();
  });

  it('shows tabs for admins and a preview for a dropped athletes file', async () => {
    currentUser = { email: 'julia@unitedclubgymnastics.org', emailVerified: true };
    const { container } = render(<AdminLanding />);
    expect(await screen.findByRole('button', { name: 'Artistic Squads' })).toBeInTheDocument();
    // Tabs run Artistic Squads, T&T Squads, Exports, Clubs & Emails, Import; the admin lands on Artistic Squads.
    expect(screen.getAllByRole('button').map((b) => b.textContent).filter((x) => ['Artistic Squads', 'T&T Squads', 'Exports', 'Clubs & Emails', 'Import'].includes(x ?? '')))
      .toEqual(['Artistic Squads', 'T&T Squads', 'Exports', 'Clubs & Emails', 'Import']);
    expect(screen.getByRole('button', { name: 'Artistic Squads' })).toHaveClass('active');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    const buf = await makeWorkbook({
      Sheet: [ATH_HEADERS, athRow({ bib: '1', first: 'Ada', last: 'Test', level: 'Platinum', short: 'XP', type: 'WAG', club: 'Alpha Gymnastics', session: 'Session 1 - Orange' })],
    });
    const file = new File([buf as BlobPart], 'Athletes_Export.xlsx');
    await waitFor(() => expect(container.querySelector('input[type=file]')).not.toBeNull());
    await userEvent.upload(container.querySelector('input[type=file]') as HTMLInputElement, file);
    expect(await screen.findByText(/Athletes export · 1 rows/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Load stored data/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply import' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Clubs & Emails' }));
    expect(await screen.findByText(/Loading clubs, orders and the send log/)).toBeInTheDocument();
  });

  it('hides the T&T Squads tab when the meet has no T&T sessions (Julia 2026-10-19), and shows it when it does', async () => {
    currentUser = { email: 'julia@unitedclubgymnastics.org', emailVerified: true };
    h.hasTnt = false;
    const { unmount } = render(<AdminLanding />);
    expect(await screen.findByRole('button', { name: 'Artistic Squads' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'T&T Squads' })).toBeNull());
    unmount();
    h.hasTnt = true;
    render(<AdminLanding />);
    expect(await screen.findByRole('button', { name: 'T&T Squads' })).toBeInTheDocument();
  });
});
