// Pure: a pair's `A & B` as two lines.
/** `A & B` into its two names (one line when there is no ampersand). */
export const splitPair = (names: string): [string, string] => {
  const i = names.indexOf(' & ');
  return i < 0 ? [names, ''] : [names.slice(0, i), names.slice(i + 3)];
};
