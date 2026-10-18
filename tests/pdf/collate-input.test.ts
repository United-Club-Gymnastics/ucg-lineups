import { describe, expect, it } from 'vitest';
import type { LevelOrder } from '../../src/lib/club-order-model';
import { allSessionsFileName, collate, rotationOrder, scorecardOrder, sessionFileName, sessionPages, type SessionExportInput } from '../../src/lib/pdf/collate';
import { artisticScorecardPages } from '../../src/lib/pdf/artistic-scorecards-content';
import { buildArtisticSessionInput, buildTntSessionInput } from '../../src/lib/pdf/session-input';
import { toStoredTntDoc } from '../../src/lib/tnt-data';
import { MEET, magFixture, tntFixture, wagInfinityFixture } from './fixtures';

const keys = (xs: { number: number; gym: string }[]) => xs.map((x) => `${x.number}${x.gym[0]}`);
const sessions = [
  { number: 2, gym: 'Orange' }, { number: 1, gym: 'Purple' }, { number: 1, gym: 'Green' }, { number: 3, gym: 'Green' }, { number: 1, gym: 'Orange' }, { number: 2, gym: 'Red' },
];

describe('collation and file names', () => {
  it('scorecards by gym (Green, Red, Yellow, Orange, Purple) then session number', () => {
    expect(keys(scorecardOrder(sessions))).toEqual(['1G', '3G', '2R', '1O', '2O', '1P']);
  });
  it('rotation sheets by session number, then gym', () => {
    expect(keys(rotationOrder(sessions))).toEqual(['1G', '1O', '1P', '2R', '2O', '3G']);
  });
  it('a custom gym order from settings/meet is honoured', () => {
    expect(keys(scorecardOrder(sessions, ['Purple', 'Orange', 'Green']))).toEqual(['1P', '1O', '2O', '1G', '3G', '2R']);
    expect(keys(rotationOrder(sessions, ['Purple', 'Orange', 'Green']))).toEqual(['1P', '1O', '1G', '2O', '2R', '3G']);
  });
  it('file names', () => {
    expect(sessionFileName('scorecards', { number: 1, gym: 'Green' })).toBe('Session 1 - Green - Scorecards.pdf');
    expect(sessionFileName('rotation', { number: 1, gym: 'Green' })).toBe('Session 1 - Green - Rotation Sheet.pdf');
    expect(allSessionsFileName('scorecards', 'pdf')).toBe('All Sessions - Scorecards.pdf');
    expect(allSessionsFileName('rotation', 'pdf')).toBe('All Sessions - Rotation Sheets.pdf');
    expect(allSessionsFileName('scorecards', 'zip')).toBe('All Sessions - Scorecards.zip');
    expect(allSessionsFileName('rotation', 'zip')).toBe('All Sessions - Rotation Sheets.zip');
  });
});

describe('whole sessions', () => {
  const mag = magFixture();
  const wag = wagInfinityFixture();
  const tnt = tntFixture();
  const all: SessionExportInput[] = [
    { type: 'artistic', id: 'a', number: 1, gym: 'Orange', input: buildArtisticSessionInput({ ...mag, meet: MEET }) },
    { type: 'artistic', id: 'b', number: 2, gym: 'Green', input: buildArtisticSessionInput({ ...wag, meet: MEET }) },
    { type: 'tnt', id: 'c', number: 1, gym: 'Purple', input: buildTntSessionInput({ session: tnt.session, athletes: tnt.athletes, stored: tnt.stored, pairs: tnt.pairs, meet: MEET }) },
  ];

  it('collates scorecards by gym and rotation sheets by number, T&T included', () => {
    expect(collate('scorecards', all, undefined, 'x').map((d) => d.file)).toEqual(['Session 2 - Green - Scorecards.pdf', 'Session 1 - Orange - Scorecards.pdf', 'Session 1 - Purple - Scorecards.pdf']);
    expect(collate('rotation', all, undefined, 'x').map((d) => d.file)).toEqual(['Session 1 - Orange - Rotation Sheet.pdf', 'Session 1 - Purple - Rotation Sheet.pdf', 'Session 2 - Green - Rotation Sheet.pdf']);
  });

  it('T&T scorecards are followed by that session\'s synchro sheets; every page is numbered within its session', () => {
    const pages = sessionPages('scorecards', all[2], 'Oct 18, 2026');
    const kinds = pages.map((p) => p.kind);
    expect(kinds.slice(0, 3)).toEqual(['tnt-scorecard', 'tnt-scorecard', 'tnt-scorecard']);
    expect(kinds.filter((k) => k === 'synchro').length).toBeGreaterThan(0);
    expect(kinds.lastIndexOf('tnt-scorecard')).toBeLessThan(kinds.indexOf('synchro'));
    expect(pages.map((p) => p.page.n)).toEqual(pages.map((_, i) => i + 1));
    expect(new Set(pages.map((p) => p.page.of))).toEqual(new Set([pages.length]));
    expect(pages[0].printedOn).toBe('Oct 18, 2026');
  });

  it('artistic sheets: one rotation page per session, many scorecard pages', () => {
    expect(sessionPages('rotation', all[0], 'x')).toHaveLength(1);
    expect(sessionPages('scorecards', all[0], 'x').length).toBeGreaterThan(10);
  });
});

