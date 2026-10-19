import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ athletes: [] as unknown[], fixes: [] as unknown[], save: vi.fn(), publish: vi.fn() }));
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
vi.mock('../../src/lib/data/store', () => ({
  loadAthletes: vi.fn(async () => h.athletes),
  saveNameFixesAndRepublish: (...a: unknown[]) => h.save(...a),
  publishClubLinks: (...a: unknown[]) => h.publish(...a),
}));
vi.mock('../../src/lib/data/name-fixes-store', () => ({ loadNameFixes: vi.fn(async () => h.fixes) }));

import NameFixesCard from '../../src/components/NameFixesCard';

const ath = (id: string, first: string, last: string, clubId = 'club-a') => ({ id, first, last, clubId, competes: true });

beforeEach(() => {
  vi.clearAllMocks();
  h.athletes = [ath('WAG_a', 'Ada', 'MurrayMetzger'), ath('TNT_b', 'Bea', 'MurrayMetzger', 'club-b'), ath('WAG_c', 'Cy', 'McDonald'), ath('WAG_d', 'Di', 'StPierre')];
  h.fixes = [];
  h.save.mockResolvedValue({ republished: ['Club A', 'Club B'] });
});

describe('Name fixes card', () => {
  it('shows no suggestions, only the fixes Julia adds (2026-10-19: inner-capital names are correct)', async () => {
    render(<NameFixesCard meetId="m1" />);
    expect(await screen.findByRole('heading', { name: 'Add a fix' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Suggestions' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Accept / })).toBeNull();
    expect(screen.getByText('No fixes yet.')).toBeInTheDocument();
  });

  it('adds a typed fix, shows how many athletes it changes, and refuses different letters', async () => {
    render(<NameFixesCard meetId="m1" />);
    await userEvent.type(await screen.findByLabelText('As in the export'), 'MurrayMetzger');
    expect(screen.getByText(/Changes the name of 2 athletes/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Show as'), 'Murray Metzgar');
    await userEvent.click(screen.getByRole('button', { name: 'Add fix' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/same letters/);
    expect(h.save).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('Show as'));
    await userEvent.type(screen.getByLabelText('Show as'), 'Murray Metzger');
    await userEvent.click(screen.getByRole('button', { name: 'Add fix' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save.mock.calls[0][3]).toEqual([{ field: 'last', from: 'MurrayMetzger', to: 'Murray Metzger' }]);
  });

  it('removing a fix saves the shorter list', async () => {
    h.fixes = [{ field: 'last', from: 'MurrayMetzger', to: 'Murray Metzger' }];
    h.save.mockResolvedValue({ republished: [] });
    render(<NameFixesCard meetId="m1" />);
    await userEvent.click(await screen.findByRole('button', { name: /Remove the fix for MurrayMetzger/ }));
    expect(h.save).toHaveBeenCalledWith({}, 'm1', h.fixes, []);
    expect(await screen.findByText(/No club pages needed republishing/)).toBeInTheDocument();
  });

  it('says so when saving worked but publishing failed, and offers to republish', async () => {
    h.save.mockResolvedValue({ republished: [], publishError: 'offline' });
    h.publish.mockResolvedValue(7);
    render(<NameFixesCard meetId="m1" />);
    await userEvent.type(await screen.findByLabelText('As in the export'), 'StPierre');
    await userEvent.type(screen.getByLabelText('Show as'), 'St Pierre');
    await userEvent.click(screen.getByRole('button', { name: 'Add fix' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/saved, but publishing the club pages failed: offline/);
    await userEvent.click(screen.getByRole('button', { name: 'Republish club pages' }));
    expect(await screen.findByText('Republished 7 club pages.')).toBeInTheDocument();
  });
});
