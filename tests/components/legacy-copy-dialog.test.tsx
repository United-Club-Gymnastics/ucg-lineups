import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LegacyCopyDialog, { type LegacyCopyApi } from '../../src/components/LegacyCopyDialog';
import type { LegacySnapshot, MeetState } from '../../src/lib/legacy-copy';

const TA = 'tokenAAAAAAAAAAAAAAAAAA';
const snapshot: LegacySnapshot = {
  docs: [
    { path: 'athletes/WAG_0001', data: { first: 'Ann' } },
    { path: 'clubs/club-a', data: { name: 'Club A', token: TA } },
  ],
  clubLinks: [{ id: TA, data: { clubId: 'club-a' } }],
};
const meets = [{ id: 'm1', name: 'Existing Meet', createdAt: 1, archived: false }];

function api(state: MeetState = new Map()): LegacyCopyApi {
  return {
    load: vi.fn(async () => snapshot),
    loadMeet: vi.fn(async () => state),
    createMeet: vi.fn(async () => 'new-id'),
    apply: vi.fn(async (ops) => ops.length),
  };
}

describe('Bring in earlier data', () => {
  it('into a new meet, copies the old settings but keeps the name the admin chose', async () => {
    const user = userEvent.setup();
    const a = api();
    (a.load as ReturnType<typeof vi.fn>).mockResolvedValue({ ...snapshot, docs: [...snapshot.docs, { path: 'settings/meet', data: { meetName: 'Old name', meetDate: '2026-07-01' } }] });
    render(<LegacyCopyDialog meets={[]} defaultMeetId={null} api={a} onClose={() => {}} onDone={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'See what will be copied' }));
    await user.click(await screen.findByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(a.apply).toHaveBeenCalled());
    const ops = (a.apply as ReturnType<typeof vi.fn>).mock.calls[0][0] as { path: string; data: unknown }[];
    expect(ops.find((o) => o.path === 'meets/new-id/settings/meet')?.data).toEqual({ meetDate: '2026-07-01' });
  });

  it('previews counts and links, copies into a new meet and shows the left-in-place message', async () => {
    const user = userEvent.setup();
    const a = api();
    const onDone = vi.fn();
    render(<LegacyCopyDialog meets={meets} defaultMeetId="m1" api={a} onClose={() => {}} onDone={onDone} />);
    await user.selectOptions(screen.getByLabelText('Copy it into'), 'A new meet…');
    expect(screen.getByLabelText('New meet name')).toHaveValue('UCG Nationals 2026');
    await user.click(screen.getByRole('button', { name: 'See what will be copied' }));
    expect((await screen.findByText(/1 club link/)).closest('p')).toHaveTextContent('will work again');
    expect(screen.getByRole('row', { name: /Athletes 1 1 0/ })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Conflicts' })).toBeNull();
    expect(a.createMeet).not.toHaveBeenCalled(); // nothing is written before Copy
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText(/The original data was left in place\. Once you.ve checked the meet, you can ask to have it removed\./)).toBeInTheDocument();
    expect(a.createMeet).toHaveBeenCalledWith('UCG Nationals 2026');
    const ops = (a.apply as ReturnType<typeof vi.fn>).mock.calls[0][0] as { path: string }[];
    expect(ops.map((o) => o.path).sort()).toEqual([`clubLinks/${TA}`, 'meets/new-id/athletes/WAG_0001', 'meets/new-id/clubs/club-a']);
    await user.click(screen.getByRole('button', { name: /Open UCG Nationals 2026/ }));
    expect(onDone).toHaveBeenCalledWith('new-id');
  });

  it('shows conflicts with Skip as the default and Replace as the option', async () => {
    const user = userEvent.setup();
    const a = api(new Map([['athletes/WAG_0001', { first: 'Mine' }]]));
    render(<LegacyCopyDialog meets={meets} defaultMeetId="m1" api={a} onClose={() => {}} onDone={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'See what will be copied' }));
    const group = await screen.findByRole('group', { name: 'Conflicts' });
    expect(group).toHaveTextContent('athletes 1');
    const skip = screen.getByLabelText('Skip anything that already exists in the meet');
    expect(skip).toBeChecked();
    await user.click(screen.getByLabelText('Replace'));
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(a.apply).toHaveBeenCalled());
    const ops = (a.apply as ReturnType<typeof vi.fn>).mock.calls[0][0] as { path: string }[];
    expect(ops.map((o) => o.path)).toContain('meets/m1/athletes/WAG_0001');
  });

  it('says there is nothing to copy when the meet already has everything, and disables Copy', async () => {
    const user = userEvent.setup();
    const a = api(new Map([['athletes/WAG_0001', { first: 'Ann' }], ['clubs/club-a', { name: 'Club A', token: TA }]]));
    const done: LegacySnapshot = { ...snapshot, clubLinks: [{ id: TA, data: { clubId: 'club-a', meetId: 'm1' } }] };
    (a.load as ReturnType<typeof vi.fn>).mockResolvedValue(done);
    render(<LegacyCopyDialog meets={meets} defaultMeetId="m1" api={a} onClose={() => {}} onDone={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'See what will be copied' }));
    expect(await screen.findByText(/Nothing to copy/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  });

  it('reports a failed read and a copy that stops part-way, without claiming success', async () => {
    const user = userEvent.setup();
    const a = api();
    (a.load as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'));
    render(<LegacyCopyDialog meets={meets} defaultMeetId="m1" api={a} onClose={() => {}} onDone={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'See what will be copied' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read the data: offline');
    (a.apply as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('quota'));
    await user.click(screen.getByRole('button', { name: 'See what will be copied' }));
    await user.click(await screen.findByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('stopped part-way: quota');
  });
});