describe('buildArtisticSessionInput', () => {
  it('lists each club group in the club\'s saved order for that apparatus, groups in squad order', () => {
    const f = magFixture();
    const ids = f.athletes.filter((a) => a.clubName === 'Zeta Athletic Center').map((a) => a.id); // 5 athletes, one level
    const reversed = [...ids].reverse();
    const orders: Record<string, Record<string, LevelOrder>> = {
      'zeta-athletic-center': { 's1-orange__Adv': { groups: [ids], sections: { FX: [reversed], PH: [ids] }, splitDecided: true } },
    };
    const input = buildArtisticSessionInput({ ...f, ordersByClub: orders, meet: MEET });
    const squad = input.squads.find((s) => s.groups.some((g) => g.clubName === 'Zeta Athletic Center'))!;
    const g = squad.groups.find((x) => x.clubName === 'Zeta Athletic Center')!;
    expect(g.order.FX.map((a) => a.id)).toEqual(reversed);
    expect(g.order.PH.map((a) => a.id)).toEqual(ids);
    // the scorecard page shows that order
    const page = artisticScorecardPages(input).find((p) => p.band.code === 'FX' && p.band.squad === squad.letter)!;
    const names = page.rows.filter((r) => r.club === 'Zeta Athletic Center').map((r) => r.athlete);
    expect(names).toEqual(reversed.map((id) => { const a = f.athletes.find((x) => x.id === id)!; return `${a.first} ${a.last}`; }));
  });

  it('default order is A-Z by first name; level, then club within a squad; independents after clubs', () => {
    const f = magFixture();
    const input = buildArtisticSessionInput({ ...f, meet: MEET });
    for (const s of input.squads) {
      const levels = s.groups.map((g) => ['Dev', 'Int', 'Adv'].indexOf(g.levelCode));
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
      for (const g of s.groups) {
        const fx = g.order.FX.map((a) => a.name);
        expect(fx).toEqual([...fx].sort((a, b) => a.localeCompare(b)));
      }
    }
    expect(input.athleteCount).toBe(f.athletes.length);
    expect(input.unplaced).toBe(0);
    expect(input.noSquads).toBe(false);
    expect(input.schedule.competition).toBe('8:00 AM');
  });

  it('an athlete appears only on apparatus they are entered on (independent specialists)', () => {
    const f = magFixture();
    const input = buildArtisticSessionInput({ ...f, meet: MEET });
    const vt = input.squads.flatMap((s) => s.groups).filter((g) => g.independent && g.levelCode === 'Dev');
    expect(vt).toHaveLength(1);
    expect(Object.entries(vt[0].order).filter(([, v]) => v.length > 0).map(([k]) => k)).toEqual(['VT']);
    expect(vt[0].clubName).toBe('Independent Community Athlete');
  });

  it('nothing saved: no squads and everyone unplaced; unplaced athletes are counted', () => {
    const f = magFixture();
    const none = buildArtisticSessionInput({ ...f, stored: null, meet: MEET });
    expect(none.noSquads).toBe(true);
    expect(none.unplaced).toBe(f.athletes.length);
    expect(none.squads.flatMap((s) => s.groups)).toEqual([]);
    // drop one squad's cards from the plan: those athletes are unplaced
    const trimmed = { ...f.stored, squads: f.stored.squads.map((s, i) => (i === 0 ? { ...s, cards: [] } : s)) };
    const part = buildArtisticSessionInput({ ...f, stored: trimmed, meet: MEET });
    expect(part.unplaced).toBeGreaterThan(0);
    expect(part.squads[0].groups).toEqual([]);
  });

  it('a stored plan whose pattern is byes gives 8 WAG squads', () => {
    const w = wagInfinityFixture();
    const input = buildArtisticSessionInput({ ...w, meet: MEET });
    expect(input.pattern).toBe('byes');
    expect(input.squads).toHaveLength(8);
  });
});

