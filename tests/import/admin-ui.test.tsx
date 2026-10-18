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
vi.mock('../../src/lib/data/store', () => ({
  loadStored: vi.fn(async () => ({ athletes: [], clubs: [], hasSettings: false })),
  applyImport: vi.fn(),
  publishClubLinks: vi.fn(),
}));

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
    expect(await screen.findByRole('button', { name: 'Squads' })).toBeInTheDocument();
    const buf = await makeWorkbook({
      Sheet: [ATH_HEADERS, athRow({ bib: '1', first: 'Ada', last: 'Test', level: 'Platinum', short: 'XP', type: 'WAG', club: 'Alpha Gymnastics', session: 'Session 1 - Orange' })],
    });
    const file = new File([buf as BlobPart], 'Athletes_Export.xlsx');
    await waitFor(() => expect(container.querySelector('input[type=file]')).not.toBeNull());
    await userEvent.upload(container.querySelector('input[type=file]') as HTMLInputElement, file);
    expect(await screen.findByText(/Athletes export · 1 rows/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Load stored data/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply import' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'T&T' }));
    expect(screen.getByText('Coming next.')).toBeInTheDocument();
  });
});
