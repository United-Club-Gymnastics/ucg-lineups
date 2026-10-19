// The styled Select (ported from nationals-tools select.js): ARIA listbox pattern, keyboard, selection, focus, labels, placement.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import Select, { type SelectOption } from '../../src/components/Select';
import { Field, Modal } from '../../src/components/ui';

const FRUIT: SelectOption[] = [
  { value: 'apple', label: 'Apple' }, { value: 'apricot', label: 'Apricot' }, { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry', disabled: true }, { value: 'date', label: 'Date' },
];

function Harness({ onChange, initial = 'banana', options = FRUIT, label }: { onChange?: (v: string) => void; initial?: string; options?: SelectOption[]; label?: string }) {
  const [v, setV] = useState(initial);
  const select = <Select value={v} options={options} onChange={(x) => { setV(x); onChange?.(x); }} aria-label={label ?? 'Fruit'} />;
  return <div><button type="button">before</button>{select}<button type="button">after</button></div>;
}
const box = () => screen.getByRole('combobox', { name: 'Fruit' });
const active = () => box().getAttribute('aria-activedescendant');

describe('Select: ARIA', () => {
  it('is a combobox button that names its listbox, shows the choice, and starts closed', () => {
    render(<Harness />);
    expect(box().tagName).toBe('BUTTON');
    expect(box()).toHaveTextContent('Banana');
    expect(box()).toHaveAttribute('aria-haspopup', 'listbox');
    expect(box()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('opens a listbox of options; the chosen one is aria-selected and the box points at the highlighted option', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    const list = screen.getByRole('listbox');
    expect(box()).toHaveAttribute('aria-expanded', 'true');
    expect(box()).toHaveAttribute('aria-controls', list.id);
    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Apple', 'Apricot', 'Banana', 'Cherry', 'Date']);
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false', 'false']);
    expect(options[3]).toHaveAttribute('aria-disabled', 'true');
    expect(active()).toBe(options[2].id); // opens on the chosen option
    expect(document.activeElement).toBe(box()); // focus never leaves the box
  });

  it('works with a visible label through Field (the label names the box)', () => {
    render(<Field label="Favourite fruit"><Select value="apple" options={FRUIT} onChange={() => {}} /></Field>);
    const named = screen.getByRole('combobox', { name: 'Favourite fruit' });
    expect(named).toHaveTextContent('Apple');
    expect(screen.getByLabelText('Favourite fruit')).toBe(named);
  });

  it('shows the placeholder when the value matches nothing, and a hidden input carries the value', () => {
    const { container } = render(<Select value="" options={FRUIT} onChange={() => {}} aria-label="Fruit" placeholder="Pick one" name="fruit" />);
    expect(box()).toHaveTextContent('Pick one');
    expect(container.querySelector('input[type=hidden][name=fruit]')).toHaveValue('');
  });

  it('a disabled box does not open', async () => {
    const user = userEvent.setup();
    render(<Select value="apple" options={FRUIT} onChange={() => {}} aria-label="Fruit" disabled />);
    expect(box()).toBeDisabled();
    await user.click(box());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('Select: selection', () => {
  it('clicking an option chooses it, closes the list and returns focus to the box', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(box());
    await user.click(screen.getByRole('option', { name: 'Date' }));
    expect(onChange).toHaveBeenCalledWith('date');
    expect(box()).toHaveTextContent('Date');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(box());
  });

  it('choosing the current option closes without a change event; a disabled option cannot be chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(box());
    await user.click(screen.getByRole('option', { name: 'Banana' }));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(box());
    await user.click(screen.getByRole('option', { name: 'Cherry' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('clicking the box again closes the list, and Tab away closes it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    await user.click(box());
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(box());
    await user.tab();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
  });
});

describe('Select: keyboard', () => {
  it('ArrowDown opens on the chosen option, then moves (skipping disabled), Up goes back, Home and End jump', async () => {
    const user = userEvent.setup();
    render(<Harness initial="apple" />);
    box().focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    const id = (name: string) => screen.getByRole('option', { name }).id;
    expect(active()).toBe(id('Apple'));
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(active()).toBe(id('Banana'));
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(id('Date')); // Cherry is disabled
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(id('Date')); // stays on the last
    await user.keyboard('{ArrowUp}');
    expect(active()).toBe(id('Banana'));
    await user.keyboard('{Home}');
    expect(active()).toBe(id('Apple'));
    await user.keyboard('{End}');
    expect(active()).toBe(id('Date'));
  });

  it('Enter and Space choose the highlighted option; the box keeps focus', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="apple" />);
    box().focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('apricot');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(box()).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith('banana');
    expect(box()).toHaveFocus();
  });

  it('Enter or Space on the closed box opens it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    box().focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.keyboard(' ');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('Escape closes without choosing and leaves focus on the box', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    box().focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(box()).toHaveFocus();
    expect(box()).toHaveAttribute('aria-expanded', 'false');
  });

  it('typeahead on the closed box changes the choice at once, like a native select', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="banana" />);
    box().focus();
    await user.keyboard('d');
    expect(onChange).toHaveBeenLastCalledWith('date');
    expect(box()).toHaveTextContent('Date');
  });

  it('typeahead on the open list moves the highlight; the same letter again cycles through the matches', async () => {
    const user = userEvent.setup();
    render(<Harness initial="apple" />);
    box().focus();
    await user.keyboard('{ArrowDown}');
    const id = (name: string) => screen.getByRole('option', { name }).id;
    await user.keyboard('a');
    expect(active()).toBe(id('Apricot'));
    await user.keyboard('a');
    expect(active()).toBe(id('Apple')); // wraps round to the first "a"
    await user.keyboard('d');
    expect(active()).toBe(id('Apple')); // "ad" matches nothing: the highlight stays
  });

  it('typing "apr" lands on Apricot', async () => {
    const user = userEvent.setup();
    render(<Harness initial="banana" />);
    box().focus();
    await user.keyboard('{ArrowDown}apr');
    expect(active()).toBe(screen.getByRole('option', { name: 'Apricot' }).id);
  });
});

describe('Select: inside a dialog', () => {
  it('Escape closes the open list and not the dialog; the next Escape closes the dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal title="Pick" onClose={onClose}><Harness /></Modal>);
    box().focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Select: placement', () => {
  function at(rect: Partial<DOMRect>, viewport = { w: 1280, h: 800 }, listWidth = 300) {
    vi.stubGlobal('innerWidth', viewport.w);
    vi.stubGlobal('innerHeight', viewport.h);
    const full = { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}), ...rect } as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(full);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(listWidth);
  }
  const list = () => screen.getByRole('listbox');

  it('opens below the box, left edges aligned, inside the page (a portal, so a table cannot clip it)', async () => {
    at({ left: 100, top: 100, right: 260, bottom: 144, width: 160, height: 44 });
    const user = userEvent.setup();
    render(<table><tbody><tr><td><Harness /></td></tr></tbody></table>);
    await user.click(box());
    expect(list().parentElement).toBe(document.body);
    expect(list().style.left).toBe('100px');
    expect(list().style.top).toBe('148px');
    expect(list().style.minWidth).toBe('160px');
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it('near the right edge the list shifts left so it stays on screen', async () => {
    at({ left: 1200, top: 100, right: 1270, bottom: 132, width: 70, height: 32 }, { w: 1280, h: 800 }, 300);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    expect(Number.parseFloat(list().style.left) + 300).toBeLessThanOrEqual(1280 - 8);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it('on a narrow phone it never starts left of the margin or wider than the screen', async () => {
    at({ left: 12, top: 100, right: 363, bottom: 144, width: 351, height: 44 }, { w: 375, h: 700 }, 900);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    expect(Number.parseFloat(list().style.left)).toBeGreaterThanOrEqual(8);
    expect(list().style.maxWidth).toBe('359px');
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it('near the bottom it opens above the box', async () => {
    at({ left: 100, top: 720, right: 260, bottom: 764, width: 160, height: 44 }, { w: 1280, h: 800 });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(box());
    expect(list().style.bottom).toBe('84px');
    expect(list().style.top).toBe('');
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });
});
