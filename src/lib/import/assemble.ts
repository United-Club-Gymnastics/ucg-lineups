import type { Detected } from './detect';
import type { ImportInput } from './normalize';

/** Combine detected sheets (one per export kind; the last file of a kind wins) into normalize input. */
export function assembleInput(found: Detected[]): ImportInput | null {
  const by = new Map(found.map((f) => [f.kind, f.sheet.rows]));
  const athletes = by.get('athletes');
  if (!athletes) return null;
  return { athletes, wag: by.get('wag'), mag: by.get('mag'), tnt: by.get('tnt'), clubEmails: by.get('clubEmails') };
}
