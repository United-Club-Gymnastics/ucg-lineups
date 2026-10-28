// Pure: the competitive order of levels (Julia 2026-10-28), lowest first. Every list of a session's levels (squads, scorecards,
// rotation sheets, club pages) follows it.
//   WAG: Xcel Silver, Gold, Platinum, Diamond, Sapphire, (Level N), UCG Infinity.
//   MAG: Developmental, Intermediate, Advanced.   T&T: New, Intermediate, High Flyers.
// Level 9 is not in Julia's list: it sits after Sapphire and before Infinity (flagged to her). Unknown levels go last, A–Z.

/** Codes ScoreFlippers uses (its "level short name") and the ones this app gives when there is none. */
const BY_CODE: Record<string, number> = {
  XB: 0, XS: 1, XG: 2, XP: 3, XD: 4, XSA: 5, XSP: 5,
  INF: 90,
  DEV: 100, INT: 101, ADV: 102,
  NF: 200, IF: 201, HF: 202,
};

/** Fallback by wording, for a code that is a full level name ("Xcel Sapphire", "UCG Intermediate"). Order matters: the flyers first. */
const BY_TEXT: [RegExp, number][] = [
  [/new\s*flyer/i, 200], [/intermediate\s*flyer/i, 201], [/high\s*flyer/i, 202],
  [/bronze/i, 0], [/silver/i, 1], [/gold/i, 2], [/platinum/i, 3], [/diamond/i, 4], [/sapphire/i, 5],
  [/infinity|open\s*scoring|^open$/i, 90],
  [/developmental/i, 100], [/intermediate/i, 101], [/advanced/i, 102],
];

const UNKNOWN = 1000;

/** Rank of a level code (or name); lower competes first in every list. Level N ranks 10 + N (after Sapphire, before Infinity). */
export function levelOrderRank(code: string): number {
  const c = code.trim();
  const known = BY_CODE[c.toUpperCase()];
  if (known !== undefined) return known;
  const level = /^(?:L|Level\s*)(\d{1,2})$/i.exec(c);
  if (level) return 10 + Number(level[1]);
  return BY_TEXT.find(([re]) => re.test(c))?.[1] ?? UNKNOWN;
}

/** The codes in competitive order; unknown ones last, A–Z. Does not change the input. */
export const sortLevelCodes = (codes: readonly string[]): string[] =>
  [...codes].sort((a, b) => levelOrderRank(a) - levelOrderRank(b) || a.localeCompare(b));
