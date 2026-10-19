import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** Open a styled `Select` and pick an option by its value or its visible label. */
export async function choose(user: UserEvent, select: HTMLElement, valueOrLabel: string) {
  await user.click(select);
  const list = await screen.findByRole('listbox');
  const option = within(list).getAllByRole('option').find((o) => o.getAttribute('data-value') === valueOrLabel || o.textContent === valueOrLabel);
  if (!option) throw new Error(`No option "${valueOrLabel}" in: ${within(list).getAllByRole('option').map((o) => o.textContent).join(' | ')}`);
  await user.click(option);
}

/** The labels of a `Select`'s options, in order (opens the list and closes it again). */
export async function optionLabels(user: UserEvent, select: HTMLElement): Promise<string[]> {
  await user.click(select);
  const labels = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent ?? '');
  await user.keyboard('{Escape}');
  return labels;
}
