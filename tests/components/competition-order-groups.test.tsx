// Adapted from ucg-platform@e57754a tests/components/competition-order-groups.test.tsx — keep in sync by hand
// Changed: the card is now controlled (athletes/groups/sections/onChange props), so a small harness holds the
// state and records every onChange. Store/Supabase/lock/toast tests are dropped (those features are gone);
// added: read-only mode, apparatus filter, A-Z default, membershipChanged flag. Drag itself is not simulated (jsdom has no layout).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useState } from 'react';
import { CompetitionOrderCard, type OrderChange } from '../../src/components/CompetitionOrderCard';
import { resolveLevel } from '../../src/lib/club-order-model';
import type { LinkAthlete } from '../../src/lib/club-links';

// 14 invented WAG athletes: everyone on VT; even-numbered also on UB. Names A.. in order.
const NAMES = ['Ava', 'Bea', 'Cy', 'Dee', 'Eve', 'Fay', 'Gia', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lou', 'Mia', 'Nat'];
const athletes = (n = 14): LinkAthlete[] =>
  NAMES.slice(0, n).map((first, i) => ({ id: `W${i}`, first, last: 'Test', apparatus: i % 2 === 0 ? ['VT', 'UB'] : ['VT'] }));
const nameOfId = (id: string) => `${NAMES[Number(id.slice(1))]} Test`;

function Harness({
  ath, editable = true, initial, apparatus, onChangeSpy,
}: {
  ath: LinkAthlete[]; editable?: boolean; initial?: Parameters<typeof resolveLevel>[2]; apparatus?: string;
  onChangeSpy?: (c: OrderChange) => void;
}) {
  const [saved, setSaved] = useState(initial);
  const r = resolveLevel('WAG', ath, saved);
  return (
    <CompetitionOrderCard
      athletes={ath}
      discipline="WAG"
      groups={r.groups}
      sections={r.sectionsBy}
      editable={editable}
      apparatus={apparatus}
      onChange={(c) => { onChangeSpy?.(c); setSaved({ groups: c.groups, sections: c.sections, splitDecided: true }); }}
    />
  );
}

describe('CompetitionOrderCard — groups', () => {
  it('seeds 14 WAG athletes into two even A-Z groups, one column per apparatus in each', () => {
    render(<Harness ath={athletes()} />);
    expect(screen.getByText('Groups ready')).toBeTruthy();
    const a = screen.getByTestId('co-group-0');
    const b = screen.getByTestId('co-group-1');
    expect(within(a).getByText('busiest event 7 / 12')).toBeTruthy();
    expect(within(b).getByText('busiest event 7 / 12')).toBeTruthy();
    expect(within(a).getByText('7 athletes')).toBeTruthy();
    expect(within(a).getByText('Vault')).toBeTruthy();
    expect(within(a).getByText('Uneven Bars')).toBeTruthy();
    const vtA = within(a).getByTestId('co-0-VT').textContent ?? '';
    for (let i = 0; i < 7; i++) expect(vtA).toContain(nameOfId(`W${i}`));
    for (let i = 7; i < 14; i++) expect(vtA).not.toContain(nameOfId(`W${i}`));
    // A-Z inside the list.
    for (let i = 1; i < 7; i++) expect(vtA.indexOf(nameOfId(`W${i - 1}`))).toBeLessThan(vtA.indexOf(nameOfId(`W${i}`)));
  });

  it('flags an over-cap group; auto-split fixes it and reports a membership change', () => {
    const spy = vi.fn();
    render(<Harness ath={athletes()} initial={{ groups: [athletes().map((a) => a.id)], sections: {}, splitDecided: false }} onChangeSpy={spy} />);
    expect(screen.getByText('Split required — max 12 per event in a group')).toBeTruthy();
    expect(within(screen.getByTestId('co-group-0')).getByText('busiest event 14 / 12')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Auto-split evenly' }));
    expect(screen.getByText('Groups ready')).toBeTruthy();
    const change = spy.mock.calls[0][0] as OrderChange;
    expect(change.membershipChanged).toBe(true);
    expect(change.groups.map((g) => g.length)).toEqual([7, 7]);
    for (const code of ['VT', 'UB']) {
      expect(change.sections[code]).toHaveLength(2);
      change.sections[code].forEach((sec, k) => sec.forEach((id) => expect(change.groups[k]).toContain(id)));
    }
    expect(change.sections.VT.flat().sort()).toEqual(athletes().map((a) => a.id).sort());
  });

  it('moves an athlete to another group on every apparatus; they go first in the new group', () => {
    const spy = vi.fn();
    render(<Harness ath={athletes()} onChangeSpy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Ava Test to Group B' }));
    const c = spy.mock.calls[0][0] as OrderChange;
    expect(c.membershipChanged).toBe(true);
    expect(c.groups[0]).not.toContain('W0');
    expect(c.groups[1][0]).toBe('W0');
    expect(c.sections.VT[1][0]).toBe('W0');
    expect(c.sections.UB[1][0]).toBe('W0');
    expect(c.sections.VT[0]).not.toContain('W0');
  });

  it('adds a group and removes an empty one', () => {
    const spy = vi.fn();
    render(<Harness ath={athletes()} onChangeSpy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add group' }));
    expect((spy.mock.calls[0][0] as OrderChange).groups).toHaveLength(3);
    const c = screen.getByTestId('co-group-2');
    expect(within(c).getByText('busiest event 0 / 12')).toBeTruthy();
    fireEvent.click(within(c).getByRole('button', { name: 'Remove group' }));
    expect((spy.mock.calls[1][0] as OrderChange).groups).toHaveLength(2);
    expect((spy.mock.calls[1][0] as OrderChange).sections.VT).toHaveLength(2);
  });

  it('a non-empty group has no Remove control', () => {
    render(<Harness ath={athletes()} />);
    expect(within(screen.getByTestId('co-group-0')).queryByRole('button', { name: 'Remove group' })).toBeNull();
  });

  it('read-only: no edit controls, no drag handles, order still listed', () => {
    render(<Harness ath={athletes()} editable={false} />);
    expect(screen.queryByRole('button', { name: 'Auto-split evenly' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
    expect(screen.queryByText(/Drag athletes/)).toBeNull();
    expect(screen.getByTestId('co-group-0').textContent).toContain('Ava Test');
    expect(screen.queryByText('⠿')).toBeNull();
  });

  it('keeps a saved per-apparatus order and puts a newly added athlete first in their group', () => {
    const ath = athletes(14);
    const groupA = ath.slice(0, 7).map((a) => a.id);
    const reversed = [...groupA].reverse();
    // W13 is not saved anywhere yet: a new athlete.
    render(<Harness ath={ath} initial={{ groups: [groupA, ath.slice(7, 13).map((a) => a.id)], sections: { VT: [reversed, ath.slice(7, 13).map((a) => a.id)] }, splitDecided: true }} />);
    const text = screen.getByTestId('co-0-VT').textContent ?? '';
    const names = ['W13', ...reversed].map(nameOfId);
    for (let i = 1; i < names.length; i++) expect(text.indexOf(names[i - 1])).toBeLessThan(text.indexOf(names[i]));
  });

  it('the cap is per apparatus: 14 athletes with at most 7 on any one event is ONE group, ready', () => {
    const ath = athletes().map((a, i) => ({ ...a, apparatus: i % 2 === 0 ? ['VT', 'UB'] : ['BB', 'FX'] }));
    render(<Harness ath={ath} />);
    expect(screen.getByText('Groups ready')).toBeTruthy();
    expect(screen.getAllByTestId(/^co-group-/)).toHaveLength(1);
    expect(within(screen.getByTestId('co-group-0')).getByText('busiest event 7 / 12')).toBeTruthy();
  });

  it('apparatus columns wrap in a grid, with no horizontal scroll container', () => {
    const { container } = render(<Harness ath={athletes()} />);
    expect(container.querySelector('.co-apparatus-grid')).toBeTruthy();
    for (const el of container.querySelectorAll<HTMLElement>('*')) expect(el.style.overflowX).not.toBe('auto');
  });

  it('the apparatus prop shows just that column', () => {
    render(<Harness ath={athletes()} apparatus="UB" />);
    const a = screen.getByTestId('co-group-0');
    expect(within(a).getByText('Uneven Bars')).toBeTruthy();
    expect(within(a).queryByText('Vault')).toBeNull();
  });
});
