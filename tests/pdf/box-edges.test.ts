import { describe, expect, it } from 'vitest';
import { sessionPages } from '../../src/lib/pdf/collate';
import { HEAVY_BOX_STYLE } from '../../src/lib/pdf/model';
import { edgeRuns, renderPdf, type BoxCell } from '../../src/lib/pdf/render';
import { buildArtisticSessionInput } from '../../src/lib/pdf/session-input';
import { MEET, magFixture } from './fixtures';

const cell = (x: number, y: number, w: number, h: number, heavy = false): BoxCell => ({ x, y, w, h, heavy });

describe('heavy box edges are drawn once', () => {
  it('two stacked cells share one horizontal edge, not two', () => {
    const lines = edgeRuns([cell(0, 0, 50, 20, true), cell(0, 20, 50, 20, true)], true);
    expect(lines.map((l) => l.at)).toEqual([0, 20, 40]);
    expect(lines.find((l) => l.at === 20)!.runs).toEqual([{ a: 0, b: 50, heavy: true }]);
  });
  it('side-by-side heavy cells make one continuous run on top and share their vertical edge', () => {
    const cells = [cell(0, 0, 50, 20, true), cell(50, 0, 50, 20, true)];
    expect(edgeRuns(cells, true).find((l) => l.at === 0)!.runs).toEqual([{ a: 0, b: 100, heavy: true }]);
    expect(edgeRuns(cells, false).map((l) => l.at)).toEqual([0, 50, 100]);
  });
  it('an edge between a heavy and a thin cell is heavy once; a thin neighbour keeps a separate thin run', () => {
    const cells = [cell(0, 0, 50, 20), cell(50, 0, 50, 20, true)];
    expect(edgeRuns(cells, true).find((l) => l.at === 0)!.runs).toEqual([{ a: 0, b: 50, heavy: false }, { a: 50, b: 100, heavy: true }]);
    expect(edgeRuns(cells, false).find((l) => l.at === 50)!.runs).toEqual([{ a: 0, b: 20, heavy: true }]);
  });
  it('the default style is one of the two variants and a page renders in both', () => {
    expect(['A', 'B']).toContain(HEAVY_BOX_STYLE);
    const mag = magFixture();
    const input = buildArtisticSessionInput({ session: mag.session, athletes: mag.athletes, ordersByClub: mag.ordersByClub, stored: mag.stored, meet: MEET });
    const pages = sessionPages('scorecards', { type: 'artistic', id: mag.session.id, number: 1, gym: 'Orange', input }, 'x').slice(0, 2);
    for (const style of ['A', 'B'] as const) expect(renderPdf(pages, 'x', false, style).output('arraybuffer').byteLength).toBeGreaterThan(1000);
  });
});
