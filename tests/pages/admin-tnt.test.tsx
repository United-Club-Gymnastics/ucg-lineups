import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DndContextProps } from '@dnd-kit/core';
import type { StoredAthlete } from '../../src/lib/import/diff';
import type { SynchroPair } from '../../src/lib/synchro-source';

const captured = vi.hoisted(() => ({ all: [] as DndContextProps[] }));
vi.mock('@dnd-kit/core', async (orig) => {
  const mod = await orig<typeof import('@dnd-kit/core')>();
  return { ...mod, DndContext: (p: DndContextProps & { children?: ReactNode }) => { captured.all.push(p); return <mod.DndContext {...p} />; } };
});
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
const store = vi.hoisted(() => ({ loadTntInput: vi.fn(), loadTntDoc: vi.fn(), saveTntDoc: vi.fn() }));
vi.mock('../../src/lib/data/tnt-store', () => store);
const synchro = vi.hoisted(() => ({ fetchSynchroPairs: vi.fn() }));
vi.mock('../../src/lib/synchro-source', () => synchro);
const assignStore = vi.hoisted(() => ({ saveSynchroAssignments: vi.fn() }));
vi.mock('../../src/lib/data/synchro-store', () => assignStore);

import AdminTnt from '../../src/pages/AdminTnt';

type Lv = Partial<Record<'TR' | 'DM' | 'TU' | 'SY', string>>;
const tntAth = (club: string, first: string, tnt: Lv, session = 's3-purple'): StoredAthlete => ({
  id: `TNT_${club.toLowerCase().replace(/\s+/g, '-')}_${first.toLowerCase()}-invented`, discipline: 'TNT', first, last: 'Invented',
  clubId: club.toLowerCase().replace(/\s+/g, '-'), clubName: club, independent: false, levelCode: Object.values(tnt)[0] ?? 'NF', levelName: 'x',
  sessionId: session, apparatus: Object.keys(tnt), tnt, competes: true,
});
const all3 = (l: string): Lv => ({ TR: l, DM: l, TU: l });
const idOf = (club: string, first: string) => `TNT_${club.toLowerCase().replace(/\s+/g, '-')}_${first.toLowerCase()}-invented`;

function fixture() {
  const athletes = [
    tntAth('Alpha Club', 'Ann', { ...all3('NF'), SY: 'NF' }), tntAth('Alpha Club', 'Abe', { ...all3('NF'), SY: 'NF' }), tntAth('Alpha Club', 'Al', { TR: 'NF', DM: 'NF' }),
    tntAth('Bravo Club', 'Bea', { ...all3('IF'), SY: 'IF' }), tntAth('Bravo Club', 'Bob', { ...all3('IF'), SY: 'IF' }),
    tntAth('Charlie Club', 'Cat', all3('HF')), tntAth('Charlie Club', 'Cy', { TR: 'IF', DM: 'HF', TU: 'HF' }),
    tntAth('Delta Club', 'Dot', { SY: 'HF' }), tntAth('Delta Club', 'Dan', { SY: 'HF' }),
    tntAth('Far Club', 'Fay', { SY: 'IF' }, 's4-purple'), tntAth('Far Club', 'Flo', { SY: 'IF' }, 's4-purple'),
  ];
  return {
    sessions: [
      { id: 's1-green', number: 1, gym: 'Green', discipline: 'WAG', levelCodes: ['XS'] },
      { id: 's4-purple', number: 4, gym: 'Purple', discipline: 'TNT', levelCodes: [] },
      { id: 's3-purple', number: 3, gym: 'Purple', discipline: 'TNT', levelCodes: [] },
    ],
    athletes,
    gymOrder: ['Green', 'Red', 'Yellow', 'Orange', 'Purple'],
    assignments: {} as Record<string, string>,
  };
}

let pairSeq = 0;
const pair = (name1: string, club1: string, name2: string, club2: string, level: string, id = `p${++pairSeq}`): SynchroPair => ({
  id, level, a1: '', name1, club1, a2: '', name2, club2, createdAt: null, source: '',
});
const PAIRS = () => [
  pair('Abe Invented', 'Alpha Club', 'Ann Invented', 'Alpha Club', 'New Flyers', 'pa'),
  pair('Bob Invented', 'Bravo Club', 'Bea Invented', 'Bravo Club', 'IF', 'pb'),
  pair('Dot Invented', 'Delta Club', 'Dan Invented', 'Delta Club', 'HF', 'pd'),
  pair('Dot Invented', 'Delta Club', 'Nobody Known', 'Delta Club', 'HF', 'pc'),
  pair('Fay Invented', 'Far Club', 'Flo Invented', 'Far Club', 'IF', 'pf'), // the other T&T session
];

