// Pure: the T&T rotation sheet. Portrait: per squad `Squad A: Trampoline > Double Mini > Tumbling` with a row per athlete
// (Athlete | Club | Squad | TR DM TU SY levels, club then first name), then "Synchro only", then the synchro flights.
// A long list carries on to the next page with its heading repeated. Spec §6.
import { locationLabel, sessionLocation, sessionTitle } from '../session-names';
import { TNT_EVENT_NAME, TNT_LEVELS, rotationFor } from '../tnt-squads';
import type { TntRotationPage, TntRotationTable, Unnumbered } from './model';
import type { TntPerson, TntSessionInput } from './session-input';

/** A table row is 1 unit; a table heading plus its column header are 2.4; a page holds this many. */
export const TNT_ROTATION_PAGE_UNITS = 50;
export const TABLE_HEAD_UNITS = 2.4;
const MIN_ROWS_BEFORE_BREAK = 3;

const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

/** Club (A–Z, independents last), then first name (the person's name string starts with it). */
export const byClubThenName = (a: TntPerson, b: TntPerson): number =>
  (a.independent ? 1 : 0) - (b.independent ? 1 : 0) || cmp(a.clubName, b.clubName) || cmp(a.name, b.name) || a.id.localeCompare(b.id);

const ATHLETE_COLUMNS = ['Athlete', 'Club', 'Squad', 'TR', 'DM', 'TU', 'SY'];

const personRow = (p: TntPerson, squad: string, ix: number) => ({
  cells: [p.name, p.clubName, squad, p.levels.TR ?? '', p.levels.DM ?? '', p.levels.TU ?? '', p.levels.SY ?? ''],
  alt: ix % 2 === 1,
});

export function tntRotationPages(input: TntSessionInput): Unnumbered<TntRotationPage>[] {
  const { meet, session } = input;
  const tables: Omit<TntRotationTable, 'continued'>[] = [];
  for (const s of input.squads) {
    const heading = `Squad ${s.letter}: ${rotationFor(s.index).map((e) => TNT_EVENT_NAME[e]).join(' > ')}`;
    tables.push({ heading, columns: ATHLETE_COLUMNS, rows: [...s.athletes].sort(byClubThenName).map((p, i) => personRow(p, s.letter, i)) });
  }
  if (input.synchroOnly.length > 0) {
    tables.push({ heading: 'Synchro only', columns: ATHLETE_COLUMNS, rows: [...input.synchroOnly].sort(byClubThenName).map((p, i) => personRow(p, '–', i)) });
  }
  if (input.flights.length > 0) {
    const rows = input.flights.flatMap((f) => f.pairs.map((q, ix) => ({ cells: [ix === 0 ? `Flight ${f.name}` : '', q.names, q.clubs, q.level], alt: ix % 2 === 1 })));
    tables.push({ heading: 'Synchro flights', columns: ['Flight', 'Pair', 'Club', 'Level'], rows });
  }

  // Flow the tables onto pages, splitting a long one (never leaving fewer than a few rows behind or ahead).
  const pages: { tables: TntRotationTable[]; units: number }[] = [{ tables: [], units: 0 }];
  for (const t of tables) {
    let rows = t.rows;
    let continued = false;
    do {
      let page = pages[pages.length - 1];
      let room = Math.floor(TNT_ROTATION_PAGE_UNITS - page.units - TABLE_HEAD_UNITS);
      if (page.tables.length > 0 && room < Math.min(rows.length, MIN_ROWS_BEFORE_BREAK)) {
        page = { tables: [], units: 0 };
        pages.push(page);
        room = Math.floor(TNT_ROTATION_PAGE_UNITS - TABLE_HEAD_UNITS);
      }
      let take = Math.min(rows.length, Math.max(1, room));
      // Do not strand fewer than the minimum rows on the next page.
      const left = rows.length - take;
      if (left > 0 && left < MIN_ROWS_BEFORE_BREAK && take - (MIN_ROWS_BEFORE_BREAK - left) >= MIN_ROWS_BEFORE_BREAK) take -= MIN_ROWS_BEFORE_BREAK - left;
      page.tables.push({ ...t, rows: rows.slice(0, take), continued });
      page.units += TABLE_HEAD_UNITS + take + 0.8;
      rows = rows.slice(take);
      continued = true;
      if (rows.length > 0) pages.push({ tables: [], units: 0 });
    } while (rows.length > 0);
  }

  const time = input.competitionTime.trim();
  const title = `T&T ${sessionTitle(session)}${time ? ` · ${time}` : ''}`;
  const levels = session.levelCodes.length > 0 ? session.levelCodes : [...TNT_LEVELS];
  const subtitle = [meet.name, locationLabel(sessionLocation(session)), levels.join(', ')].filter(Boolean).join(' · ');
  return pages.map((p, i) => ({
    kind: 'tnt-rotation' as const,
    meet, title, subtitle, tables: p.tables, units: p.units,
    jump: { group: 'Rotation sheet', label: String(i + 1) },
  }));
}
