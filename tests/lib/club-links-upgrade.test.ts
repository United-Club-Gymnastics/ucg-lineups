import { describe, expect, it } from 'vitest';
import type { ClubLinkDoc, OldClubLinkDoc } from '../../src/lib/club-links';
import { pickClubTokens, planUpgrade, type OldLink, type UpgradeInput, type UpgradeMeet } from '../../src/lib/club-links-upgrade';

const MEETS: UpgradeMeet[] = [
  { id: 'prelims', name: 'Prelims', createdAt: 1000, archived: false },
  { id: 'finals', name: 'Finals', createdAt: 2000, archived: false },
  { id: 'old', name: 'Old meet', createdAt: 10, archived: true },
];
const old = (token: string, meetId: string, clubId: string, keys: string[] = ['s1__Dev']): OldLink => ({
  token,
  data: { meetId, clubId, clubName: clubId.toUpperCase(), sessions: [{ marker: `${clubId}-${meetId}` }] as never, levelKeys: keys } as OldClubLinkDoc,
});
function input(over: Partial<UpgradeInput> = {}): UpgradeInput {
  return {
    oldLinks: [old('tA-p', 'prelims', 'a'), old('tA-f', 'finals', 'a', ['s1__Dev', 's1__Int']), old('tB-p', 'prelims', 'b')],
    newLinks: {}, meets: MEETS, clubTokens: {},
    oldOrders: { 'tA-p': ['s1__Dev'], 'tA-f': ['s1__Dev', 's1__Int'], 'tB-p': [] },
    existingOrders: {},
    ...over,
  };
}

describe('pickClubTokens', () => {
  it('reuses the token of the club\'s newest meet', () => {
    expect(pickClubTokens(input().oldLinks, MEETS, {})).toEqual({ a: 'tA-f', b: 'tB-p' });
  });
  it('an existing clubTokens entry wins (a re-run keeps the same token)', () => {
    expect(pickClubTokens(input().oldLinks, MEETS, { a: 'tA-p' })).toEqual({ a: 'tA-p', b: 'tB-p' });
  });
});