async function open(input = fixture(), doc: unknown = null, pairs: SynchroPair[] | Error = PAIRS()) {
  store.loadTntInput.mockResolvedValue(input);
  store.loadTntDoc.mockResolvedValue(doc);
  store.saveTntDoc.mockResolvedValue(undefined);
  assignStore.saveSynchroAssignments.mockResolvedValue(undefined);
  if (pairs instanceof Error) synchro.fetchSynchroPairs.mockRejectedValue(pairs); else synchro.fetchSynchroPairs.mockResolvedValue(pairs);
  const user = userEvent.setup();
  render(<AdminTnt />);
  await screen.findByRole('heading', { name: /Session 3 – Purple/ });
  return user;
}

const lastSaved = () => store.saveTntDoc.mock.calls.at(-1)?.[2];
const squad = (letter: string) => screen.getByRole('region', { name: `Squad ${letter}` });
const savedBy = async (n = 1) => waitFor(() => expect(store.saveTntDoc.mock.calls.length).toBeGreaterThanOrEqual(n), { timeout: 3000 });
/** The drag context that belongs to the squads board (it has no row instructions) or to a reorder list. */
const board = () => [...captured.all].reverse().find((p) => !p.accessibility?.screenReaderInstructions)!;
const rows = (label: string) => [...captured.all].reverse().find((p) => p.accessibility?.screenReaderInstructions?.draggable.includes(`in ${label},`))!;
const names = (list: HTMLElement) => within(list).getAllByRole('listitem').map((li) => li.querySelector('b')?.textContent ?? '');

beforeEach(() => { vi.clearAllMocks(); captured.all.length = 0; pairSeq = 0; });

