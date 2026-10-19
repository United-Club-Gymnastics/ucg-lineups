import { describe, expect, it } from 'vitest';
import { buildClubLinks, isNewLink, isOldLink, levelKeyFor, linkMeets, type ClubLinkDoc } from '../../src/lib/club-links';
import type { Session } from '../../src/lib/import/types';

const sessions: Session[] = [
  { id: 's2-red', number: 2, gym: 'Red', discipline: 'MAG', levelCodes: ['Adv'] },
  { id: 's1-green', number: 1, gym: 'Green', discipline: 'WAG', levelCodes: ['Dev', 'Int'] },
  { id: 's3-orange', number: 3, gym: 'Orange', discipline: 'TNT', levelCodes: ['NF'] },
];

function ath(o: Partial<Parameters<typeof buildClubLinks>[0][number]> & { id: string; first: string }) {
  return {
    last: 'Sample', clubId: 'club-a', independent: false, levelCode: 'Dev', levelName: 'Developmental', sessionId: 's1-green',
    apparatus: ['VT', 'UB'], competes: true, discipline: 'WAG' as const, ...o,
  };
}

const clubs = [{ id: 'club-a', name: 'Club A', token: 'tokA' }, { id: 'club-b', name: 'Club B', token: 'tokB' }, { id: 'club-c', name: 'No Token', token: '' }];

const M = { id: 'm1', name: 'Prelims', createdAt: 1000 };
const E = (x: { doc: ClubLinkDoc }) => x.doc.meets.m1;

describe('buildClubLinks', () => {
  it('builds levels per session with the level key, A-Z athletes, and no personal fields', () => {
    const [a] = buildClubLinks([
      ath({ id: 'WAG_1', first: 'Zoe' }),
      ath({ id: 'WAG_2', first: 'Ann', last: 'Zed' }),
      ath({ id: 'WAG_3', first: 'Ann', last: 'Able' }),
      ath({ id: 'WAG_4', first: 'Bea', levelCode: 'Int', levelName: 'Intermediate' }),
      ath({ id: 'MAG_5', first: 'Cy', sessionId: 's2-red', discipline: 'MAG', levelCode: 'Adv', levelName: 'Advanced', apparatus: ['FX'] }),
    ], sessions, clubs, undefined, M);
    expect(a.token).toBe('tokA');
    expect(a.doc.clubName).toBe('Club A');
    expect(E(a).sessions.map((s) => s.sessionId)).toEqual(['s1-green', 's2-red']);
    expect(E(a).sessions[0].label).toBe('Session 1 · Green');
    expect(E(a).sessions[0].levels.map((l) => l.levelKey)).toEqual(['s1-green__Dev', 's1-green__Int']);
    expect(E(a).sessions[0].levels[0].athletes.map((x) => x.id)).toEqual(['WAG_3', 'WAG_2', 'WAG_1']);
    expect(E(a).levelKeys).toEqual(['s1-green__Dev', 's1-green__Int', 's2-red__Adv']);
    expect(Object.keys(E(a).sessions[0].levels[0].athletes[0]).sort()).toEqual(['apparatus', 'first', 'id', 'last']);
    expect(levelKeyFor('s1-green', 'Dev')).toBe('s1-green__Dev');
  });

  it('leaves out non-competing, removed and independent athletes and those without a known session', () => {
    const [a] = buildClubLinks([
      ath({ id: 'WAG_1', first: 'Keep' }),
      ath({ id: 'WAG_2', first: 'Scratched', competes: false, apparatus: [] }),
      ath({ id: 'WAG_3', first: 'Gone', removed: true }),
      ath({ id: 'WAG_4', first: 'Solo', independent: true }),
      ath({ id: 'WAG_5', first: 'Lost', sessionId: '' }),
    ], sessions, clubs, undefined, M);
    expect(E(a).sessions).toHaveLength(1);
    expect(E(a).sessions[0].levels[0].athletes.map((x) => x.first)).toEqual(['Keep']);
  });

  it('lists T&T sessions without levels and keeps them out of levelKeys', () => {
    const [a] = buildClubLinks([
      ath({ id: 'WAG_1', first: 'Ann' }),
      ath({ id: 'TNT_1', first: 'Tia', sessionId: 's3-orange', discipline: 'TNT', levelCode: 'NF', apparatus: ['TR'] }),
    ], sessions, clubs, undefined, M);
    const tnt = E(a).sessions.find((s) => s.discipline === 'TNT')!;
    expect(tnt.levels).toEqual([]);
    expect(tnt.label).toBe('Session 3 · Orange');
    expect(E(a).levelKeys).toEqual(['s1-green__Dev']);
  });

  it('keeps clubs separate, publishes clubs with no athletes as empty, and skips clubs without a token', () => {
    const out = buildClubLinks([ath({ id: 'WAG_1', first: 'Ann' }), ath({ id: 'WAG_9', first: 'Bo', clubId: 'club-b' })], sessions, clubs, undefined, M);
    expect(out.every((x) => Object.keys(x.doc.meets).join() === 'm1')).toBe(true);
    expect(out.map((x) => x.token)).toEqual(['tokA', 'tokB']);
    expect(E(out[1]).sessions[0].levels[0].athletes.map((x) => x.id)).toEqual(['WAG_9']);
    expect(buildClubLinks([], sessions, [clubs[1]], undefined, M)[0].doc).toEqual({ clubId: 'club-b', clubName: 'Club B', meets: { m1: { meetName: 'Prelims', createdAt: 1000, sessions: [], levelKeys: [] } } });
  });

  it('accepts a single club (regenerated token)', () => {
    const out = buildClubLinks([ath({ id: 'WAG_1', first: 'Ann' })], sessions, [{ id: 'club-a', name: 'Club A', token: 'newTok' }]);
    expect(out.map((x) => x.token)).toEqual(['newTok']);
  });
});

