import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DndContextProps } from '@dnd-kit/core';
import type { StoredAthlete } from '../../src/lib/import/diff';
import type { LevelOrder } from '../../src/lib/club-order-model';

const captured = vi.hoisted(() => ({ props: null as null | DndContextProps }));
vi.mock('@dnd-kit/core', async (orig) => {
  const mod = await orig<typeof import('@dnd-kit/core')>();
  return { ...mod, DndContext: (p: DndContextProps & { children?: ReactNode }) => { captured.props = p; return <mod.DndContext {...p} />; } };
});
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
const store = vi.hoisted(() => ({ loadSquadsInput: vi.fn(), loadSquadDoc: vi.fn(), saveSquadDoc: vi.fn() }));
vi.mock('../../src/lib/data/squad-store', () => store);

import AdminSquads from '../../src/pages/AdminSquads';
import { parseSquadDoc } from '../../src/lib/squad-data';

const WAG = ['VT', 'UB', 'BB', 'FX'];
let seq = 0;
const ath = (clubId: string, clubName: string, levelCode: string, levelName: string, apparatus = WAG, extra: Partial<StoredAthlete> = {}): StoredAthlete => {
  seq++;
  return {
    id: `WAG_${clubId || 'indep'}_gym${String(seq).padStart(3, '0')}`, discipline: 'WAG', first: `Gym${String(seq).padStart(3, '0')}`, last: 'Invented',
    clubId, clubName, independent: false, levelCode, levelName, sessionId: 's1-green', apparatus, competes: true, ...extra,
  };
};
const many = (n: number, ...a: Parameters<typeof ath>) => Array.from({ length: n }, () => ath(...a));

function fixture(extra: StoredAthlete[] = []) {
  seq = 0;
  const athletes = [
    ...many(5, 'alpha', 'Alpha Gymnastics', 'XS', 'Silver XS'),
    ...many(6, 'bravo', 'Bravo Gymnastics', 'XP', 'Platinum XP'),
    ...many(3, 'charlie', 'Charlie Gymnastics', 'Inf', 'Infinity'),
    ...many(2, 'charlie', 'Charlie Gymnastics', 'XS', 'Silver XS'),
    ath('', 'Independent Pat', 'XP', 'Platinum XP', ['BB'], { independent: true, clubId: 'independent-pat', first: 'Pat', last: 'Solo' }),
    ...extra,
  ];
  return {
    sessions: [
      { id: 's2-red', number: 2, gym: 'Red', discipline: 'MAG', levelCodes: ['Dev'] },
      { id: 's1-green', number: 1, gym: 'Green', discipline: 'WAG', levelCodes: ['XS', 'XP', 'Inf'] },
      { id: 's3-purple', number: 3, gym: 'Purple', discipline: 'TNT', levelCodes: [] },
    ],
    athletes,
    gymOrder: ['Green', 'Red', 'Yellow', 'Orange', 'Purple'],
    ordersByClub: {} as Record<string, Record<string, LevelOrder>>,
  };
}

async function open(input = fixture(), doc: unknown = null) {
  store.loadSquadsInput.mockResolvedValue(input);
  store.loadSquadDoc.mockResolvedValue(doc);
  store.saveSquadDoc.mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<AdminSquads />);
  await screen.findByRole('heading', { name: /Session 1 – Green/ });
  return user;
}

/** Most of these tests were written for one flight (4 WAG squads); WAG now starts on two flights, so switch (nothing is placed yet). */
async function openOne(input = fixture(), doc: unknown = null) {
  const user = await open(input, doc);
  await user.click(screen.getByRole('button', { name: /One flight · 4 squads/ }));
  return user;
}

const lastSaved = () => store.saveSquadDoc.mock.calls.at(-1)?.[2];
const squad = (letter: string) => screen.getByRole('region', { name: `Squad ${letter}` });
const savedBy = async (n = 1) => waitFor(() => expect(store.saveSquadDoc.mock.calls.length).toBeGreaterThanOrEqual(n), { timeout: 3000 });

beforeEach(() => { vi.clearAllMocks(); });