describe('planUpgrade', () => {
  it('previews: one token per club, every order copied to the new path, combined links, other old links deleted', () => {
    const plan = planUpgrade(input());
    expect(plan.newTokens).toEqual([{ clubId: 'a', token: 'tA-f' }, { clubId: 'b', token: 'tB-p' }]);
    expect(plan.orderCopies).toEqual([
      { fromToken: 'tA-f', toToken: 'tA-f', meetId: 'finals', levelKey: 's1__Dev' },
      { fromToken: 'tA-f', toToken: 'tA-f', meetId: 'finals', levelKey: 's1__Int' },
      { fromToken: 'tA-p', toToken: 'tA-f', meetId: 'prelims', levelKey: 's1__Dev' },
    ]);
    expect(plan.deleteLinks).toEqual(['tA-p']); // the token reused as the combined link is overwritten, not deleted
    expect(plan.links.map((l) => l.token)).toEqual(['tA-f', 'tB-p']);
    const a = plan.links[0].doc;
    expect(a).toMatchObject({ clubId: 'a', clubName: 'A' });
    expect(Object.keys(a.meets).sort()).toEqual(['finals', 'prelims']);
    expect(a.meets.finals).toMatchObject({ meetName: 'Finals', createdAt: 2000, levelKeys: ['s1__Dev', 's1__Int'] });
    expect(a.meets.prelims.sessions).toEqual([{ marker: 'a-prelims' }]); // the roster as the old link had it
    expect('meetId' in a).toBe(false);
    expect(plan.counts).toEqual({ clubs: 2, oldLinks: 3, meets: 2, ordersToCopy: 3, ordersAlreadyThere: 0, tokensReused: 0, tokensNew: 2, linksToDelete: 1 });
  });

  it('is idempotent: orders already at the new path are not copied again, and an existing token is reused', () => {
    const plan = planUpgrade(input({
      clubTokens: { a: 'tA-f', b: 'tB-p' },
      existingOrders: { 'tA-f|finals': ['s1__Dev', 's1__Int'], 'tA-f|prelims': ['s1__Dev'] },
    }));
    expect(plan.orderCopies).toEqual([]);
    expect(plan.newTokens).toEqual([]);
    expect(plan.counts).toMatchObject({ ordersToCopy: 0, ordersAlreadyThere: 3, tokensReused: 2, tokensNew: 0 });
  });

  it('after a full run there are no old links, so there is nothing to do', () => {
    const done: Record<string, ClubLinkDoc> = { 'tA-f': { clubId: 'a', clubName: 'A', meets: {} } };
    const plan = planUpgrade(input({ oldLinks: [], newLinks: done, clubTokens: { a: 'tA-f' } }));
    expect(plan).toMatchObject({ newTokens: [], orderCopies: [], links: [], deleteLinks: [] });
    expect(plan.counts.clubs).toBe(0);
  });

  it('a re-run after a part-way failure keeps the meets already in the combined link and finishes the rest', () => {
    // First run wrote clubTokens and the combined link at tA-f, then stopped before deleting tA-p.
    const partial: ClubLinkDoc = { clubId: 'a', clubName: 'A', meets: { finals: { meetName: 'Finals', createdAt: 2000, sessions: [], levelKeys: ['fresh'] } } };
    const plan = planUpgrade(input({
      oldLinks: [old('tA-p', 'prelims', 'a')], newLinks: { 'tA-f': partial }, clubTokens: { a: 'tA-f' },
      oldOrders: { 'tA-p': ['s1__Dev'] }, existingOrders: { 'tA-f|prelims': ['s1__Dev'] },
    }));
    expect(plan.deleteLinks).toEqual(['tA-p']);
    expect(plan.orderCopies).toEqual([]);
    expect(Object.keys(plan.links[0].doc.meets).sort()).toEqual(['finals', 'prelims']);
    expect(plan.links[0].doc.meets.finals.levelKeys).toEqual(['fresh']); // the fresher published entry is kept
  });

  it('an archived meet\'s orders still move, but it is not listed in the combined link', () => {
    const plan = planUpgrade(input({ oldLinks: [old('tA-o', 'old', 'a'), old('tA-f', 'finals', 'a')], oldOrders: { 'tA-o': ['s1__Dev'], 'tA-f': [] } }));
    expect(plan.orderCopies).toEqual([{ fromToken: 'tA-o', toToken: 'tA-f', meetId: 'old', levelKey: 's1__Dev' }]);
    expect(Object.keys(plan.links[0].doc.meets)).toEqual(['finals']);
    expect(plan.deleteLinks).toEqual(['tA-o']);
  });

  it('a link for a meet that no longer exists is left alone and reported', () => {
    const plan = planUpgrade(input({ oldLinks: [old('tA-g', 'ghost', 'a'), old('tA-f', 'finals', 'a')], oldOrders: { 'tA-g': ['x'], 'tA-f': [] } }));
    expect(plan.skipped).toEqual([{ token: 'tA-g', meetId: 'ghost' }]);
    expect(plan.deleteLinks).toEqual([]);
    expect(plan.orderCopies).toEqual([]);
  });

  it('a club whose clubTokens token is neither old token keeps it; both old links are deleted', () => {
    const plan = planUpgrade(input({ oldLinks: [old('tA-p', 'prelims', 'a'), old('tA-f', 'finals', 'a')], clubTokens: { a: 'chosen' }, oldOrders: { 'tA-p': ['k'], 'tA-f': ['k'] } }));
    expect(plan.links[0].token).toBe('chosen');
    expect(plan.deleteLinks.sort()).toEqual(['tA-f', 'tA-p']);
    expect(plan.orderCopies.map((c) => c.toToken)).toEqual(['chosen', 'chosen']);
  });
});
