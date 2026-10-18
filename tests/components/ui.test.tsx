import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge, Field, Modal, Tabs } from '../../src/components/ui';

// New in ucg-lineups (the platform has no direct tests for these four components).
describe('Field', () => {
  it('associates the label with its control', () => {
    render(<Field label="First name"><input type="text" /></Field>);
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
  });
});

describe('Modal', () => {
  it('is a labelled dialog, focuses in, and closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Modal title="Edit" onClose={onClose}><button>OK</button></Modal>);
    expect(screen.getByRole('dialog', { name: 'Edit' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
  it('traps Tab inside the dialog', async () => {
    render(<Modal title="Edit" onClose={() => {}}><button>A</button></Modal>);
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});

describe('Tabs and Badge', () => {
  it('switches tabs', async () => {
    const onChange = vi.fn();
    render(<Tabs tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} active="a" onChange={onChange} />);
    await userEvent.click(screen.getByText('B'));
    expect(onChange).toHaveBeenCalledWith('b');
  });
  it('renders a badge', () => {
    render(<Badge tone="ok">Order set</Badge>);
    expect(screen.getByText('Order set')).toHaveClass('badge', 'ok');
  });
});
