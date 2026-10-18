// Pure: turn the stored data (athletes, clubs' saved orders, the host's squads) into the roster-level input the PDF
// content modules read. Nothing here knows about pages. Spec §6.
import type { LinkAthlete } from '../club-links';
import { resolveLevel, type LevelOrder } from '../club-order-model';
import type { StoredAthlete } from '../import/diff';
import type { Session } from '../import/types';
import { type FlightPair, type Flight, defaultFlights, pairClubs, pairNames } from '../synchro-flights';
import { planFromCards } from '../squad-balance';
import { restoreSquads } from '../squad-restore';
import { buildSessionData, fullName, type ArtisticSession, type Schedule, type StoredSquadDoc, EMPTY_SCHEDULE } from '../squad-data';
import { squadLetter as artisticLetter, squadCountFor, apparatusCodes, type RotationPattern } from '../rotation';
import { TNT_EVENTS, orderFor, squadLetter as tntLetter, type TntEvent, type TntCode } from '../tnt-squads';
import { buildTntSessionData, type StoredTntDoc } from '../tnt-data';
import { restoreTntSquads } from '../tnt-squads';
import type { Meet } from './model';

export interface SessionMeta {
  number: number;
  gym: string;
  levelCodes: string[];
}

// --- artistic -----------------------------------------------------------------------------------------

export interface ExportAthlete {
  id: string;
  name: string;
}

export interface ArtisticGroupInput {
  key: string;
  independent: boolean;
  /** Full club name (for an independent: as the export has it, e.g. "Independent Community Athlete"). */
  clubName: string;
  levelCode: string;
  groupIndex: number;
  /** Groups the club has at this level (the rotation sheet adds "· Group B" when above 1). */
  groupCount: number;
  /** Athletes of this card on each apparatus, in the club's competing order for that apparatus. */
  order: Record<string, ExportAthlete[]>;
  routines: Record<string, number>;
}

export interface ArtisticSquadInput {
  index: number;
  letter: string;
  /** Club groups in squad order: level, then club, independents after clubs. */
  groups: ArtisticGroupInput[];
}

export interface ArtisticSessionInput {
  meet: Meet;
  session: SessionMeta & { discipline: 'MAG' | 'WAG' };
  pattern: RotationPattern;
  schedule: Schedule;
  /** Athletes competing in the session. */
  athleteCount: number;
  squads: ArtisticSquadInput[];
  /** Athletes in the session who are in no squad (a warning, never a block). */
  unplaced: number;
  /** No squads have been saved for this session. */
  noSquads: boolean;
}

export function buildArtisticSessionInput(input: {
  session: ArtisticSession;
  athletes: StoredAthlete[];
  ordersByClub: Record<string, Record<string, LevelOrder>>;
  stored: StoredSquadDoc | null;
  meet: Meet;
}): ArtisticSessionInput {
  const { session, meet, stored } = input;
  const d = buildSessionData(session, input.athletes, input.ordersByClub);
  const pattern: RotationPattern = stored?.pattern ?? 'one';
  const count = squadCountFor(pattern, session.discipline);
  const meta = { number: session.number, gym: session.gym, levelCodes: session.levelCodes, discipline: session.discipline };
  const empty: ArtisticSquadInput[] = Array.from({ length: count }, (_, i) => ({ index: i, letter: artisticLetter(i), groups: [] }));
  if (!stored) {
    return { meet, session: meta, pattern, schedule: EMPTY_SCHEDULE, athleteCount: d.athleteCount, squads: empty, unplaced: d.athleteCount, noSquads: true };
  }

  const ctx = {
    discipline: session.discipline,
    apparatusOf: (id: string) => d.athletes.get(id)?.apparatus ?? [],
    levelRank: d.levelRank, clubLabel: d.clubLabel, independentLabel: d.independentLabel,
  };
  const restored = restoreSquads({ stored, discipline: session.discipline, sessionRegs: d.regs, savedGroups: d.savedGroups, ctx, describe: d.describe, levelName: (l) => d.levelNames.get(l) ?? l });
  const plan = planFromCards(restored.cards, stored.pattern, session.discipline, ctx);
  const byKey = new Map(restored.cards.map((c) => [c.key, c]));

  // Each club level's resolved orders (what the club page shows), computed once.
  const resolved = new Map<string, ReturnType<typeof resolveLevel>>();
  const levelOf = (clubId: string, levelCode: string) => {
    const k = `${clubId}\u0000${levelCode}`;
    let r = resolved.get(k);
    if (!r) {
      const roster: LinkAthlete[] = [...d.athletes.values()]
        .filter((a) => !a.independent && a.clubId === clubId && a.levelCode === levelCode)
        .map((a) => ({ id: a.id, first: a.first, last: a.last, apparatus: [...a.apparatus] }));
      r = resolveLevel(session.discipline, roster, input.ordersByClub[clubId]?.[`${session.id}__${levelCode.replace(/\//g, '-')}`]);
      resolved.set(k, r);
    }
    return r;
  };
  const codes = apparatusCodes(session.discipline);
  const person = (id: string): ExportAthlete => { const a = d.athletes.get(id)!; return { id, name: fullName(a) }; };

  const squads = plan.map((slot, i): ArtisticSquadInput => ({
    index: i,
    letter: artisticLetter(i),
    groups: slot.cardKeys.map((k) => byKey.get(k)).filter((c): c is NonNullable<typeof c> => !!c).map((card): ArtisticGroupInput => {
      const mine = new Set(card.regIds);
      const order: Record<string, ExportAthlete[]> = {};
      for (const code of codes) {
        const section = card.independentRegId
          ? [card.independentRegId]
          : levelOf(card.clubId, card.levelId).sectionsBy[code]?.[card.groupIndex] ?? [];
        order[code] = section.filter((id) => mine.has(id) && d.athletes.get(id)?.apparatus.includes(code)).map(person);
      }
      const first = d.athletes.get(card.regIds[0]);
      return {
        key: card.key,
        independent: !!card.independentRegId,
        clubName: card.independentRegId ? first?.clubName || 'Independent' : d.clubLabel(card.clubId),
        levelCode: card.levelId,
        groupIndex: card.groupIndex,
        groupCount: card.groupCount,
        order,
        routines: { ...card.routines },
      };
    }),
  }));
  const inSquad = new Set(plan.flatMap((s) => s.cardKeys.flatMap((k) => byKey.get(k)?.regIds ?? [])));
  const unplacedIds = [...d.athletes.keys()].filter((id) => !inSquad.has(id));
  return { meet, session: meta, pattern: stored.pattern, schedule: stored.schedule, athleteCount: d.athleteCount, squads, unplaced: unplacedIds.length, noSquads: false };
}

