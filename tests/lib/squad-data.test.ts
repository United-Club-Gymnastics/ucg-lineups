import { describe, expect, it } from 'vitest';
import type { LevelOrder } from '../../src/lib/club-order-model';
import type { StoredAthlete } from '../../src/lib/import/diff';
import type { Session } from '../../src/lib/import/types';
import {
  buildSessionData, isArtisticSession, parseSquadDoc, sessionTitle, sortSessionsByGym, toStoredSquadDoc, type ArtisticSession,
} from '../../src/lib/squad-data';

const session: ArtisticSession = { id: 's1-orange', number: 1, gym: 'Orange', discipline: 'WAG', levelCodes: ['XS', 'XP', 'Inf'] };

let n = 0;
const ath = (over: Partial<StoredAthlete>): StoredAthlete => ({
  id: `WAG_club-a_f${++n}`, discipline: 'WAG', first: `F${String(n).padStart(2, '0')}`, last: 'Test', clubId: 'club-a', clubName: 'Club A',
  independent: false, levelCode: 'XS', levelName: 'Silver XS', sessionId: 's1-orange', apparatus: ['VT', 'UB', 'BB', 'FX'], competes: true, ...over,
});
const many = (k: number, over: Partial<StoredAthlete>) => Array.from({ length: k }, () => ath(over));

describe('sortSessionsByGym', () => {
  it('orders by gym (Green, Red, Yellow, Orange, Purple) then session number', () => {
    const ss = [
      { number: 2, gym: 'Orange' }, { number: 1, gym: 'Purple' }, { number: 3, gym: 'Green' }, { number: 1, gym: 'Orange' },
      { number: 1, gym: 'Green' }, { number: 2, gym: 'Red' }, { number: 1, gym: 'Yellow' },
    ];
    expect(sortSessionsByGym(ss).map((s) => `${s.gym}${s.number}`)).toEqual(['Green1', 'Green3', 'Red2', 'Yellow1', 'Orange1', 'Orange2', 'Purple1']);
  });
  it('honours a custom gym order and puts unknown gyms last', () => {
    const ss = [{ number: 1, gym: 'Blue' }, { number: 1, gym: 'Red' }, { number: 1, gym: 'Green' }];
    expect(sortSessionsByGym(ss, ['Red', 'Green']).map((s) => s.gym)).toEqual(['Red', 'Green', 'Blue']);
  });
  it('titles and artistic filter', () => {
    expect(sessionTitle(session)).toBe('Session 1 – Orange');
    const t: Session = { ...session, discipline: 'TNT' };
    expect([session, t].filter(isArtisticSession)).toHaveLength(1);
  });
});

describe('buildSessionData', () => {
  it('counts only this session, competing, non-removed athletes with an apparatus', () => {
    const athletes = [
      ...many(3, {}),
      ath({ sessionId: 's2-orange' }), ath({ removed: true }), ath({ competes: false }), ath({ apparatus: [] }),
    ];
    const d = buildSessionData(session, athletes, {});
    expect(d.athleteCount).toBe(3);
    expect(d.cards).toHaveLength(1);
    expect(d.cards[0].regIds).toHaveLength(3);
  });

  it('splits an over-cap level A-Z by default and follows the saved split', () => {
    const athletes = many(14, {});
    const def = buildSessionData(session, athletes, {});
    expect(def.cards).toHaveLength(2);
    expect(def.cards.flatMap((c) => c.regIds)).toEqual(athletes.map((a) => a.id)); // A-Z by first name, contiguous
    const saved: LevelOrder = { groups: [athletes.slice(0, 3).map((a) => a.id), athletes.slice(3).map((a) => a.id)], sections: {}, splitDecided: true };
    const d = buildSessionData(session, athletes, { 'club-a': { 's1-orange__XS': saved } });
    expect(d.cards.map((c) => c.regIds.length).sort((a, b) => a - b)).toEqual([3, 11]);
    expect(d.savedGroups).toHaveLength(1);
  });

  it('reconciles a saved split with the current roster (new athletes join a group, removed ones drop out)', () => {
    const athletes = many(4, {});
    const [a, b, c] = athletes.map((x) => x.id);
    const saved: LevelOrder = { groups: [[a, 'gone'], [b]], sections: {}, splitDecided: true };
    const d = buildSessionData(session, athletes, { 'club-a': { 's1-orange__XS': saved } });
    expect(d.cards.flatMap((x) => x.regIds).sort()).toEqual(athletes.map((x) => x.id).sort());
    expect(d.cards.some((x) => x.regIds.includes(c))).toBe(true);
  });

  it('independents are one card each and are never given a club', () => {
    const athletes = [ath({ independent: true, clubId: 'independent-x', clubName: 'Independent X' }), ath({ independent: true, clubId: 'independent-x', clubName: 'Independent X' })];
    const d = buildSessionData(session, athletes, {});
    expect(d.cards).toHaveLength(2);
    expect(d.cards.every((c) => c.independentRegId && c.clubId === '')).toBe(true);
    expect(d.stillAz + d.needSplit).toBe(0);
    expect(d.independentLabel(athletes[0].id)).toBe(`${athletes[0].first} Test`);
  });

  it('counts clubs still A-Z and clubs that need a split', () => {
    const athletes = [
      ...many(3, { clubId: 'club-a', clubName: 'Club A' }), // default
      ...many(14, { clubId: 'club-b', clubName: 'Club B' }), // needs a split
      ...many(3, { clubId: 'club-c', clubName: 'Club C' }), // will be custom
    ];
    const cIds = athletes.filter((a) => a.clubId === 'club-c').map((a) => a.id);
    const custom: LevelOrder = { groups: [[...cIds].reverse()], sections: { VT: [[...cIds].reverse()] }, splitDecided: false };
    const d = buildSessionData(session, athletes, { 'club-c': { 's1-orange__XS': custom } });
    expect({ stillAz: d.stillAz, needSplit: d.needSplit }).toEqual({ stillAz: 1, needSplit: 1 });
  });

  it('level rank follows the session level order; labels fall back to ids', () => {
    const d = buildSessionData(session, many(1, { levelCode: 'Inf', levelName: 'Infinity' }), {});
    expect(d.levelRank('XS')).toBeLessThan(d.levelRank('Inf'));
    expect(d.levelRank('zz')).toBe(3);
    expect(d.levelNames.get('Inf')).toBe('Infinity');
    expect(d.clubLabel('nope')).toBe('nope');
  });
});

