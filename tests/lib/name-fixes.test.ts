import { describe, expect, it } from 'vitest';
import {
  applyNameFixes, applyNameFixesToAthletes, clubsAffectedByChange, compactName, countAffected, makeNameFixer, parseNameFixes,
  removeNameFix, suggestNameFixes, suggestSplit, upsertNameFix, validateNameFix, type NameFix,
} from '../../src/lib/name-fixes';
import { placePairs } from '../../src/lib/synchro-flights';
import { buildTntRoster } from '../../src/lib/tnt-data';
import type { SynchroPair } from '../../src/lib/synchro-source';

const fixes: NameFix[] = [
  { field: 'last', from: 'MurrayMetzger', to: 'Murray Metzger' },
  { field: 'first', from: 'MaryAnn', to: 'Mary Ann' },
];

describe('applyNameFixes', () => {
  it('fixes the last name, the first name, or both', () => {
    expect(applyNameFixes('Ada', 'MurrayMetzger', fixes)).toEqual({ first: 'Ada', last: 'Murray Metzger' });
    expect(applyNameFixes('MaryAnn', 'Test', fixes)).toEqual({ first: 'Mary Ann', last: 'Test' });
    expect(applyNameFixes('MaryAnn', 'MurrayMetzger', fixes)).toEqual({ first: 'Mary Ann', last: 'Murray Metzger' });
  });
  it('matches on the compact form, so other capitals, spaces and hyphens in the export still match', () => {
    expect(applyNameFixes('Ada', 'Murraymetzger', fixes).last).toBe('Murray Metzger');
    expect(applyNameFixes('Ada', 'MURRAY METZGER', fixes).last).toBe('Murray Metzger');
    expect(applyNameFixes('Ada', 'Murray-Metzger', fixes).last).toBe('Murray Metzger');
  });
  it('a first-name fix does not touch a last name and vice versa', () => {
    expect(applyNameFixes('MurrayMetzger', 'MaryAnn', fixes)).toEqual({ first: 'MurrayMetzger', last: 'MaryAnn' });
  });
  it('leaves names without a fix, and empty names, alone', () => {
    expect(applyNameFixes('Ada', 'Test', fixes)).toEqual({ first: 'Ada', last: 'Test' });
    expect(applyNameFixes('', '', fixes)).toEqual({ first: '', last: '' });
    expect(applyNameFixes('Ada', 'Test', [])).toEqual({ first: 'Ada', last: 'Test' });
  });
  it('makeNameFixer works one field at a time', () => {
    const fix = makeNameFixer(fixes);
    expect(fix('last', 'MurrayMetzger')).toBe('Murray Metzger');
    expect(fix('first', 'MurrayMetzger')).toBe('MurrayMetzger');
  });
});

describe('applyNameFixesToAthletes', () => {
  const list = [
    { id: 'WAG_a', first: 'Ada', last: 'MurrayMetzger', clubId: 'c1' },
    { id: 'WAG_b', first: 'Bea', last: 'Test', clubId: 'c2' },
  ];
  it('changes only the display names: ids, club and every other field are kept, untouched athletes are the same objects', () => {
    const out = applyNameFixesToAthletes(list, fixes);
    expect(out[0]).toEqual({ id: 'WAG_a', first: 'Ada', last: 'Murray Metzger', clubId: 'c1' });
    expect(out[1]).toBe(list[1]);
    expect(list[0].last).toBe('MurrayMetzger');
  });
  it('returns the same list when there are no fixes', () => {
    expect(applyNameFixesToAthletes(list, [])).toBe(list);
  });
});