describe('one link across meets', () => {
  const entry = (name: string, createdAt: number, extra: object = {}) => ({ meetName: name, createdAt, sessions: [], levelKeys: [], ...extra });

  it('the meet list is newest first and leaves out archived meets', () => {
    const doc: ClubLinkDoc = {
      clubId: 'c', clubName: 'C',
      meets: { prelims: entry('Prelims', 100), finals: entry('Finals', 200), old: entry('Old', 50, { archived: true }), same: entry('Alpha', 200) },
    };
    expect(linkMeets(doc).map((m) => m.meetId)).toEqual(['same', 'finals', 'prelims']); // equal dates: name A-Z
  });

  it('tells the new shape from the old per-meet one', () => {
    expect(isNewLink({ clubId: 'c', clubName: 'C', meets: {} })).toBe(true);
    expect(isOldLink({ meetId: 'm1', clubId: 'c', clubName: 'C', sessions: [], levelKeys: [] })).toBe(true);
    expect(isNewLink({ meetId: 'm1', sessions: [] })).toBe(false);
    expect(isOldLink({ clubId: 'c', meets: {} })).toBe(false);
    expect(isOldLink({ clubId: 'c' })).toBe(false);
    expect(isNewLink(null)).toBe(false);
  });

  it('building a second meet gives a doc that merges next to the first: same token, different entries', () => {
    const rows = [ath({ id: 'WAG_1', first: 'Ann' })];
    const prelims = buildClubLinks(rows, sessions, clubs, undefined, M)[0];
    const finals = buildClubLinks(rows, sessions, clubs, undefined, { id: 'm2', name: 'Finals', createdAt: 2000 })[0];
    expect(finals.token).toBe(prelims.token);
    expect(Object.keys(finals.doc.meets)).toEqual(['m2']);
    expect(linkMeets({ ...prelims.doc, meets: { ...prelims.doc.meets, ...finals.doc.meets } }).map((m) => m.entry.meetName)).toEqual(['Finals', 'Prelims']);
  });
});