describe('stored squad doc', () => {
  const sch = { stretch: '8:00', warmups: '8:15', competition: '9:00' };
  it('round-trips athletes per card with no nested arrays', () => {
    const d = buildSessionData(session, many(3, {}), {});
    const [c] = d.cards;
    const unplaced = d.cards.length;
    const plan = [{ name: 'A', cardKeys: [c.key] }, { name: 'B', cardKeys: [] }];
    const doc = toStoredSquadDoc('parallel', plan, d.cards, sch);
    expect(doc.squads[0].cards).toEqual([{ key: c.key, athleteIds: c.regIds }]);
    expect(doc.trayAthleteIds).toEqual(d.cards.slice(1).flatMap((x) => x.regIds));
    expect(unplaced).toBeGreaterThan(0);
    expect(doc.squads.every((s) => s.cards.every((k) => Array.isArray(k.athleteIds) && !Array.isArray(k)))).toBe(true);
    expect(parseSquadDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });
  it('reads a doc saved with the removed byes pattern as parallel and remembers it for the notice', () => {
    const raw = { pattern: 'byes', trayAthleteIds: [], schedule: sch, squads: [{ name: 'A', cards: [] }] };
    expect(parseSquadDoc(raw)).toMatchObject({ pattern: 'parallel', removedByes: true });
    expect(parseSquadDoc({ ...raw, pattern: 'parallel' })).not.toHaveProperty('removedByes');
  });
  it('keeps any pattern id as saved (the discipline decides later whether it is known)', () => {
    const raw = { pattern: 'wag-7', trayAthleteIds: [], schedule: sch, squads: [{ name: 'A', cards: [] }] };
    expect(parseSquadDoc(raw)).toMatchObject({ pattern: 'wag-7' });
    expect(parseSquadDoc({ ...raw, pattern: 'something-new' })).toMatchObject({ pattern: 'something-new' });
    expect(parseSquadDoc({ ...raw, pattern: 7 })).toBeNull();
  });
  it('treats junk and the old cardKeys shape as nothing saved', () => {
    expect(parseSquadDoc(null)).toBeNull();
    expect(parseSquadDoc({ pattern: 'three' })).toBeNull();
    expect(parseSquadDoc({ pattern: 'one', squads: [{ name: 'A', cardKeys: ['k'] }], schedule: sch })).toBeNull();
  });
  it('fills defaults for partial docs', () => {
    expect(parseSquadDoc({ pattern: 'one', trayAthleteIds: ['x', 1], squads: [{ cards: [{ key: 'k', athleteIds: ['a', 2] }, 7] }, 3] })).toEqual({
      pattern: 'one', trayAthleteIds: ['x'], schedule: { stretch: '', warmups: '', competition: '' },
      squads: [{ name: 'Squad 1', cards: [{ key: 'k', athleteIds: ['a'] }, { key: '', athleteIds: [] }] }, { name: 'Squad 2', cards: [] }],
    });
  });
});
