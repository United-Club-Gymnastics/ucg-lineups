// Invented data for the PDF tests and the sample-PDF script. Nobody here is a real athlete or club.
import { apparatusLookup } from '../../src/lib/competition-order';
import type { LevelOrder } from '../../src/lib/club-order-model';
import type { StoredAthlete } from '../../src/lib/import/diff';
import type { Session } from '../../src/lib/import/types';
import type { RotationPattern } from '../../src/lib/rotation';
import { autoBalance } from '../../src/lib/squad-balance';
import { buildSessionData, toStoredSquadDoc, type ArtisticSession, type StoredSquadDoc } from '../../src/lib/squad-data';
import type { FlightPair } from '../../src/lib/synchro-flights';
import { autoBalance as tntAutoBalance } from '../../src/lib/tnt-squads';
import { buildTntSessionData, toStoredTntDoc, type StoredTntDoc } from '../../src/lib/tnt-data';

const FIRST = ['Ada', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jo', 'Kit', 'Lena', 'Max', 'Nia', 'Oz', 'Pia', 'Quin', 'Rae', 'Sol', 'Tess', 'Uma', 'Vic', 'Wren', 'Xan', 'Yara', 'Zed'];
let counter = 0;
export const resetNames = () => { counter = 0; };
const nextName = () => { const i = counter++; return { first: FIRST[i % FIRST.length], last: `Invented${String(i + 1).padStart(2, '0')}` }; };

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export interface Spec { club: string; level: string; n: number; apparatus?: string[]; independent?: boolean }

const LEVEL_NAMES: Record<string, string> = { Dev: 'Developmental', Int: 'Intermediate', Adv: 'Advanced', XS: 'Silver XS', XP: 'Platinum XP', XD: 'Diamond XD', Inf: 'Infinity' };

export function artisticAthletes(session: Session, specs: Spec[]): StoredAthlete[] {
  const all = session.discipline === 'MAG' ? ['FX', 'PH', 'SR', 'VT', 'PB', 'HB'] : ['VT', 'UB', 'BB', 'FX'];
  const out: StoredAthlete[] = [];
  for (const s of specs) {
    for (let i = 0; i < s.n; i++) {
      const { first, last } = nextName();
      const independent = !!s.independent;
      const id = `${session.discipline}_${slug(s.club)}_${slug(first + last)}`;
      out.push({
        id, discipline: session.discipline, first, last, clubId: slug(s.club), clubName: s.club, independent,
        levelCode: s.level, levelName: LEVEL_NAMES[s.level] ?? s.level, sessionId: session.id, apparatus: s.apparatus ?? all, competes: true,
      });
    }
  }
  return out;
}

export interface ArtisticFixture {
  session: ArtisticSession;
  athletes: StoredAthlete[];
  ordersByClub: Record<string, Record<string, LevelOrder>>;
  stored: StoredSquadDoc;
}

/** Auto-balanced and saved, as the host would leave it. */
export function placeArtistic(session: ArtisticSession, athletes: StoredAthlete[], pattern: RotationPattern, ordersByClub: ArtisticFixture['ordersByClub'] = {}): ArtisticFixture {
  const d = buildSessionData(session, athletes, ordersByClub);
  const ctx = { discipline: session.discipline, apparatusOf: apparatusLookup(d.regs), levelRank: d.levelRank, clubLabel: d.clubLabel, independentLabel: d.independentLabel };
  const plan = autoBalance({ ...ctx, cards: d.cards, pattern });
  const stored = toStoredSquadDoc(pattern, plan, d.cards, { stretch: '7:30 AM', warmups: '7:50 AM', competition: '8:00 AM' });
  return { session, athletes, ordersByClub, stored };
}

export const MEET = { name: 'UCG Nationals 2026 (sample)', date: 'October 22–25, 2026' };

export function magFixture(): ArtisticFixture {
  resetNames();
  const session: ArtisticSession = { id: 's1-orange', number: 1, gym: 'Orange', discipline: 'MAG', levelCodes: ['Dev', 'Int', 'Adv'] };
  const athletes = artisticAthletes(session, [
    { club: 'Alpha Gymnastics Club', level: 'Dev', n: 9 },
    { club: 'Alpha Gymnastics Club', level: 'Adv', n: 4 },
    { club: 'Beta Flyers', level: 'Dev', n: 7 },
    { club: 'Beta Flyers', level: 'Int', n: 3 },
    { club: 'Gamma University Club', level: 'Int', n: 8 },
    { club: 'Delta Tumblers', level: 'Int', n: 5 },
    { club: 'Delta Tumblers', level: 'Adv', n: 6 },
    { club: 'Epsilon Gymnastics', level: 'Dev', n: 6 },
    { club: 'Zeta Athletic Center', level: 'Adv', n: 5 },
    { club: 'Independent Community Athlete', level: 'Int', n: 2, independent: true, apparatus: ['FX', 'HB'] },
    { club: 'Independent Community Athlete', level: 'Dev', n: 1, independent: true, apparatus: ['VT'] },
  ]);
  return placeArtistic(session, athletes, 'one');
}

export function wagInfinityFixture(): ArtisticFixture {
  resetNames();
  const session: ArtisticSession = { id: 's2-green', number: 2, gym: 'Green', discipline: 'WAG', levelCodes: ['XS', 'XP', 'XD', 'Inf'] };
  const athletes = artisticAthletes(session, [
    { club: 'Alpha Gymnastics Club', level: 'XS', n: 6 },
    { club: 'Beta Flyers', level: 'XP', n: 7 },
    { club: 'Beta Flyers', level: 'XD', n: 3 },
    { club: 'Gamma University Club', level: 'XS', n: 5 },
    { club: 'Gamma University Club', level: 'Inf', n: 5 },
    { club: 'Delta Tumblers', level: 'Inf', n: 3 },
    { club: 'Epsilon Gymnastics', level: 'XD', n: 4 },
  ]);
  return placeArtistic(session, athletes, 'byes');
}

// --- T&T ----------------------------------------------------------------------------------------------------------

export interface TntFixture {
  session: Session & { competitionTime?: string };
  athletes: StoredAthlete[];
  stored: StoredTntDoc;
  pairs: FlightPair[];
}

export function tntFixture(): TntFixture {
  resetNames();
  const session: Session & { competitionTime?: string } = { id: 's1-purple', number: 1, gym: 'Purple', discipline: 'TNT', levelCodes: ['NF', 'IF', 'HF'], competitionTime: 'Thursday 7:30 AM' };
  const mk = (club: string, n: number, tnt: Record<string, string>, independent = false): StoredAthlete[] => Array.from({ length: n }, () => {
    const { first, last } = nextName();
    const levels = tnt as StoredAthlete['tnt'];
    return {
      id: `TNT_${slug(club)}_${slug(first + last)}`, discipline: 'TNT', first, last, clubId: slug(club), clubName: club, independent,
      levelCode: Object.values(tnt)[0], levelName: Object.values(tnt)[0], sessionId: session.id, apparatus: Object.keys(tnt), tnt: levels, competes: true,
    };
  });
  const athletes = [
    ...mk('Flipping Falcons', 6, { TR: 'NF', DM: 'NF', TU: 'NF' }),
    ...mk('Flipping Falcons', 4, { TR: 'IF', DM: 'IF', TU: 'IF', SY: 'IF' }),
    ...mk('Jump Club Alpha', 5, { TR: 'IF', DM: 'IF' }),
    ...mk('Jump Club Alpha', 3, { TR: 'HF', DM: 'HF', TU: 'HF' }),
    ...mk('Bounce University', 6, { TR: 'NF', TU: 'NF' }),
    ...mk('Bounce University', 2, { SY: 'NF' }),
    ...mk('Independent Community Athlete', 2, { TR: 'HF', DM: 'HF' }, true),
    ...mk('Springboard Gymnastics', 7, { TR: 'IF', DM: 'IF', TU: 'IF' }),
  ];
  const d = buildTntSessionData(session, athletes);
  const squads = tntAutoBalance(d.squadAthletes);
  const stored = toStoredTntDoc({ squads, tray: [], orders: {}, flights: [], pairsReadAt: null });
  const sy = athletes.filter((a) => a.apparatus.includes('SY'));
  const pairs: FlightPair[] = [];
  const level = (a: StoredAthlete) => a.tnt!.SY!;
  for (let i = 0; i + 1 < sy.length; i += 2) {
    pairs.push({
      id: `pair${i / 2 + 1}`, level: level(sy[i]), name1: `${sy[i].first} ${sy[i].last}`, name2: `${sy[i + 1].first} ${sy[i + 1].last}`,
      club1: sy[i].clubName, club2: sy[i + 1].clubName, athlete1: sy[i].id, athlete2: sy[i + 1].id, check: false, problems: [],
    });
  }
  return { session, athletes, stored, pairs };
}
