// Invented data for the Clubs & email tests (no real clubs or people).
import type { SavedLevel } from '../../src/lib/club-overview';
import type { StoredAthlete } from '../../src/lib/import/diff';
import type { Session } from '../../src/lib/import/types';
import type { StoredClub } from '../../src/lib/data/plan';

export const SESSIONS: Session[] = [
  { id: 's1-orange', number: 1, gym: 'Orange', discipline: 'WAG', levelCodes: ['XS', 'XP'] },
  { id: 's2-red', number: 2, gym: 'Red', discipline: 'MAG', levelCodes: ['Dev', 'Int'] },
  { id: 's3-purple', number: 3, gym: 'Purple', discipline: 'TNT', levelCodes: ['NF'] },
];

const WAG_APP = ['VT', 'UB', 'BB', 'FX'];
const MAG_APP = ['FX', 'PH', 'SR', 'VT', 'PB', 'HB'];
const NAMES = ['Ada', 'Bea', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lou', 'Max', 'Nia', 'Oz'];

export function athletes(clubId: string, clubName: string, sessionId: string, discipline: 'WAG' | 'MAG' | 'TNT', levelCode: string, n: number, apparatus?: string[]): StoredAthlete[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${discipline}_${clubId}_${levelCode}_${NAMES[i]}`.toLowerCase(),
    discipline,
    first: NAMES[i],
    last: 'Test',
    clubId,
    clubName,
    independent: false,
    levelCode,
    levelName: levelCode === 'XS' ? 'Silver XS' : levelCode === 'XP' ? 'Platinum XP' : levelCode,
    sessionId,
    apparatus: apparatus ?? (discipline === 'WAG' ? WAG_APP : discipline === 'MAG' ? MAG_APP : ['TR', 'DM', 'TU']),
    competes: true,
  }));
}

export const ATHLETES: StoredAthlete[] = [
  ...athletes('alpha-gymnastics', 'Alpha Gymnastics', 's1-orange', 'WAG', 'XS', 3),
  ...athletes('alpha-gymnastics', 'Alpha Gymnastics', 's2-red', 'MAG', 'Dev', 3),
  ...athletes('bravo-academy', 'Bravo Academy', 's1-orange', 'WAG', 'XP', 14),
  ...athletes('bravo-academy', 'Bravo Academy', 's2-red', 'MAG', 'Int', 2),
  ...athletes('charlie-club', 'Charlie Club', 's3-purple', 'TNT', 'NF', 2),
  ...athletes('delta-gym', 'Delta Gym', 's1-orange', 'WAG', 'XS', 3),
  ...athletes('echo-elite', 'Echo Elite', 's1-orange', 'WAG', 'XS', 1, ['VT']),
];

export const CLUBS: StoredClub[] = [
  { id: 'alpha-gymnastics', name: 'Alpha Gymnastics', emails: ['coach@alpha.example'], token: 'tokAlpha' },
  { id: 'bravo-academy', name: 'Bravo Academy', emails: ['bravo@example.org', 'second@example.org'], token: 'tokBravo' },
  { id: 'charlie-club', name: 'Charlie Club', emails: ['c@charlie.example'], token: 'tokCharlie' },
  { id: 'delta-gym', name: 'Delta Gym', emails: [], token: 'tokDelta' },
  { id: 'echo-elite', name: 'Echo Elite', emails: ['echo@example.com'], token: 'tokEcho' },
];

/** Alpha has reversed the Vault order of its MAG Dev group, so that session is "Order set". */
export const SAVED: Record<string, Record<string, SavedLevel>> = {
  'alpha-gymnastics': {
    's2-red__Dev': {
      order: {
        groups: [ATHLETES.filter((a) => a.sessionId === 's2-red' && a.clubId === 'alpha-gymnastics').map((a) => a.id)],
        sections: { VT: [ATHLETES.filter((a) => a.sessionId === 's2-red' && a.clubId === 'alpha-gymnastics').map((a) => a.id).reverse()] },
        splitDecided: false,
      },
      updatedAt: Date.UTC(2026, 9, 18, 22, 40),
    },
  },
};