describe('suggestSplit', () => {
  it('splits an inner capital after a lowercase letter', () => {
    expect(suggestSplit('MurrayMetzger')).toBe('Murray Metzger');
    expect(suggestSplit('StPierre')).toBe('St Pierre');
    expect(suggestSplit('UltotPerez')).toBe('Ultot Perez');
    expect(suggestSplit('MaryAnn')).toBe('Mary Ann');
  });
  it('keeps prefixes that are right as written', () => {
    for (const n of ['McDonald', 'MacArthur', 'DeAngelo', 'LeBlanc', 'DiMaggio', 'VanDyke', 'VonTrapp', 'DaSilva', 'DuBois', 'LaRue', 'LoPresti', "O'Brien", 'DeLaCruz']) {
      expect(suggestSplit(n)).toBeNull();
    }
  });
  it('still splits a second join after a kept prefix', () => {
    expect(suggestSplit('McDonaldSmith')).toBe('McDonald Smith');
    expect(suggestSplit('VanDykeJones')).toBe('VanDyke Jones');
  });
  it('ignores names with nothing to split', () => {
    for (const n of ['Smith', 'Murray Metzger', 'Murray-Metzger', 'DJones', 'ADA', '']) expect(suggestSplit(n)).toBeNull();
  });
  it('looks at each word on its own', () => {
    expect(suggestSplit('Anne MurrayMetzger')).toBe('Anne Murray Metzger');
  });
});

describe('suggestNameFixes', () => {
  const people = [
    { first: 'Ada', last: 'MurrayMetzger' },
    { first: 'Bea', last: 'MurrayMetzger' },
    { first: 'Cy', last: 'StPierre' },
    { first: 'MaryAnn', last: 'Test' },
    { first: 'Dee', last: 'McDonald' },
    { first: 'Eve', last: 'DeAngelo' },
    { first: 'Fay', last: 'Murraymetzger' },
    { first: 'Gus', last: 'StPierre', removed: true },
    { first: 'Hal', last: 'Plain' },
  ];
  it('lists unique last names and first names with the number of athletes, last names first', () => {
    expect(suggestNameFixes(people)).toEqual([
      { field: 'last', from: 'MurrayMetzger', to: 'Murray Metzger', count: 2 },
      { field: 'last', from: 'StPierre', to: 'St Pierre', count: 1 },
      { field: 'first', from: 'MaryAnn', to: 'Mary Ann', count: 1 },
    ]);
  });
  it('leaves out prefixes that are right and removed athletes, and counts the same name once per athlete', () => {
    const s = suggestNameFixes(people);
    expect(s.map((x) => x.from)).not.toContain('McDonald');
    expect(s.find((x) => x.from === 'StPierre')!.count).toBe(1);
  });
  it('skips names that already have a fix, and nothing is applied by suggesting', () => {
    const before = JSON.stringify(people);
    expect(suggestNameFixes(people, [{ field: 'last', from: 'MurrayMetzger', to: 'Murray Metzger' }]).map((x) => x.from)).toEqual(['StPierre', 'MaryAnn']);
    expect(JSON.stringify(people)).toBe(before);
  });
});

describe('fix list helpers', () => {
  it('upsert replaces a fix for the same field and compact name; remove deletes it', () => {
    const a = upsertNameFix(fixes, { field: 'last', from: 'Murraymetzger', to: 'Murray-Metzger' });
    expect(a).toHaveLength(2);
    expect(a.find((f) => f.field === 'last')!.to).toBe('Murray-Metzger');
    expect(removeNameFix(a, { field: 'last', from: 'MurrayMetzger' })).toEqual([fixes[1]]);
    expect(removeNameFix(fixes, { field: 'first', from: 'MurrayMetzger' })).toEqual(fixes);
  });
  it('the same name can have a first and a last fix', () => {
    expect(upsertNameFix(fixes, { field: 'first', from: 'MurrayMetzger', to: 'Murray Metzger' })).toHaveLength(3);
  });
  it('validate: needs both names, the same letters, and a real change', () => {
    expect(validateNameFix({ field: 'last', from: 'StPierre', to: 'St Pierre' })).toBeNull();
    expect(validateNameFix({ field: 'last', from: 'StPierre', to: 'St. Pierre' })).toBeNull();
    expect(validateNameFix({ field: 'last', from: '', to: 'x' })).toMatch(/as it appears/);
    expect(validateNameFix({ field: 'last', from: 'StPierre', to: ' ' })).toMatch(/how the name/);
    expect(validateNameFix({ field: 'last', from: 'StPierre', to: 'Saint Pierre' })).toMatch(/same letters/);
    expect(validateNameFix({ field: 'last', from: 'StPierre', to: 'StPierre' })).toMatch(/already/);
  });
  it('parse reads the stored doc defensively', () => {
    expect(parseNameFixes(null)).toEqual([]);
    expect(parseNameFixes({ fixes: 'x' })).toEqual([]);
    expect(parseNameFixes({ fixes: [{ field: 'last', from: ' StPierre ', to: 'St  Pierre' }, { field: 'middle', from: 'a', to: 'b' }, { field: 'first', from: 5, to: 'x' }, null, { field: 'first', from: '', to: 'x' }] }))
      .toEqual([{ field: 'last', from: 'StPierre', to: 'St Pierre' }]);
  });
  it('compactName ignores case, spaces, punctuation and accents', () => {
    expect(compactName('St. Pierre')).toBe('stpierre');
    expect(compactName('José')).toBe('jose');
  });
});

