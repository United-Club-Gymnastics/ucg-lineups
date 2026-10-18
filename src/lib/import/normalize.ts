import { APPARATUS } from '../apparatus';
import {
  DEFAULT_GYM_ORDER,
  type Athlete,
  type Club,
  type Discipline,
  type ImportModel,
  type ImportWarning,
  type Row,
  type Session,
  type TnTCode,
  type TnTLevels,
} from './types';

export interface ImportInput {
  athletes: Row[];
  wag?: Row[];
  mag?: Row[];
  tnt?: Row[];
  clubEmails?: Row[];
  gymOrder?: string[];
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const g = (r: Row, k: string) => (r[k] ?? '').trim();

export function parseDiscipline(type: string): Discipline | null {
  const t = type.toUpperCase().replace(/[^A-Z]/g, '');
  if (t === 'WAG') return 'WAG';
  if (t === 'MAG') return 'MAG';
  if (t === 'TNT' || t === 'TT') return 'TNT';
  return null;
}

export function parseSession(raw: string): { number: number; gym: string } | null {
  const m = /session\s*(\d+)\s*[-–—:]?\s*([A-Za-z]+)/i.exec(raw);
  if (!m) return null;
  const gym = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
  return { number: Number(m[1]), gym };
}

export function sessionId(number: number, gym: string): string {
  return `s${number}-${gym.toLowerCase()}`;
}

const NAMED_LEVELS: { test: RegExp; code: string; name: string }[] = [
  { test: /open\s*scoring|^infinity$/i, code: 'Inf', name: 'Infinity' },
  { test: /^silver$/i, code: 'XS', name: 'Silver' },
  { test: /^platinum$/i, code: 'XP', name: 'Platinum' },
  { test: /^diamond$/i, code: 'XD', name: 'Diamond' },
  { test: /^level\s*9$/i, code: 'L9', name: 'Level 9' },
  { test: /^developmental$/i, code: 'Dev', name: 'Developmental' },
  { test: /^intermediate$/i, code: 'Int', name: 'Intermediate' },
  { test: /^advanced/i, code: 'Adv', name: 'Advanced (GymACT)' },
  { test: /new\s*flyers?/i, code: 'NF', name: 'New Flyers' },
  { test: /intermediate\s*flyers?/i, code: 'IF', name: 'Intermediate Flyers' },
  { test: /high\s*flyers?/i, code: 'HF', name: 'High Flyers' },
];

/** Level code + display name. Prefers the export's short name; Open Scoring is always Infinity. */
export function mapLevel(level: string, shortName: string): { code: string; name: string } {
  const lv = level.trim();
  const display = lv.replace(/^NAIGC\s+/i, '');
  if (/open\s*scoring/i.test(lv) || /^open$/i.test(shortName.trim())) return { code: 'Inf', name: 'Infinity' };
  const short = shortName.trim();
  if (short) return { code: short, name: display };
  const hit = NAMED_LEVELS.find((n) => n.test.test(display) || n.test.test(lv));
  if (hit) return { code: hit.code, name: hit.name };
  return { code: display, name: display };
}

export function tntLevelCode(level: string): string {
  const l = level.trim();
  if (/new\s*flyer/i.test(l)) return 'NF';
  if (/intermediate\s*flyer/i.test(l)) return 'IF';
  if (/high\s*flyer/i.test(l)) return 'HF';
  return l;
}

export function splitEmails(cell: string): string[] {
  const out: string[] = [];
  for (const part of cell.split(/[;,\s]+/)) {
    const e = part.trim().toLowerCase();
    if (e.includes('@') && !out.includes(e)) out.push(e);
  }
  return out;
}

export const isIndependent = (club: string) => /^independent\b/i.test(club.trim());

// export column -> our apparatus code
const WAG_COLS: [string, string][] = [['vt_event_status', 'VT'], ['ub_event_status', 'UB'], ['bm_event_status', 'BB'], ['fx_event_status', 'FX']];
const MAG_COLS: [string, string][] = [['fx_event_status', 'FX'], ['ph_event_status', 'PH'], ['sr_event_status', 'SR'], ['vt_event_status', 'VT'], ['pb_event_status', 'PB'], ['hb_event_status', 'HB']];
const TNT_COLS: [TnTCode, string, string][] = [
  ['TR', 'trampoline_level', 'trampoline_event_status'],
  ['DM', 'dmt_level', 'dmt_event_status'],
  ['TU', 'tumbling_level', 'tumbling_event_status'],
  ['SY', 'synch_trampoline_level', 'synch_event_status'],
];

const included = (v: string) => v.trim().toLowerCase() === 'included';

function apparatusOf(row: Row, cols: [string, string][], disc: 'WAG' | 'MAG'): string[] {
  const got = new Set(cols.filter(([c]) => included(g(row, c))).map(([, code]) => code));
  return APPARATUS[disc].map((a) => a.code).filter((c) => got.has(c));
}

function tntOf(row: Row): TnTLevels {
  const out: TnTLevels = {};
  for (const [code, lvl, st] of TNT_COLS) {
    if (included(g(row, st))) out[code] = tntLevelCode(g(row, lvl));
  }
  return out;
}

export function normalizeImport(input: ImportInput): ImportModel {
  const warnings: ImportWarning[] = [];
  const warn = (code: string, message: string) => warnings.push({ code, message });
  const gymOrder = input.gymOrder ?? DEFAULT_GYM_ORDER;

  // UCG doesn't use bibs (Julia 2026-10-18): an athlete is identified by discipline + club +
  // name, with birth date only as a tiebreaker when two people in one club share a name.
  // Matching ignores spaces and punctuation: the T&T export strips spaces out of names
  // ("St Pierre" -> "StPierre"), Julia 2026-10-18.
  const compact = (x: string) => slug(x).replace(/-/g, '');
  const personKey = (club: string, first: string, last: string) => `${slug(club)}|${compact(`${first}${last}`)}`;
  const nameKey = (first: string, last: string) => compact(`${first}${last}`);
  const dobOf = (r: Row) => g(r, 'dob').slice(0, 10);
  const index = (rows: Row[] | undefined) => {
    const byPerson = new Map<string, Row[]>();
    const byName = new Map<string, Row[]>();
    for (const r of rows ?? []) {
      const first = g(r, 'firstname'), last = g(r, 'lastname');
      if (!first && !last) continue;
      const club = g(r, 'club_name') || g(r, 'club');
      if (club) byPerson.set(personKey(club, first, last), [...(byPerson.get(personKey(club, first, last)) ?? []), r]);
      byName.set(nameKey(first, last), [...(byName.get(nameKey(first, last)) ?? []), r]);
    }
    return { byPerson, byName };
  };
  const exports: Record<Discipline, { rows?: Row[]; idx: ReturnType<typeof index>; used: Set<Row> }> = {
    WAG: { rows: input.wag, idx: index(input.wag), used: new Set() },
    MAG: { rows: input.mag, idx: index(input.mag), used: new Set() },
    TNT: { rows: input.tnt, idx: index(input.tnt), used: new Set() },
  };
  const names: Record<Discipline, string> = { WAG: 'WAG', MAG: 'MAG', TNT: 'T&T' };

  const athletes: Athlete[] = [];
  const ids = new Set<string>();
  const missingApparatus: Record<Discipline, number> = { WAG: 0, MAG: 0, TNT: 0 };

  // How many rows share discipline + club + name: those ids get the birth date added.
  const sameName = new Map<string, number>();
  for (const r of input.athletes) {
    const d = parseDiscipline(g(r, 'type'));
    if (d) {
      const k = `${d}|${personKey(g(r, 'club'), g(r, 'firstname'), g(r, 'lastname'))}`;
      sameName.set(k, (sameName.get(k) ?? 0) + 1);
    }
  }

  input.athletes.forEach((r, i) => {
    const line = i + 2;
    const disc = parseDiscipline(g(r, 'type'));
    if (!disc) {
      warn('unknown-type', `Athletes row ${line}: unknown Type "${g(r, 'type')}" — skipped.`);
      return;
    }
    const first = g(r, 'firstname');
    const last = g(r, 'lastname');
    if (!first && !last) {
      warn('missing-name', `Athletes row ${line}: no name — skipped.`);
      return;
    }
    const clubName = g(r, 'club');
    const who = `${names[disc]} ${first} ${last}`.trim();
    const dob = dobOf(r);
    const pk = personKey(clubName, first, last);
    let id = `${disc}_${slug(clubName) || 'no-club'}_${slug(`${first} ${last}`)}`;
    if ((sameName.get(`${disc}|${pk}`) ?? 0) > 1) {
      if (dob) id = `${id}_${dob}`;
      if (!dob || ids.has(id)) warn('same-name', `${who} (${clubName}): two athletes share this name in one club${dob ? ' and birth date' : ''} — check them.`);
    }
    const base = id;
    for (let n = 2; ids.has(id); n++) id = `${base}~${n}`;
    ids.add(id);

    const independent = isIndependent(clubName);
    if (!clubName) warn('missing-club', `${who}: no club.`);
    const lvl = mapLevel(g(r, 'level'), g(r, 'levelshortname'));
    const sess = parseSession(g(r, 'session'));
    if (!sess) warn('bad-session', `${who}: session "${g(r, 'session')}" not understood.`);

    let apparatus: string[] = [];
    let tnt: TnTLevels | undefined;
    const ex = exports[disc];
    // match the discipline export by club + name; fall back to name alone; birth date breaks ties
    const free = (rows?: Row[]) => (rows ?? []).filter((c) => !ex.used.has(c));
    let cands = free(ex.idx.byPerson.get(pk));
    if (cands.length === 0) cands = free(ex.idx.byName.get(nameKey(first, last))).filter((c) => !(g(c, 'club_name') || g(c, 'club')));
    if (cands.length === 0) {
      const byName = free(ex.idx.byName.get(nameKey(first, last)));
      if (byName.length === 1) cands = byName;
    }
    const row = cands.length <= 1 ? cands[0] : (cands.find((c) => dob && dobOf(c) === dob) ?? cands[0]);
    if (row) ex.used.add(row);
    if (row) {
      if (disc === 'TNT') {
        tnt = tntOf(row);
        apparatus = TNT_COLS.map(([c]) => c).filter((c) => tnt![c]);
      } else {
        apparatus = apparatusOf(row, disc === 'WAG' ? WAG_COLS : MAG_COLS, disc);
      }
    } else {
      missingApparatus[disc]++;
      if (ex.rows) warn('not-in-export', `${who} (${clubName}) is not in the ${names[disc]} export — no apparatus.`);
      if (disc === 'TNT') tnt = {};
    }

    athletes.push({
      id,
      discipline: disc,
      first,
      last,
      clubId: slug(clubName),
      clubName,
      independent,
      levelCode: lvl.code,
      levelName: lvl.name,
      sessionId: sess ? sessionId(sess.number, sess.gym) : '',
      apparatus,
      ...(disc === 'TNT' ? { tnt } : {}),
      competes: apparatus.length > 0,
    });
  });

  for (const d of ['WAG', 'MAG', 'TNT'] as Discipline[]) {
    const ex = exports[d];
    if (!ex.rows && missingApparatus[d] > 0) {
      warn('no-export', `No ${names[d]} export provided — ${missingApparatus[d]} ${names[d]} athletes have no apparatus.`);
    }
    for (const r of ex.rows ?? []) {
      if (!ex.used.has(r) && (g(r, 'firstname') || g(r, 'lastname'))) {
        warn('unmatched-row', `${names[d]} export: ${g(r, 'firstname')} ${g(r, 'lastname')} (${g(r, 'club_name') || g(r, 'club') || 'no club'}) is not in the athletes export — ignored.`);
      }
    }
  }

  // Sessions
  const sessMap = new Map<string, { s: Session; counts: Record<Discipline, number>; levels: Set<string> }>();
  for (const a of athletes) {
    if (!a.sessionId) continue;
    const parsed = /^s(\d+)-(.+)$/.exec(a.sessionId)!;
    let e = sessMap.get(a.sessionId);
    if (!e) {
      const gymRaw = parsed[2];
      e = {
        s: { id: a.sessionId, number: Number(parsed[1]), gym: gymRaw.charAt(0).toUpperCase() + gymRaw.slice(1), discipline: a.discipline, levelCodes: [] },
        counts: { WAG: 0, MAG: 0, TNT: 0 },
        levels: new Set(),
      };
      sessMap.set(a.sessionId, e);
    }
    e.counts[a.discipline]++;
    e.levels.add(a.levelCode);
  }
  const gymIdx = (gym: string) => {
    const i = gymOrder.findIndex((x) => x.toLowerCase() === gym.toLowerCase());
    return i < 0 ? gymOrder.length : i;
  };
  const sessions = [...sessMap.values()]
    .map(({ s, counts, levels }) => {
      const discs = (['WAG', 'MAG', 'TNT'] as Discipline[]).filter((d) => counts[d] > 0);
      s.discipline = discs.sort((a, b) => counts[b] - counts[a])[0];
      if (discs.length > 1) warn('mixed-session', `Session ${s.number} ${s.gym} has more than one discipline (${discs.map((d) => names[d]).join(', ')}).`);
      s.levelCodes = [...levels].sort();
      return s;
    })
    .sort((a, b) => a.number - b.number || gymIdx(a.gym) - gymIdx(b.gym));

  // Clubs (independents are not clubs)
  const clubs = new Map<string, Club>();
  for (const a of athletes) {
    if (a.independent || !a.clubName) continue;
    if (!clubs.has(a.clubId)) clubs.set(a.clubId, { id: a.clubId, name: a.clubName, emails: [] });
  }
  if (input.clubEmails) {
    const matched = new Set<string>();
    for (const r of input.clubEmails) {
      const name = g(r, 'club');
      if (!name) continue;
      // Club_Emails.xlsx has an Email column; the League Communications export has Contact + Role
      // ("Club Email") instead, and only email roles count.
      const role = g(r, 'role');
      if (role && !/e-?mail/i.test(role)) continue;
      const cell = g(r, 'email') || g(r, 'contact');
      const club = clubs.get(slug(name));
      if (!club) {
        continue; // clubs in the email list with no athletes here are expected (not competing)
      }
      matched.add(club.id);
      for (const e of splitEmails(cell)) if (!club.emails.includes(e)) club.emails.push(e);
    }
    for (const c of clubs.values()) {
      if (c.emails.length === 0) warn('no-email', `${c.name} has no contact email.`);
    }
  }

  return {
    athletes,
    sessions,
    clubs: [...clubs.values()].sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
  };
}