describe('buildTntSessionInput', () => {
  const t = tntFixture();
  const base = { session: t.session, athletes: t.athletes, meet: MEET };

  it('squads, per-event orders (only athletes entered, default HF > IF > NF), synchro-only and the time', () => {
    const input = buildTntSessionInput({ ...base, stored: t.stored, pairs: t.pairs });
    expect(input.squads).toHaveLength(3);
    for (const s of input.squads) {
      expect(s.order.TR.every((p) => p.levels.TR)).toBe(true);
      const ranks = s.order.TR.map((p) => ['NF', 'IF', 'HF'].indexOf(p.levels.TR!));
      expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    }
    expect(input.synchroOnly.map((p) => p.clubName)).toEqual(['Bounce University', 'Bounce University']);
    expect(input.competitionTime).toBe('Thursday 7:30 AM');
    expect(input.unplaced).toBe(0);
  });

  it('a saved custom order is used', () => {
    const squadA = t.stored.squads[0].athleteIds;
    const onTr = squadA.filter((id) => t.athletes.find((a) => a.id === id)!.tnt!.TR);
    const reversed = [...onTr].reverse();
    const stored = toStoredTntDoc({ squads: t.stored.squads.map((s) => s.athleteIds), tray: [], orders: { A_TR: reversed }, flights: [], pairsReadAt: null });
    const input = buildTntSessionInput({ ...base, stored, pairs: t.pairs });
    expect(input.squads[0].order.TR.map((p) => p.id)).toEqual(reversed);
  });

  it('flights: default split when none saved; saved flights keep their order; a pair no longer read drops out; unreadable Synchro tool is flagged', () => {
    const def = buildTntSessionInput({ ...base, stored: t.stored, pairs: t.pairs });
    expect(def.flights.map((f) => f.name)).toEqual(['A', 'B']);
    expect(def.flights.flatMap((f) => f.pairs).map((p) => p.id).sort()).toEqual(t.pairs.map((p) => p.id).sort());
    const saved = toStoredTntDoc({ squads: t.stored.squads.map((s) => s.athleteIds), tray: [], orders: {}, flights: [{ name: 'A', pairIds: ['pair3', 'gone', 'pair1'] }, { name: 'B', pairIds: ['pair2'] }], pairsReadAt: null });
    const kept = buildTntSessionInput({ ...base, stored: saved, pairs: t.pairs });
    expect(kept.flights.map((f) => f.pairs.map((p) => p.id))).toEqual([['pair3', 'pair1'], ['pair2']]);
    const none = buildTntSessionInput({ ...base, stored: t.stored, pairs: null });
    expect(none.pairsMissing).toBe(true);
    expect(none.flights).toEqual([]);
  });

  it('nothing saved: noSquads and everyone unplaced', () => {
    const input = buildTntSessionInput({ ...base, stored: null, pairs: t.pairs });
    expect(input.noSquads).toBe(true);
    expect(input.unplaced).toBe(t.athletes.filter((a) => a.apparatus.some((c) => c !== 'SY')).length);
    expect(input.squads.every((s) => s.athletes.length === 0)).toBe(true);
  });
});
