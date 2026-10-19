import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompetitionOrderCard } from '../../src/components/CompetitionOrderCard';
import { resolveLevel } from '../../src/lib/club-order-model';
import type { LinkAthlete } from '../../src/lib/club-links';

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const css = readFileSync('src/pages/club.css', 'utf8');
const NAVY = '#1e2b38'; const NAVY_700 = '#313d48'; const CORAL_700 = '#b23a1f';
const tints = [
  { fill: /\.co-group \{\s*--g-fill: (#[0-9a-f]{6}); --g-strip: (#[0-9a-f]{6})/ },
  ...[1, 2, 3].map((n) => ({ fill: new RegExp(`data-tint='${n}'\\] \\{ --g-fill: (#[0-9a-f]{6}); --g-strip: (#[0-9a-f]{6})`) })),
].map((t) => { const m = t.fill.exec(css)!; return { fill: m[1], strip: m[2] }; });

describe('group tints', () => {
  it('there are four, all light, and each differs from the next', () => {
    expect(tints).toHaveLength(4);
    for (const t of tints) { expect(lum(t.fill)).toBeGreaterThan(0.7); expect(lum(t.strip)).toBeGreaterThan(0.6); }
    for (let i = 0; i < 4; i++) expect(tints[i].fill).not.toBe(tints[(i + 1) % 4].fill);
  });
  it('every text pairing on a tint is WCAG AA (4.5:1) or better; the drop line (navy) is above 3:1', () => {
    for (const t of tints) {
      for (const bg of [t.fill, t.strip]) {
        expect(ratio(NAVY, bg)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(NAVY_700, bg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(CORAL_700, t.fill)).toBeGreaterThanOrEqual(4.5); // "over the cap" text sits in the body, on the fill
      expect(ratio(NAVY, t.fill)).toBeGreaterThanOrEqual(3);
    }
  });
  it('groups cycle through the tints and each has a header strip', () => {
    const ath: LinkAthlete[] = Array.from({ length: 5 }, (_, i) => ({ id: `W${i}`, first: `A${i}`, last: 'Test', apparatus: ['VT'] }));
    const r = resolveLevel('WAG', ath, { groups: ath.map((a) => [a.id]), sections: { VT: ath.map((a) => [a.id]) }, splitDecided: true });
    const { container } = render(<CompetitionOrderCard athletes={ath} discipline="WAG" groups={r.groups} sections={r.sectionsBy} editable apparatus="VT" onChange={() => {}} />);
    expect([0, 1, 2, 3, 4].map((i) => screen.getByTestId(`co-group-${i}`).getAttribute('data-tint'))).toEqual(['0', '1', '2', '3', '0']);
    expect(container.querySelectorAll('.co-group-strip')).toHaveLength(5);
  });
});