// --- T&T ----------------------------------------------------------------------------------------------

export interface TntPerson {
  id: string;
  name: string;
  clubName: string;
  independent: boolean;
  levels: Partial<Record<TntCode, string>>;
}

export interface TntSquadInput {
  index: number;
  letter: string;
  /** The squad's athletes (TR/DM/TU entrants), for the rotation sheet. */
  athletes: TntPerson[];
  /** Per event: only athletes entered on it, in the saved (or default) order. */
  order: Record<TntEvent, TntPerson[]>;
}

export interface TntPairInput {
  id: string;
  names: string;
  clubs: string;
  level: string;
}

export interface TntSessionInput {
  meet: Meet;
  session: SessionMeta;
  /** Competition time to show on the rotation sheet ('' = none). */
  competitionTime: string;
  squads: TntSquadInput[];
  synchroOnly: TntPerson[];
  flights: { name: string; pairs: TntPairInput[] }[];
  /** Athletes in squads-eligible entries who are in no squad (warning). */
  unplaced: number;
  noSquads: boolean;
  /** The Synchro tool could not be read, so no flights are included (warning). */
  pairsMissing: boolean;
}

export function buildTntSessionInput(input: {
  session: Session & { competitionTime?: string };
  athletes: StoredAthlete[];
  stored: StoredTntDoc | null;
  /** Pairs read from the Synchro tool and matched to this session; null when it could not be read. */
  pairs: FlightPair[] | null;
  meet: Meet;
}): TntSessionInput {
  const { session, stored, meet } = input;
  const data = buildTntSessionData(session, input.athletes);
  const restored = restoreTntSquads({ stored, eligible: data.squadAthletes, describe: data.describe });
  const person = (id: string): TntPerson => {
    const a = data.byId.get(id)!;
    return { id, name: `${a.first} ${a.last}`.trim(), clubName: a.clubName, independent: a.independent, levels: { ...a.levels } };
  };
  const squads = restored.squads.map((ids, i): TntSquadInput => ({
    index: i,
    letter: tntLetter(i),
    athletes: ids.map(person),
    order: Object.fromEntries(TNT_EVENTS.map((e) => [e, orderFor(ids, e, stored?.orders[`${tntLetter(i)}_${e}`], data.byId).map(person)])) as Record<TntEvent, TntPerson[]>,
  }));

  let flights: TntSessionInput['flights'] = [];
  if (input.pairs) {
    const byId = new Map(input.pairs.map((p) => [p.id, p]));
    const saved: Flight[] = stored && stored.flights.length > 0 ? stored.flights : defaultFlights(input.pairs);
    flights = saved
      .map((f) => ({
        name: f.name,
        pairs: f.pairIds.map((id) => byId.get(id)).filter((p): p is FlightPair => !!p).map((p) => ({
          id: p.id, names: pairNames(p), clubs: pairClubs(p), level: p.level,
        })),
      }))
      .filter((f) => f.pairs.length > 0);
  }
  return {
    meet,
    session: { number: session.number, gym: session.gym, levelCodes: session.levelCodes },
    competitionTime: session.competitionTime ?? '',
    squads,
    synchroOnly: data.synchroOnly.map((a) => person(a.id)),
    flights,
    unplaced: restored.tray.length,
    noSquads: !stored,
    pairsMissing: input.pairs === null,
  };
}
