// The public sheets page. Invented people only.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildArtisticSessionInput } from '../../src/lib/pdf/session-input';
import type { SessionExportInput } from '../../src/lib/pdf/collate';
import { MEET, magFixture } from '../pdf/fixtures';

vi.mock('../../src/lib/firebase', () => ({ db: {} }));
const store = vi.hoisted(() => ({ loadPublicSheet: vi.fn() }));
vi.mock('../../src/lib/data/export-store', () => store);
const files = vi.hoisted(() => ({ sessionPdf: vi.fn() }));
vi.mock('../../src/lib/pdf/files', () => files);

import SheetsPage from '../../src/pages/SheetsPage';

const mag = magFixture();
const built = buildArtisticSessionInput({ ...mag, meet: { ...MEET, date: 'April 9, 2027' } });
const input: SessionExportInput = { type: 'artistic', id: 's1-orange', name: 'Session 1', location: 'Orange', input: { ...built, schedule: { stretch: '07:30', warmups: '', competition: '8:45 AM' } } };

function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/sheets/:meetId/:sessionId" element={<SheetsPage />} /></Routes>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  files.sessionPdf.mockResolvedValue({ name: 'Session 1 - Orange - Rotation Sheet.pdf', bytes: new ArrayBuffer(8) });
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

describe('public sheets page', () => {
  it('shows the published session: title, date and times, the chosen sheets, Download PDF', async () => {
    store.loadPublicSheet.mockResolvedValue({ title: 'Session 1 – Orange', input, publishedAt: new Date('2027-04-01T16:00:00Z') });
    const user = open('/sheets/nat27/s1-orange?doc=scorecards');
    expect(await screen.findByRole('heading', { name: 'Session 1 – Orange' })).toBeInTheDocument();
    expect(store.loadPublicSheet).toHaveBeenCalledWith({}, 'nat27', 's1-orange');
    expect(screen.getByText('April 9, 2027 · Open stretch 7:30 AM · Competition 8:45 AM')).toBeInTheDocument();
    expect(screen.getByText('Updated Apr 1, 9:00 AM PT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scorecards' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('region', { name: /^Page \d+ of \d+/ }).length).toBeGreaterThan(1);

    await user.click(screen.getByRole('button', { name: 'Rotation sheet' }));
    expect(screen.getByRole('button', { name: 'Rotation sheet' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Session 1 - Orange - Rotation Sheet\.pdf/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(files.sessionPdf).toHaveBeenCalledWith('rotation', input, 'Apr 1, 2027');
  });

  it('says when the sheets are not published', async () => {
    store.loadPublicSheet.mockResolvedValue(null);
    open('/sheets/nat27/s9-nowhere');
    expect(await screen.findByRole('heading', { name: 'These sheets aren’t published yet' })).toBeInTheDocument();
  });

  it('a failed read says so, with Reload', async () => {
    store.loadPublicSheet.mockRejectedValue(new Error('offline'));
    open('/sheets/nat27/s1-orange');
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
