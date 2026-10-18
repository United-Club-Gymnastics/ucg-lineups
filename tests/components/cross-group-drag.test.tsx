// Cross-group drag on the club order card (deviation from the platform card). jsdom has no layout, so the
// DndContext is wrapped to capture its handlers and the drag events are fed to them directly.
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DndContextProps } from '@dnd-kit/core';

const captured = vi.hoisted(() => ({ props: null as null | DndContextProps }));
vi.mock('@dnd-kit/core', async (orig) => {
  const mod = await orig<typeof import('@dnd-kit/core')>();
  return { ...mod, DndContext: (p: DndContextProps & { children?: ReactNode }) => { captured.props = p; return <mod.DndContext {...p} />; } };
});

import { CompetitionOrderCard, type OrderChange } from '../../src/components/CompetitionOrderCard';
import { resolveLevel } from '../../src/lib/club-order-model';
import type { LinkAthlete } from '../../src/lib/club-links';

const NAMES = ['Ava', 'Bea', 'Cy', 'Dee', 'Eve', 'Fay', 'Gia', 'Hal'];
// All on VT and UB; groups A = Ava..Dee, B = Eve..Hal.
const ath: LinkAthlete[] = NAMES.map((first, i) => ({ id: `W${i}`, first, last: 'Test', apparatus: ['VT', 'UB'] }));

function renderCard(onChange: (c: OrderChange) => void, apparatus = 'VT') {
  const saved = { groups: [['W0', 'W1', 'W2', 'W3'], ['W4', 'W5', 'W6', 'W7']], sections: {}, splitDecided: false };
  const r = resolveLevel('WAG', ath, saved);
  render(<CompetitionOrderCard athletes={ath} discipline="WAG" groups={r.groups} sections={r.sectionsBy} editable apparatus={apparatus} onChange={onChange} />);
}
const drop = (active: string, over: string) => act(() => {
  captured.props!.onDragEnd!({ active: { id: active }, over: { id: over } } as never);
});

describe('cross-group drag', () => {
  it('dropping on an athlete in another group puts them at that spot on this apparatus', () => {
    const spy = vi.fn();
    renderCard(spy);
    drop('W0', 'W6'); // Ava onto Gia (index 2 of group B)
    const c = spy.mock.calls[0][0] as OrderChange;
    expect(c.membershipChanged).toBe(true);
    expect(c.groups[0]).toEqual(['W1', 'W2', 'W3']);
    expect(c.groups[1][0]).toBe('W0');
    expect(c.sections.VT[1]).toEqual(['W4', 'W5', 'W0', 'W6', 'W7']);
    expect(c.sections.VT[0]).toEqual(['W1', 'W2', 'W3']);
  });

  it('on every other apparatus the moved athlete goes first in the new group', () => {
    const spy = vi.fn();
    renderCard(spy);
    drop('W0', 'W6');
    const c = spy.mock.calls[0][0] as OrderChange;
    expect(c.sections.UB[1]).toEqual(['W0', 'W4', 'W5', 'W6', 'W7']);
  });

  it('dropping on another group itself (header or empty area) appends on this apparatus', () => {
    const spy = vi.fn();
    renderCard(spy);
    drop('W0', 'co-group-1');
    const c = spy.mock.calls[0][0] as OrderChange;
    expect(c.sections.VT[1]).toEqual(['W4', 'W5', 'W6', 'W7', 'W0']);
    expect(c.sections.UB[1][0]).toBe('W0');
  });

  it('a drop within the same group is a reorder, not a membership change', () => {
    const spy = vi.fn();
    renderCard(spy);
    drop('W0', 'W2');
    const c = spy.mock.calls[0][0] as OrderChange;
    expect(c.membershipChanged).toBe(false);
    expect(c.sections.VT[0]).toEqual(['W1', 'W2', 'W0', 'W3']);
    expect(c.groups).toEqual([['W0', 'W1', 'W2', 'W3'], ['W4', 'W5', 'W6', 'W7']]);
  });

  it('dropping on itself or on nothing changes nothing; the move buttons are still there', () => {
    const spy = vi.fn();
    renderCard(spy);
    drop('W0', 'W0');
    act(() => { captured.props!.onDragEnd!({ active: { id: 'W0' }, over: null } as never); });
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Move Ava Test to Group B' })).toBeTruthy();
  });

  it('announcements describe a cross-group landing', () => {
    renderCard(() => {});
    const a = captured.props!.accessibility!.announcements!;
    expect(a.onDragOver!({ active: { id: 'W0' }, over: { id: 'W6' } } as never)).toBe('Ava Test moved to position 3 of 5 on Vault, Group B.');
    expect(a.onDragEnd!({ active: { id: 'W0' }, over: { id: 'co-group-1' } } as never)).toBe('Ava Test dropped at position 5 of 5 on Vault, Group B.');
  });
});
