import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PagePreview } from '../../src/components/PdfPreview';
import { artisticScorecardPages } from '../../src/lib/pdf/artistic-scorecards-content';
import { numberPages } from '../../src/lib/pdf/model';
import { tntScorecardPages } from '../../src/lib/pdf/tnt-scorecards-content';
import { buildArtisticSessionInput, buildTntSessionInput } from '../../src/lib/pdf/session-input';
import { MEET, magFixture, tntFixture } from '../pdf/fixtures';

describe('preview: the sheet QR and the Scratch? column (Julia 2026-10-28)', () => {
  it('an artistic scorecard shows its QR (labelled with its link) and Scratch? as the first column', () => {
    const f = magFixture();
    const [page] = numberPages(artisticScorecardPages(buildArtisticSessionInput({ session: f.session, athletes: f.athletes, ordersByClub: f.ordersByClub, stored: f.stored, meet: MEET })), 'today');
    const { container } = render(<PagePreview page={page} />);
    expect(screen.getByRole('img', { name: `QR code: ${page.qr}` })).toBeInTheDocument();
    expect(page.qr).toMatch(/^https:\/\/scorecards\.unitedclubgymnastics\.org\/#\/s\/sampleMeet01\//);
    expect(container.querySelector('.pv-headrow')!.firstElementChild).toHaveTextContent('Scratch?');
  });

  it('a T&T scorecard shows its QR too', () => {
    const f = tntFixture();
    const [page] = numberPages(tntScorecardPages(buildTntSessionInput({ session: f.session, athletes: f.athletes, stored: f.stored, pairs: f.pairs, meet: MEET })), 'today');
    render(<PagePreview page={page} />);
    expect(screen.getByRole('img', { name: /^QR code: https:\/\/scorecards\./ })).toBeInTheDocument();
  });
});
