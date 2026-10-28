import { describe, expect, it } from 'vitest';
import { levelOrderRank, sortLevelCodes } from '../../src/lib/level-order';

describe('level order (Julia 2026-10-28)', () => {
  it('WAG: Xcel Silver, Gold, Platinum, Diamond, Sapphire, then Level 9, then UCG Infinity', () => {
    expect(sortLevelCodes(['Inf', 'XD', 'L9', 'XS', 'XP', 'XG', 'XSA'])).toEqual(['XS', 'XG', 'XP', 'XD', 'XSA', 'L9', 'Inf']);
  });

  it('MAG: Developmental, Intermediate, Advanced (not alphabetical)', () => {
    expect(sortLevelCodes(['Int', 'Adv', 'Dev'])).toEqual(['Dev', 'Int', 'Adv']);
  });

  it('reads full level names when there is no short code', () => {
    expect(sortLevelCodes(['UCG Infinity', 'Xcel Sapphire', 'Xcel Gold', 'Xcel Silver'])).toEqual(['Xcel Silver', 'Xcel Gold', 'Xcel Sapphire', 'UCG Infinity']);
    expect(sortLevelCodes(['UCG Advanced(GymAct)', 'UCG Intermediate', 'Developmental'])).toEqual(['Developmental', 'UCG Intermediate', 'UCG Advanced(GymAct)']);
    expect(levelOrderRank('Intermediate Flyers')).toBe(levelOrderRank('IF'));
  });

  it('unknown levels go last, A–Z; the input is not changed', () => {
    const codes = ['Zeta', 'Dev', 'Alpha'];
    expect(sortLevelCodes(codes)).toEqual(['Dev', 'Alpha', 'Zeta']);
    expect(codes).toEqual(['Zeta', 'Dev', 'Alpha']);
  });
});

describe('stored sessions read their levels in competitive order (meets imported before the fix were A–Z)', () => {
  it('toStoredSession sorts', async () => {
    const { toStoredSession } = await import('../../src/lib/data/store');
    expect(toStoredSession('s1-green', { name: 'Session 1', location: 'Green', discipline: 'MAG', levelCodes: ['Adv', 'Dev', 'Int'] }).levelCodes).toEqual(['Dev', 'Int', 'Adv']);
    expect(toStoredSession('s2-red', { name: 'Session 2', location: 'Red', discipline: 'WAG' }).levelCodes).toEqual([]);
  });
});
