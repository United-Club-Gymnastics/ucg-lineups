import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import OrderCopyDialog, { type OrderCopyApi } from '../../src/components/OrderCopyDialog';
import UpgradeLinksDialog from '../../src/components/UpgradeLinksDialog';
import type { LinkAthlete, LinkSession } from '../../src/lib/club-links';
import type { ClubCopyInput } from '../../src/lib/orders-copy';
import { planUpgrade } from '../../src/lib/club-links-upgrade';
import { choose } from '../helpers/select';

const WAG = ['VT', 'UB', 'BB', 'FX'];
const ath = (f: string): LinkAthlete => ({ id: `WAG_a_${f}`, first: f, last: 'Test', apparatus: WAG });
const lv = (sid: string, code: string, name: string, firsts: string[]) => ({ levelCode: code, levelName: name, levelKey: `${sid}__${code}`, athletes: firsts.map(ath) });
const sess = (sid: string, levels: ReturnType<typeof lv>[]): LinkSession => ({ sessionId: sid, label: sid, discipline: 'WAG', name: sid, location: 'X', gym: 'X', levels });
const SIX = ['ava', 'bea', 'cy', 'dee', 'eve', 'fay'];
const custom = { groups: [[...SIX].reverse().map((f) => `WAG_a_${f}`)], sections: Object.fromEntries(WAG.map((c) => [c, [[...SIX].reverse().map((f) => `WAG_a_${f}`)]])), splitDecided: false };

const meets = [
  { id: 'finals', name: 'Finals', createdAt: 2, archived: false },
  { id: 'prelims', name: 'Prelims', createdAt: 1, archived: false },
];

function inputs(): ClubCopyInput[] {
  return [
    { clubId: 'a', token: 'tA', clubName: 'Club A', source: [sess('p', [lv('p', 'XP', 'Platinum XP', SIX), lv('p', 'XS', 'Silver XS', ['x', 'y'])])], target: [sess('f', [lv('f', 'XP', 'Platinum XP', SIX), lv('f', 'L9', 'Level 9', ['z', 'w'])])], sourceSaved: { p__XP: custom }, targetSaved: {} },
    { clubId: 'b', token: 'tB', clubName: 'Club B', source: [sess('p', [lv('p', 'XP', 'Platinum XP', SIX)])], target: [sess('f', [lv('f', 'XP', 'Platinum XP', [...SIX, 'newbie'])])], sourceSaved: { p__XP: custom }, targetSaved: { f__XP: { ...custom, groups: [['x']], sections: {}, splitDecided: true } } },
  ];
}
function api(): OrderCopyApi {
  return { load: vi.fn(async () => inputs()), apply: vi.fn(async (plan) => plan.writes.length) };
}

