// Pure path helpers: everything meet-specific lives under `meets/{meetId}/…`. Only clubLinks and clubOrders stay top-level
// (the club page has only a token), and each clubLink carries its `meetId`.

/** A meet id is a non-empty single path segment. */
export function assertMeetId(meetId: string): string {
  if (typeof meetId !== 'string' || meetId.length === 0 || meetId.includes('/')) throw new Error(`Invalid meet id: "${String(meetId)}"`);
  return meetId;
}

export interface MeetPaths {
  /** `meets/{id}`: `{ name, createdAt, archived? }`. */
  root: string;
  /** `meets/{id}/settings/meet`: the only publicly readable document under a meet. */
  settings: string;
  athletes: string;
  athlete: (id: string) => string;
  clubs: string;
  club: (id: string) => string;
  sessions: string;
  session: (id: string) => string;
  squads: string;
  squad: (id: string) => string;
  /** `meets/{id}/synchroSessions/main`. */
  synchro: string;
  emailLog: string;
  emailSettings: string;
  /** `meets/{id}/nameFixes/main`: `{ fixes: [{ field, from, to }], updatedAt }`. Admin-only (never in the public settings/meet). */
  nameFixes: string;
}

export function meetPaths(meetId: string): MeetPaths {
  const root = `meets/${assertMeetId(meetId)}`;
  return {
    root,
    settings: `${root}/settings/meet`,
    athletes: `${root}/athletes`,
    athlete: (id) => `${root}/athletes/${id}`,
    clubs: `${root}/clubs`,
    club: (id) => `${root}/clubs/${id}`,
    sessions: `${root}/sessions`,
    session: (id) => `${root}/sessions/${id}`,
    squads: `${root}/squads`,
    squad: (id) => `${root}/squads/${id}`,
    synchro: `${root}/synchroSessions/main`,
    emailLog: `${root}/emailLog`,
    emailSettings: `${root}/emailSettings/main`,
    nameFixes: `${root}/nameFixes/main`,
  };
}

/** Lower-case, dash-separated, ASCII; empty names become "meet". */
export function slugify(name: string): string {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return s || 'meet';
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** `<slug>-<4 random chars>`. `random` returns [0,1) (injectable for tests). */
export function newMeetId(name: string, random: () => number = Math.random): string {
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return `${slugify(name)}-${suffix}`;
}