describe('Squads screen', () => {
  it('lists MAG/WAG sessions by gym order and shows the header, capacity and counts', async () => {
    await open();
    const picker = screen.getByRole('combobox', { name: 'Session' });
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Session 1 – Green (WAG)', 'Session 2 – Red (MAG)']);
    expect(screen.getByText(/WAG · Green Gym · Silver XS, Platinum XP, Infinity · 17 athletes · 3 clubs still A–Z · 0 need to decide a split/)).toBeInTheDocument();
    expect(screen.getByTestId('squads-capacity')).toHaveTextContent('Up to 40 WAG athletes fit in 4 squads, and up to 85 in 8. This session has 17.');
    expect(screen.getByRole('region', { name: 'Routines per rotation' })).toBeInTheDocument();
  });

  it('starts with everything unplaced and nothing written until the host acts', async () => {
    await open();
    expect(screen.getByText(/Unplaced club groups \(5\)/)).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /^Squad [A-H]$/ })).toHaveLength(8); // WAG default: two flights, A/B equipment
    expect(store.saveSquadDoc).not.toHaveBeenCalled();
  });

  it('auto-balance places everything, keeps Infinity apart, and autosaves a plan with no nested arrays', async () => {
    const user = await openOne();
    await user.click(screen.getByRole('button', { name: 'Auto-balance' }));
    expect(screen.getByText('All club groups are placed.')).toBeInTheDocument();
    await savedBy();
    const doc = lastSaved();
    expect(doc.pattern).toBe('one');
    expect(doc.squads.map((s: { name: string }) => s.name)).toEqual(['A', 'B', 'C', 'D']);
    type Card = { key: string; athleteIds: string[] };
    const keys: string[] = doc.squads.flatMap((s: { cards: Card[] }) => s.cards.map((c) => c.key));
    expect(doc.trayAthleteIds).toEqual([]);
    expect(doc.squads.flatMap((s: { cards: Card[] }) => s.cards.flatMap((c) => c.athleteIds))).toHaveLength(17);
    expect(keys.filter((k) => !k.startsWith('indep::')).sort()).toEqual(['alpha::XS::0::-', 'bravo::XP::0::-', 'charlie::Inf::0::-', 'charlie::XS::0::-']);
    expect(keys.filter((k) => k.startsWith('indep::'))).toHaveLength(1);
    const inf = doc.squads.find((s: { cards: Card[] }) => s.cards.some((c) => c.key === 'charlie::Inf::0::-'));
    expect(inf.cards.map((c: Card) => c.key)).toEqual(['charlie::Inf::0::-']);
    expect(doc.schedule).toEqual({ stretch: '', warmups: '', competition: '' });
    await waitFor(() => expect(screen.getByTestId('squads-save')).toHaveTextContent(/^Saved · /));
  });

  it('the Place in squad menu and a drag both move a card; the plan is saved', async () => {
    const user = await open();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Place in squad: Alpha Gymnastics – Silver XS' }), '2');
    expect(within(squad('C')).getByText('Alpha Gymnastics – Silver XS')).toBeInTheDocument();
    act(() => { captured.props!.onDragEnd!({ active: { id: 'bravo::XP::0::-' }, over: { id: 'squad-3' } } as never); });
    expect(within(squad('D')).getByText('Bravo Gymnastics – Platinum XP')).toBeInTheDocument();
    act(() => { captured.props!.onDragEnd!({ active: { id: 'bravo::XP::0::-' }, over: { id: 'tray' } } as never); });
    expect(screen.getByText(/Unplaced club groups \(4\)/)).toBeInTheDocument();
    await savedBy();
    expect(lastSaved().squads[2].cards.map((c: { key: string }) => c.key)).toEqual(['alpha::XS::0::-']);
  });

  it('flags a manual mix of Infinity with another level, and an over-cap squad', async () => {
    const orders: Record<string, LevelOrder> = {};
    const input = fixture();
    const big = Array.from({ length: 13 }, (_, i) => ath('delta', 'Delta Gymnastics', 'XD', 'Diamond XD', ['VT'], { first: `Big${i}` }));
    input.athletes.push(...big);
    orders.delta = { 's1-green__XD': { groups: [big.map((a) => a.id)], sections: {}, splitDecided: true } } as never;
    input.ordersByClub = orders;
    input.sessions[1].levelCodes.push('XD');
    const user = await open(input);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Place in squad: Charlie Gymnastics – Infinity' }), '0');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Place in squad: Charlie Gymnastics – Silver XS' }), '0');
    expect(within(squad('A')).getByText(/Infinity mixed with other levels: Silver XS, Infinity/)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Place in squad: Delta Gymnastics – Diamond XD' }), '1');
    expect(within(squad('B')).getByText('Over 12 on VT')).toBeInTheDocument();
    // the routines-per-rotation table highlights it too
    const table = screen.getByRole('table');
    expect(table.querySelector('td.hot')).not.toBeNull();
  });

  it('swap all groups with another squad trades them, keeps the letters and says where they now start', async () => {
    const user = await openOne();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Place in squad: Alpha Gymnastics – Silver XS' }), '0');
    await user.selectOptions(screen.getByRole('combobox', { name: "Swap all of Squad A's groups with another squad" }), '2');
    expect(within(squad('C')).getByText('Alpha Gymnastics – Silver XS')).toBeInTheDocument();
    expect(within(squad('A')).queryByText('Alpha Gymnastics – Silver XS')).toBeNull();
    expect(screen.getByText('Swapped Squad A and Squad C. Their groups now start on VT and BB.')).toBeInTheDocument();
  });

  it('a new WAG session defaults to two flights on A/B equipment (8 squads); a new MAG session to one flight (6 squads)', async () => {
    const user = await open();
    expect(screen.getByRole('button', { name: /Two flights, A\/B equipment · 8/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Flight 1 · A equipment')).toBeInTheDocument();
    expect(squad('B')).toHaveTextContent('VT-B → UB-B → BB-B → FX-B');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session' }), 's2-red');
    await screen.findByRole('heading', { name: /Session 2 – Red/ });
    expect(screen.getByRole('button', { name: /One flight · 6 squads/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/Flight 1/)).toBeNull();
  });

  it('has no bye pattern', async () => {
    await open();
    expect(screen.queryByRole('button', { name: /bye/i })).toBeNull();
    expect(screen.getAllByRole('button', { name: /flights?, / }).length + screen.getAllByRole('button', { name: /One flight/ }).length).toBe(2);
    expect(document.body.textContent).not.toMatch(/\bBYE\b|bye/i);
  });

  it('a saved plan with the removed byes pattern opens as two flights on A/B equipment with a one-time notice', async () => {
    const doc = {
      pattern: 'byes', trayAthleteIds: [], schedule: { stretch: '', warmups: '', competition: '' },
      squads: Array.from({ length: 8 }, (_, i) => ({ name: String.fromCharCode(65 + i), cards: [] })),
    };
    const user = await open(fixture(), parseSquadDoc(doc)); // the store parses what it reads
    const msg = 'This session used the 2024 bye pattern, which has been removed; it now uses two flights on A/B equipment.';
    expect(screen.getByText(msg)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Two flights, A\/B equipment · 8/ })).toHaveAttribute('aria-pressed', 'true');
    expect(squad('B')).toHaveTextContent('VT-B → UB-B → BB-B → FX-B');
    expect(store.saveSquadDoc).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Auto-balance' }));
    expect(screen.queryByText(msg)).toBeNull(); // gone once the plan is saved as two flights
    await savedBy();
    expect(lastSaved().pattern).toBe('parallel');
  });

  it('changing the pattern with nothing placed just resizes; with groups placed it asks first and re-balances', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: /One flight · 4 squads/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByRole('region', { name: /^Squad [A-D]$/ })).toHaveLength(4);
    expect(screen.queryByText('Flight 1 · A equipment')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Auto-balance' }));
    await user.click(screen.getByRole('button', { name: /Two flights, A\/B equipment · 8/ }));
    const dlg = screen.getByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Change and re-balance' }));
    expect(screen.getAllByRole('region', { name: /^Squad [A-H]$/ })).toHaveLength(8);
    expect(screen.getByText('Flight 1 · A equipment')).toBeInTheDocument();
    expect(screen.getByText('Flight 2 · B equipment')).toBeInTheDocument();
    expect(squad('B')).toHaveTextContent('VT-B → UB-B → BB-B → FX-B');
    await savedBy();
    expect(lastSaved().pattern).toBe('parallel');
    expect(lastSaved().squads).toHaveLength(8);
  });

  it('Clear squads asks first, then returns every group to the tray', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Auto-balance' }));
    await user.click(screen.getByRole('button', { name: 'Clear squads' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear squads' }));
    expect(screen.getByText(/Unplaced club groups \(5\)/)).toBeInTheDocument();
  });

  it('shows the Routines per rotation table with squad letters and totals', async () => {
    const user = await openOne();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Place in squad: Bravo Gymnastics – Platinum XP' }), '0');
    const table = screen.getByRole('table');
    const row1 = within(table).getByRole('row', { name: /Rotation 1/ });
    expect(within(row1).getAllByRole('cell')[0]).toHaveTextContent('6A'); // squad A on VT, 6 routines
    expect(within(row1).getAllByRole('cell')[4]).toHaveTextContent('6'); // total
  });

  it('lists specialists in a squad with their first rotation', async () => {
    const user = await openOne();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Place in squad: Pat Solo (Independent) – Platinum XP' }), '1');
    expect(within(squad('B')).getByText(/Specialists: Pat Solo \(BB\): first up rotation 2/)).toBeInTheDocument();
  });

  it('restores a saved plan from its athletes, saves schedule fields, and lists what moved since', async () => {
    const input = fixture();
    const alpha = input.athletes.filter((a) => a.clubId === 'alpha').map((a) => a.id);
    const added = ath('alpha', 'Alpha Gymnastics', 'XS', 'Silver XS', WAG, { first: 'Newcomer', last: 'Invented' }); // joined after placement
    input.athletes.push(added);
    const doc = {
      pattern: 'one',
      squads: [
        { name: 'A', cards: [{ key: 'alpha::XS::0::-', athleteIds: [...alpha, 'WAG_alpha_left'] }] },
        { name: 'B', cards: [] }, { name: 'C', cards: [] }, { name: 'D', cards: [] },
      ],
      trayAthleteIds: input.athletes.filter((a) => a.clubId !== 'alpha' && a.id !== added.id).map((a) => a.id),
      schedule: { stretch: '8:00', warmups: '8:15', competition: '9:00' },
    };
    const user = await open(input, doc);
    expect(within(squad('A')).getByText(/Alpha Gymnastics – Silver XS/)).toBeInTheDocument();
    expect(screen.getByLabelText('Open stretch')).toHaveValue('8:00');
    const note = screen.getByTestId('squads-changes');
    expect(note).toHaveTextContent('2 athletes moved since you placed squads.');
    expect(note).toHaveTextContent('Newcomer Invented (new since you placed squads; in the unplaced list)');
    expect(note).toHaveTextContent('WAG_alpha_left');
    expect(store.saveSquadDoc).not.toHaveBeenCalled(); // restoring alone writes nothing
    await user.click(within(note).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('squads-changes')).toBeNull();
    await user.clear(screen.getByLabelText('Competition'));
    await user.type(screen.getByLabelText('Competition'), '10:30');
    await savedBy();
    const saved = lastSaved();
    expect(saved.schedule.competition).toBe('10:30');
    expect(saved.squads[0].cards[0].athleteIds.sort()).toEqual([...alpha].sort()); // dropped athlete gone from the record
    expect(saved.trayAthleteIds).toContain(added.id); // the newcomer is now a known, unplaced athlete
  });

  it('switching sessions and back keeps the latest edits', async () => {
    const user = await open();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Place in squad: Alpha Gymnastics – Silver XS' }), '1');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session' }), 's2-red');
    await screen.findByRole('heading', { name: /Session 2 – Red/ });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session' }), 's1-green');
    await screen.findByRole('heading', { name: /Session 1 – Green/ });
    expect(within(squad('B')).getByText('Alpha Gymnastics – Silver XS')).toBeInTheDocument();
  });

  it('shows an error with Try again when a save fails', async () => {
    const user = await open();
    store.saveSquadDoc.mockRejectedValueOnce(new Error('Missing permissions.'));
    await user.click(screen.getByRole('button', { name: 'Auto-balance' }));
    const alert = await screen.findByRole('alert', undefined, { timeout: 3000 });
    expect(alert).toHaveTextContent('Your last change did not save: Missing permissions.');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByTestId('squads-save')).toHaveTextContent(/^Saved · /));
  });

  it('shows a load error with a way to retry', async () => {
    store.loadSquadsInput.mockRejectedValueOnce(new Error('offline'));
    render(<AdminSquads />);
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