describe('counts and affected clubs', () => {
  const a = [
    { first: 'Ada', last: 'MurrayMetzger', clubId: 'c1' },
    { first: 'Bea', last: 'MurrayMetzger', clubId: 'c2' },
    { first: 'Cy', last: 'MurrayMetzger', clubId: 'c2', removed: true },
    { first: 'MurrayMetzger', last: 'Test', clubId: 'c3' },
  ];
  it('counts non-removed athletes whose chosen field matches', () => {
    expect(countAffected(a, { field: 'last', from: 'MurrayMetzger' })).toBe(2);
    expect(countAffected(a, { field: 'first', from: 'MurrayMetzger' })).toBe(1);
  });
  it('lists the clubs whose displayed names change between two sets of fixes', () => {
    expect(clubsAffectedByChange(a, [], fixes).sort()).toEqual(['c1', 'c2']);
    expect(clubsAffectedByChange(a, fixes, fixes)).toEqual([]);
    expect(clubsAffectedByChange(a, fixes, [])).toEqual(['c1', 'c2']);
  });
});

describe('name fixes and the synchro roster (matching is unchanged; only the shown names differ)', () => {
  const stored = (id: string, first: string, last: string, competes = true, apparatus = ['TR', 'SY']) => ({
    id, discipline: 'TNT' as const, first, last, clubId: 'alpha', clubName: 'Alpha Gymnastics', independent: false, levelCode: 'IF', levelName: 'IF',
    sessionId: 's1-green', apparatus: competes ? apparatus : [], competes,
  });
  const athletes = applyNameFixesToAthletes([stored('TNT_1', 'Ada', 'MurrayMetzger'), stored('TNT_2', 'Bo', 'Test'), stored('TNT_3', 'Cy', 'StPierre', false)], [
    { field: 'last', from: 'MurrayMetzger', to: 'Murray Metzger' }, { field: 'last', from: 'StPierre', to: 'St Pierre' },
  ]);
  const pair = (name1: string, name2: string): SynchroPair => ({ id: 'p1', level: 'IF', a1: '', name1, club1: 'Alpha Gymnastics', a2: '', name2, club2: 'Alpha Gymnastics', createdAt: null, source: '' });

  it('a matched athlete shows the fixed name, and the Synchro tool text with spaces stripped still matches', () => {
    const [p] = placePairs([pair('Ada MurrayMetzger', 'Bo Test')], buildTntRoster(athletes), {}, ['s1-green']);
    expect([p.athlete1, p.athlete2]).toEqual(['TNT_1', 'TNT_2']);
    expect(p.name1).toBe('Ada Murray Metzger');
    expect(p.sessionId).toBe('s1-green');
  });
  it('an unmatched (scratched) athlete is looked up by compact name and shown fixed in the problem text', () => {
    const [p] = placePairs([pair('Ada MurrayMetzger', 'Cy StPierre')], buildTntRoster(athletes), {}, ['s1-green']);
    expect(p.name2).toBe('Cy St Pierre');
    expect(p.problems).toEqual(['Cy St Pierre is scratched from every event']);
  });
});
