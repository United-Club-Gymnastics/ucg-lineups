// The public page listing several sessions' sheets. Invented people only.
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildArtisticSessionInput } from '../../src/lib/pdf/session-input';
import type { SessionExportInput } from '../../src/lib/pdf/collate';
import { MEET, magFixture } from '../pdf/fixtures';

vi.mock('../../src/lib/firebase', () => ({ db: {} }));
const store = vi.hoisted(() => ({ loadPublicSheet: vi.fn() }));
vi.mock('../../src/lib/data/export-store', () => store);

import SessionsPage from '../../src/pages/SessionsPage';

const mag = magFixture();
const built = buildArtisticSessionInput({ ...mag, meet: { ...MEET, date: 'April 9, 2027' } });
const input: SessionExportInput = { type: 'artistic', id: 's1-orange', name: 'Session 1', location: 'Orange', input: { ...built, schedule: { stretch: '07:30', warmups: '', competition: '8:45 AM' } } };

function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/sheets/:meetId" element={<SessionsPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('public sessions page', () => {
  it('lists each session in the link with its times and links to its sheets; one not published says so', async () => {
    store.loadPublicSheet.mockImplementation(async (_db, _m, id: string) => (id === 's1-orange' ? { title: 'Session 1 – Orange', input, publishedAt: null } : null));
    open('/sheets/nat27?s=s1-orange,s4-red');
    expect(await screen.findByRole('heading', { name: 'Your sessions' })).toBeInTheDocument();
    expect(store.loadPublicSheet.mock.calls.map((c) => c[2])).toEqual(['s1-orange', 's4-red']);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByRole('heading', { name: 'Session 1 – Orange' })).toBeInTheDocument();
    expect(items[0]).toHaveTextContent('April 9, 2027 · Open stretch 7:30 AM · Competition 8:45 AM');
    expect(within(items[0]).getByRole('link', { name: 'Rotation sheet for Session 1 – Orange' }).getAttribute('href')).toMatch(/#\/sheets\/nat27\/s1-orange\?doc=rotation$/);
    expect(within(items[0]).getByRole('link', { name: 'Scorecards for Session 1 – Orange' }).getAttribute('href')).toMatch(/#\/sheets\/nat27\/s1-orange\?doc=scorecards$/);
    expect(items[1]).toHaveTextContent('isn’t published yet');
  });

  it('none published says so', async () => {
    store.loadPublicSheet.mockResolvedValue(null);
    open('/sheets/nat27?s=a,b');
    expect(await screen.findByRole('heading', { name: 'These sheets aren’t published yet' })).toBeInTheDocument();
  });

  it('reads at most six sessions, each once', async () => {
    store.loadPublicSheet.mockResolvedValue(null);
    open('/sheets/nat27?s=a,a,b,c,d,e,f,g,h');
    await screen.findByRole('heading', { name: 'These sheets aren’t published yet' });
    expect(store.loadPublicSheet.mock.calls.map((c) => c[2])).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});