describe('T&T screen', () => {
  it('lists only T&T sessions (gym order, then number) and shows the header counts', async () => {
    await open();
    await screen.findByText(/3 synchro pairs/);
    const picker = screen.getByRole('combobox', { name: 'Session' });
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Session 3 – Purple (T&T)', 'Session 4 – Purple (T&T)']);
    expect(screen.getByText(/T&T · Purple Gym · 7 athletes in squads · 2 synchro only · 3 synchro pairs/)).toBeInTheDocument();
  });

  it('starts with everyone unplaced and nothing written until the host acts', async () => {
    await open();
    expect(screen.getByText(/Unplaced athletes \(7\)/)).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /^Squad [A-C]$/ })).toHaveLength(3);
    expect(screen.getByText(/Synchro only \(not in a squad\)/)).toBeInTheDocument();
    expect(screen.getByText(/Dan Invented \(Delta Club\), Dot Invented \(Delta Club\)/)).toBeInTheDocument();
    expect(store.saveTntDoc).not.toHaveBeenCalled();
  });

  it('shows the rotation under each squad name', async () => {
    await open();
    expect(within(squad('A')).getByText('Trampoline → Double Mini → Tumbling')).toBeInTheDocument();
    expect(within(squad('B')).getByText('Double Mini → Tumbling → Trampoline')).toBeInTheDocument();
    expect(within(squad('C')).getByText('Tumbling → Trampoline → Double Mini')).toBeInTheDocument();
  });

  it('auto-balance places everyone, keeps synchro-only out, and saves a plan with no nested arrays', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Auto-balance' }));
    expect(screen.getByText('Everyone is in a squad.')).toBeInTheDocument();
    await savedBy();
    const doc = lastSaved();
    expect(doc.kind).toBe('tnt');
    expect(doc.squads.map((s: { name: string }) => s.name)).toEqual(['A', 'B', 'C']);
    const placed: string[] = doc.squads.flatMap((s: { athleteIds: string[] }) => s.athleteIds);
    expect(placed).toHaveLength(7);
    expect(placed.some((id) => id.includes('delta-club'))).toBe(false);
    expect(doc.trayAthleteIds).toEqual([]);
    expect(doc.orders).toEqual({});
    for (const v of [doc.squads, doc.flights, ...Object.values(doc.orders)]) for (const x of v as unknown[]) expect(Array.isArray(x)).toBe(false);
    await waitFor(() => expect(screen.getByTestId('squads-save')).toHaveTextContent(/^Saved · /));
  });

  it('the Move to squad menu and a drag both move an athlete; the plan is saved', async () => {
    const user = await open();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move to squad: Ann Invented' }), '2');
    expect(within(squad('C')).getByText('Ann Invented')).toBeInTheDocument();
    act(() => { board().onDragEnd!({ active: { id: idOf('Alpha Club', 'Abe') }, over: { id: 'squad-1' } } as never); });
    expect(within(squad('B')).getByText('Abe Invented')).toBeInTheDocument();
    act(() => { board().onDragEnd!({ active: { id: idOf('Alpha Club', 'Abe') }, over: { id: 'tray' } } as never); });
    expect(screen.getByText(/Unplaced athletes \(6\)/)).toBeInTheDocument();
    await savedBy();
    expect(lastSaved().squads[2].athleteIds).toEqual([idOf('Alpha Club', 'Ann')]);
    expect(lastSaved().trayAthleteIds).toHaveLength(6);
  });

  it('flags a squad above 12 and over 15, and mixed levels per event', async () => {
    const input = fixture();
    input.athletes.push(...Array.from({ length: 10 }, (_, i) => tntAth('Echo Club', `Echo${i}`, { TR: 'NF', DM: 'NF', TU: 'NF' })));
    const user = await open(input);
    for (const a of input.athletes.filter((x) => x.sessionId === 's3-purple' && Object.keys(x.tnt!).some((k) => k !== 'SY'))) {
      await user.selectOptions(screen.getByRole('combobox', { name: `Move to squad: ${a.first} Invented` }), '0');
    }
    // 17 athletes in squad A
    expect(within(squad('A')).getByText('17 athletes: over 15')).toBeInTheDocument();
    expect(within(squad('A')).getByText(/Mixed levels: TR HF\/IF\/NF · DM HF\/IF\/NF · TU HF\/IF\/NF/)).toBeInTheDocument();
    expect(within(squad('B')).queryByText(/Mixed levels/)).toBeNull();
  });

  it('lists athletes by club then first name with their levels', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Auto-balance' }));
    const all = screen.getAllByRole('listitem').map((li) => li.querySelector('b')?.textContent).filter(Boolean);
    expect(all).toContain('Cy Invented');
    const cy = screen.getByText('Cy Invented').closest('li')!;
    expect(cy.textContent).toContain('TR IF');
    expect(cy.textContent).toContain('DM HF');
  });

  describe('competing order', () => {
    async function placed() {
      const user = await open();
      for (const a of ['Ann', 'Abe', 'Al', 'Cat', 'Cy']) await user.selectOptions(screen.getByRole('combobox', { name: `Move to squad: ${a} Invented` }), '0');
      return user;
    }
    const orderList = () => screen.getByRole('list', { name: /Trampoline, Squad A/ });

    it('defaults to HF > IF > NF, then club, then first name, and only shows athletes on the event', async () => {
      await placed();
      // TR: Cat HF, Cy IF, then NF: Alpha Club Abe, Al, Ann
      expect(names(orderList())).toEqual(['Cat Invented', 'Cy Invented', 'Abe Invented', 'Al Invented', 'Ann Invented']);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Tumbling' }));
      expect(names(screen.getByRole('list', { name: /Tumbling, Squad A/ }))).toEqual(['Cat Invented', 'Cy Invented', 'Abe Invented', 'Ann Invented']);
    });

    it('a drag saves a custom order (and only non-default orders are stored); Reset to default clears it', async () => {
      const user = await placed();
      expect(screen.getByRole('button', { name: 'Reset to default' })).toBeDisabled();
      act(() => { rows('Trampoline, Squad A').onDragEnd!({ active: { id: idOf('Alpha Club', 'Ann') }, over: { id: idOf('Charlie Club', 'Cat') } } as never); });
      expect(names(orderList())).toEqual(['Ann Invented', 'Cat Invented', 'Cy Invented', 'Abe Invented', 'Al Invented']);
      await savedBy();
      expect(lastSaved().orders.A_TR).toEqual(['Ann', 'Cat', 'Cy', 'Abe', 'Al'].map((f) => idOf(f === 'Cat' || f === 'Cy' ? 'Charlie Club' : 'Alpha Club', f)));
      await user.click(screen.getByRole('button', { name: 'Reset to default' }));
      expect(names(orderList())).toEqual(['Cat Invented', 'Cy Invented', 'Abe Invented', 'Al Invented', 'Ann Invented']);
      await waitFor(() => expect(lastSaved().orders).toEqual({}));
    });

    it('moving an athlete out of the squad drops them from its order', async () => {
      const user = await placed();
      await user.selectOptions(screen.getByRole('combobox', { name: 'Move to squad: Cat Invented' }), '1');
      expect(names(orderList())).toEqual(['Cy Invented', 'Abe Invented', 'Al Invented', 'Ann Invented']);
    });
  });

  describe('synchro flights', () => {
    it('reads pairs, matches them, and splits HF > IF > NF into two flights; pairs that cannot be placed wait under Needs a session', async () => {
      await open();
      await screen.findByRole('list', { name: 'Flight A' });
      const a = screen.getByRole('list', { name: 'Flight A' });
      const b = screen.getByRole('list', { name: 'Flight B' });
      // 3 pairs of this session (HF Delta, IF Bravo, NF Alpha); the other session's pair is left out
      expect(names(a)).toEqual(['Dot Invented & Dan Invented', 'Bob Invented & Bea Invented']);
      expect(names(b)).toEqual(['Abe Invented & Ann Invented']);
      const needs = screen.getByTestId('needs-session');
      expect(within(needs).getByRole('heading', { name: 'Needs a session' })).toBeInTheDocument();
      expect(within(needs).getAllByRole('listitem')).toHaveLength(1);
      expect(within(needs).getByText('Dot Invented & Nobody Known')).toBeInTheDocument();
      expect(within(needs).getByText('Check pair')).toBeInTheDocument();
      expect(within(needs).getByText('Nobody Known is not in this import')).toBeInTheDocument();
      expect(store.saveTntDoc).not.toHaveBeenCalled(); // viewing writes nothing
      expect(assignStore.saveSynchroAssignments).not.toHaveBeenCalled();
    });

    it('the Needs a session list sits above the flights and is absent when empty', async () => {
      await open(fixture(), null, PAIRS().filter((p) => p.id !== 'pc'));
      await screen.findByRole('list', { name: 'Flight A' });
      expect(screen.queryByTestId('needs-session')).toBeNull();
    });

    it('a pair whose athletes are in different sessions waits for the host; choosing a session stores it and Refresh pairs keeps it', async () => {
      const cross = pair('Dot Invented', 'Delta Club', 'Fay Invented', 'Far Club', 'HF', 'pcross');
      const user = await open(fixture(), null, [...PAIRS(), cross]);
      await screen.findByRole('list', { name: 'Flight A' });
      const needs = screen.getByTestId('needs-session');
      expect(within(needs).getByText('Dot Invented is in Session 3 – Purple; Fay Invented is in Session 4 – Purple.')).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Flight A' })!.textContent).not.toContain('Fay Invented');
      await user.selectOptions(within(needs).getByRole('combobox', { name: 'Move to session for Dot Invented & Fay Invented' }), 's3-purple');
      expect(assignStore.saveSynchroAssignments).toHaveBeenLastCalledWith({}, { pcross: 's3-purple' });
      const all = [...names(screen.getByRole('list', { name: 'Flight A' })), ...names(screen.getByRole('list', { name: 'Flight B' }))];
      expect(all).toContain('Dot Invented & Fay Invented');
      expect(within(screen.getByTestId('needs-session')).queryByText('Dot Invented & Fay Invented')).toBeNull();
      // Refresh pairs re-reads the Synchro tool and keeps the choice
      await user.click(screen.getByRole('button', { name: 'Refresh pairs' }));
      await screen.findByText(/Pairs refreshed|Read \d+ pairs?/);
      const after = [...names(screen.getByRole('list', { name: 'Flight A' })), ...names(screen.getByRole('list', { name: 'Flight B' }))];
      expect(after).toContain('Dot Invented & Fay Invented');
      await savedBy();
      expect(lastSaved().flights.flatMap((f: { pairIds: string[] }) => f.pairIds)).toContain('pcross');
      expect(assignStore.saveSynchroAssignments).toHaveBeenCalledTimes(1); // Refresh pairs wrote no choices
    });

    it('Move to session sends a pair to another T&T session and takes it out of this session\'s flights', async () => {
      const user = await open();
      await screen.findByRole('list', { name: 'Flight A' });
      await user.selectOptions(screen.getByRole('combobox', { name: 'Move to session for Bob Invented & Bea Invented' }), 's4-purple');
      expect(assignStore.saveSynchroAssignments).toHaveBeenLastCalledWith({}, { pb: 's4-purple' });
      const left = [...names(screen.getByRole('list', { name: 'Flight A' })), ...names(screen.getByRole('list', { name: 'Flight B' }))];
      expect(left).not.toContain('Bob Invented & Bea Invented');
      expect(screen.getByText('Bob Invented & Bea Invented moved to Session 4 – Purple.')).toBeInTheDocument();
    });

    it('a stored choice already in synchroSessions/main places the pair there', async () => {
      const input = { ...fixture(), assignments: { pa: 's4-purple' } };
      await open(input);
      await screen.findByRole('list', { name: 'Flight A' });
      const shown = [...names(screen.getByRole('list', { name: 'Flight A' })), ...names(screen.getByRole('list', { name: 'Flight B' }))];
      expect(shown).not.toContain('Abe Invented & Ann Invented');
    });

    it('flags a pair when an athlete is on the roster but not entered in synchro', async () => {
      await open(fixture(), null, [...PAIRS(), pair('Cat Invented', 'Charlie Club', 'Cy Invented', 'Charlie Club', 'HF', 'pnoSY')]);
      await screen.findByRole('list', { name: 'Flight A' });
      expect(screen.getByText(/1 pair flagged .Check pair./)).toBeInTheDocument();
      expect(screen.getByText('Cat Invented is on the roster but not entered in synchro; Cy Invented is on the roster but not entered in synchro')).toBeInTheDocument();
    });

    it('moves a pair with the menu or a drag, and saves the flights', async () => {
      const user = await open();
      await screen.findByRole('list', { name: 'Flight A' });
      await user.selectOptions(screen.getByRole('combobox', { name: 'Flight for Dot Invented & Dan Invented' }), '1');
      expect(names(screen.getByRole('list', { name: 'Flight B' }))).toEqual(['Abe Invented & Ann Invented', 'Dot Invented & Dan Invented']);
      act(() => { rows('Synchro flights').onDragEnd!({ active: { id: 'pa' }, over: { id: 'rl-list-flight-0' } } as never); });
      expect(names(screen.getByRole('list', { name: 'Flight A' }))).toEqual(['Bob Invented & Bea Invented', 'Abe Invented & Ann Invented']);
      await savedBy();
      expect(lastSaved().flights).toEqual([{ name: 'A', pairIds: ['pb', 'pa'] }, { name: 'B', pairIds: ['pd'] }]);
      expect(lastSaved().pairsReadAt).toBeInstanceOf(Date);
    });

    it('adds a flight and removes an empty one', async () => {
      const user = await open();
      await screen.findByRole('list', { name: 'Flight A' });
      await user.click(screen.getByRole('button', { name: 'Add a flight' }));
      expect(screen.getByRole('list', { name: 'Flight C' })).toBeInTheDocument();
      await savedBy();
      expect(lastSaved().flights.map((f: { name: string }) => f.name)).toEqual(['A', 'B', 'C']);
      await user.click(screen.getByRole('button', { name: 'Remove flight C' }));
      expect(screen.queryByRole('list', { name: 'Flight C' })).toBeNull();
    });

    it('Refresh pairs adds new pairs at the end of their level, drops pairs that left the session, keeps the order', async () => {
      const user = await open(fixture(), {
        kind: 'tnt', squads: [], trayAthleteIds: [], orders: {}, pairsReadAt: null,
        flights: [{ name: 'A', pairIds: ['pc', 'pd'] }, { name: 'B', pairIds: ['pb', 'pa', 'pgone'] }],
      });
      await screen.findByRole('list', { name: 'Flight A' });
      // 'pc' needs a session and 'pgone' was deleted from the Synchro tool; nothing is silent: a notice says what a refresh would do
      expect(names(screen.getByRole('list', { name: 'Flight B' }))).toEqual(['Bob Invented & Bea Invented', 'Abe Invented & Ann Invented']);
      synchro.fetchSynchroPairs.mockResolvedValue([...PAIRS(), pair('Cat Invented', 'Charlie Club', 'Cy Invented', 'Charlie Club', 'HF', 'pnew')]);
      await user.click(screen.getByRole('button', { name: 'Refresh pairs' }));
      expect(await screen.findByText(/Pairs refreshed: 1 added, 2 removed/)).toBeInTheDocument();
      expect(names(screen.getByRole('list', { name: 'Flight A' }))).toEqual(['Dot Invented & Dan Invented', 'Cat Invented & Cy Invented']);
      expect(names(screen.getByRole('list', { name: 'Flight B' }))).toEqual(['Bob Invented & Bea Invented', 'Abe Invented & Ann Invented']);
      await savedBy();
      expect(lastSaved().flights).toEqual([{ name: 'A', pairIds: ['pd', 'pnew'] }, { name: 'B', pairIds: ['pb', 'pa'] }]);
    });

    it('tells the host when the Synchro tool changed since flights were saved, and keeps showing what was saved', async () => {
      await open(fixture(), {
        kind: 'tnt', squads: [], trayAthleteIds: [], orders: {}, pairsReadAt: new Date('2026-10-01T12:00:00Z'),
        flights: [{ name: 'A', pairIds: ['pd', 'pc'] }, { name: 'B', pairIds: ['pb'] }],
      });
      expect(await screen.findByTestId('synchro-stale')).toHaveTextContent('1 new pair, 1 deleted');
      expect(names(screen.getByRole('list', { name: 'Flight A' }))).toEqual(['Dot Invented & Dan Invented']);
    });

    it('shows an error and leaves the rest of the screen working when the Synchro tool cannot be read', async () => {
      const user = await open(fixture(), null, new Error('offline'));
      expect(await screen.findByText(/Could not read the Synchro tool: offline/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Auto-balance' }));
      await savedBy();
      expect(lastSaved().flights).toEqual([]);
    });
  });

  it('restores a saved plan and lists who left and who joined since', async () => {
    const stored = {
      kind: 'tnt',
      squads: [
        { name: 'A', athleteIds: [idOf('Alpha Club', 'Ann'), 'TNT_gone-club_zed-invented'] },
        { name: 'B', athleteIds: [idOf('Bravo Club', 'Bea')] },
        { name: 'C', athleteIds: [] },
      ],
      trayAthleteIds: [idOf('Alpha Club', 'Abe')],
      orders: {}, flights: [], pairsReadAt: null,
    };
    await open(fixture(), stored);
    expect(within(squad('A')).getByText('Ann Invented')).toBeInTheDocument();
    expect(within(squad('B')).getByText('Bea Invented')).toBeInTheDocument();
    const notice = screen.getByTestId('squads-changes');
    expect(notice).toHaveTextContent('Removed from Squad A');
    expect(notice).toHaveTextContent('TNT_gone-club_zed-invented');
    expect(notice).toHaveTextContent('New since you placed squads, in the unplaced list');
    expect(notice).toHaveTextContent('Cy Invented · Charlie Club');
    expect(notice).not.toHaveTextContent('Abe Invented'); // known and left unplaced on purpose
    expect(store.saveTntDoc).not.toHaveBeenCalled();
  });

  it('shows an error with Try again when a save fails', async () => {
    const user = await open();
    store.saveTntDoc.mockRejectedValueOnce(new Error('permission-denied'));
    await user.click(screen.getByRole('button', { name: 'Auto-balance' }));
    expect(await screen.findByText(/Your last change did not save: permission-denied/, undefined, { timeout: 3000 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByTestId('squads-save')).toHaveTextContent(/^Saved · /));
  });

  it('asks before Auto-balance replaces placed squads', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Auto-balance' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Move to squad: Ann Invented' }), '2');
    await user.click(screen.getByRole('button', { name: 'Auto-balance' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(within(squad('C')).getByText('Ann Invented')).toBeInTheDocument();
  });
});