describe('Start orders from another meet', () => {
  it('previews with counts, lists unmatched levels, skips orders already set, then copies and shows the result', async () => {
    const user = userEvent.setup();
    const a = api();
    const onDone = vi.fn();
    render(<OrderCopyDialog target={meets[0]} meets={meets} api={a} onClose={() => {}} onDone={onDone} />);
    expect(screen.getByRole('combobox', { name: 'Copy orders from' })).toHaveTextContent('Prelims'); // the target is not offered as a source
    const summary = await screen.findByTestId('copy-summary');
    expect(summary).toHaveTextContent('1 level order for 1 club (6 athletes) will be copied');
    expect(summary).toHaveTextContent('1 level the club already set in Finals will be left alone');
    const unmatched = screen.getByTestId('copy-unmatched');
    expect(unmatched).toHaveTextContent('In Prelims only: WAG Silver XS (XS)');
    expect(unmatched).toHaveTextContent('In Finals only: WAG Level 9 (L9)');
    expect(a.load).toHaveBeenCalledWith('prelims', 'finals');

    await user.click(screen.getByRole('checkbox', { name: 'Replace orders already set in this meet' }));
    expect(summary).toHaveTextContent('2 level orders for 2 clubs (13 athletes) will be copied');
    expect(summary).toHaveTextContent('1 level the club already set in Finals will be replaced');
    expect(screen.getByTestId('copy-newcomers')).toHaveTextContent('Club B, Platinum XP: newbie Test');
    await user.click(screen.getByRole('checkbox', { name: 'Replace orders already set in this meet' }));

    await user.click(screen.getByRole('button', { name: 'Copy orders' }));
    await waitFor(() => expect(a.apply).toHaveBeenCalledTimes(1));
    const plan = (a.apply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(plan.writes.map((w: { clubId: string; targetKey: string }) => `${w.clubId}:${w.targetKey}`)).toEqual(['a:f__XP']);
    expect(await screen.findByRole('dialog', { name: 'Orders copied' })).toHaveTextContent('Copied 1 level order for 1 club');
    expect(screen.getByRole('dialog')).toHaveTextContent('no Still A–Z reminder');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('with replace ticked, the plan handed to apply replaces the orders already set', async () => {
    const user = userEvent.setup();
    const a = api();
    render(<OrderCopyDialog target={meets[0]} meets={meets} api={a} onClose={() => {}} onDone={() => {}} />);
    await screen.findByTestId('copy-summary');
    await user.click(screen.getByRole('checkbox', { name: 'Replace orders already set in this meet' }));
    await user.click(screen.getByRole('button', { name: 'Copy orders' }));
    await waitFor(() => expect(a.apply).toHaveBeenCalled());
    const plan = (a.apply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(plan.replaced).toBe(1);
    expect(plan.writes.map((w: { clubId: string }) => w.clubId).sort()).toEqual(['a', 'b']);
  });

  it('says so when there is no other meet, and shows a failed read without a Copy path', async () => {
    const { unmount } = render(<OrderCopyDialog target={meets[0]} meets={[meets[0]]} api={api()} onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('no other meet to copy from');
    unmount();
    const bad: OrderCopyApi = { load: vi.fn(async () => { throw new Error('offline'); }), apply: vi.fn() };
    render(<OrderCopyDialog target={meets[0]} meets={meets} api={bad} onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read the meets: offline');
    expect(screen.getByRole('button', { name: 'Copy orders' })).toBeDisabled();
  });

  it('changing the source reads again for that source', async () => {
    const user = userEvent.setup();
    const a = api();
    const three = [...meets, { id: 'regionals', name: 'Regionals', createdAt: 0, archived: false }];
    render(<OrderCopyDialog target={meets[0]} meets={three} api={a} onClose={() => {}} onDone={() => {}} />);
    await screen.findByTestId('copy-summary');
    await choose(user, screen.getByRole('combobox', { name: 'Copy orders from' }), 'regionals');
    await waitFor(() => expect(a.load).toHaveBeenLastCalledWith('regionals', 'finals'));
  });
});

describe('Upgrade club links dialog', () => {
  const plan = planUpgrade({
    oldLinks: [
      { token: 'tA-p', data: { meetId: 'prelims', clubId: 'a', clubName: 'A', sessions: [], levelKeys: [] } },
      { token: 'tA-f', data: { meetId: 'finals', clubId: 'a', clubName: 'A', sessions: [], levelKeys: [] } },
    ],
    newLinks: {}, clubTokens: {}, existingOrders: {}, oldOrders: { 'tA-p': ['k1', 'k2'], 'tA-f': ['k1'] },
    meets: [{ id: 'prelims', name: 'Prelims', createdAt: 1, archived: false }, { id: 'finals', name: 'Finals', createdAt: 2, archived: false }],
  });

  it('shows the counts first, runs once, and reports', async () => {
    const user = userEvent.setup();
    const api = { load: vi.fn(async () => plan), apply: vi.fn(async () => 5) };
    render(<UpgradeLinksDialog api={api} onClose={() => {}} onDone={() => {}} />);
    const counts = await screen.findByTestId('upgrade-counts');
    expect(counts).toHaveTextContent('1 club across 2 meets');
    expect(counts).toHaveTextContent('3 saved orders to move');
    expect(counts).toHaveTextContent('1 link will be deleted');
    expect(api.apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Upgrade club links' }));
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith(plan, expect.any(Function)));
    expect(await screen.findByRole('dialog', { name: 'Club links upgraded' })).toHaveTextContent('3 saved orders moved, 1 old link removed');
  });

  it('a failure says nothing was lost and can be run again', async () => {
    const user = userEvent.setup();
    const api = { load: vi.fn(async () => plan), apply: vi.fn(async () => { throw new Error('network'); }) };
    render(<UpgradeLinksDialog api={api} onClose={() => {}} onDone={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Upgrade club links' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('network');
    expect(alert).toHaveTextContent('safe to run it again');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Upgrade club links' })).toBeEnabled();
  });
});
