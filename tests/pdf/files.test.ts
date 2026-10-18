import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { applySchedules, buildExportSessions } from '../../src/lib/pdf/export-all';
import { allSessionsPdf, allSessionsZip, sessionPdf } from '../../src/lib/pdf/files';
import { sessionPages } from '../../src/lib/pdf/collate';
import type { Session } from '../../src/lib/import/types';
import { MEET, magFixture, tntFixture, wagInfinityFixture } from './fixtures';

const mag = magFixture();
const wag = wagInfinityFixture();
const tnt = tntFixture();
const extra: Session = { id: 's3-red', number: 3, gym: 'Red', discipline: 'WAG', levelCodes: ['XS'] };
const base = () => ({
  sessions: [mag.session, wag.session, tnt.session, extra],
  athletes: [...mag.athletes, ...wag.athletes, ...tnt.athletes],
  gymOrder: ['Green', 'Red', 'Yellow', 'Orange', 'Purple'],
  ordersByClub: {},
  squadDocs: { [mag.session.id]: mag.stored, [wag.session.id]: wag.stored, [tnt.session.id]: tnt.stored } as Record<string, unknown>,
  meet: MEET,
  synchroPairs: tnt.pairs.map((p) => ({ id: p.id, level: p.level, a1: '', name1: p.name1, club1: p.club1, a2: '', name2: p.name2, club2: p.club2, createdAt: null, source: '' })),
});

const toBuffer = (b: Blob) => new Promise<ArrayBuffer>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(r.error); r.readAsArrayBuffer(b); });
const head = (b: ArrayBuffer) => new TextDecoder().decode(new Uint8Array(b).slice(0, 5));

describe('buildExportSessions', () => {
  it('one input per session in gym order, artistic and T&T', () => {
    const b = buildExportSessions(base());
    expect(b.sessions.map((s) => s.title)).toEqual(['Session 2 – Green', 'Session 3 – Red', 'Session 1 – Orange', 'Session 1 – Purple']);
    expect(b.sessions.map((s) => s.input.type)).toEqual(['artistic', 'artistic', 'artistic', 'tnt']);
  });
  it('warns (never blocks) about missing squads, unplaced athletes, an unreadable Synchro tool and an empty meet name', () => {
    const trimmed = { ...mag.stored, squads: mag.stored.squads.map((s, i) => (i === 0 ? { ...s, cards: [] } : s)) };
    const b = buildExportSessions({ ...base(), squadDocs: { ...base().squadDocs, [mag.session.id]: trimmed }, synchroPairs: null, meet: { name: ' ', date: '' } });
    const texts = b.warnings.map((w) => `${w.session}: ${w.text}`);
    expect(texts[0]).toMatch(/^Meet: The meet name is empty/);
    expect(texts.some((t) => /^Session 3 – Red: No squads saved yet/.test(t))).toBe(true);
    expect(texts.some((t) => /^Session 1 – Orange: \d+ athletes? not placed/.test(t))).toBe(true);
    expect(texts.some((t) => /^Session 1 – Purple: The Synchro tool could not be read/.test(t))).toBe(true);
    expect(b.warnings.some((w) => w.session === 'Session 2 – Green')).toBe(false);
  });
  it('no warnings when everything is saved', () => {
    expect(buildExportSessions({ ...base(), sessions: base().sessions.filter((s) => s.id !== 's3-red') }).warnings).toEqual([]);
  });
  it('every sheet gets its session number\'s date and times; an override wins per field; the meet date is only a fallback', () => {
    const rows = { '1': { date: '2026-10-22', stretch: '6:45 AM', warmups: '7:00 AM', competition: '7:30 AM' }, '2': { competition: '1:00 PM' } };
    const sessions = base().sessions.map((x) => (x.id === 's1-purple' ? { ...x, scheduleOverride: { competition: '9:00 AM' } } : x));
    const b = buildExportSessions({ ...base(), sessions, schedule: rows });
    const get = (id: string) => b.sessions.find((x) => x.id === id)!.input;
    const orange = get('s1-orange');
    expect(orange.type === 'artistic' && orange.input.schedule).toEqual({ stretch: '6:45 AM', warmups: '7:00 AM', competition: '7:30 AM' });
    expect(orange.input.meet).toEqual({ name: MEET.name, date: 'October 22, 2026' });
    const purple = get('s1-purple');
    expect(purple.type === 'tnt' && purple.input.competitionTime).toBe('Thursday 9:00 AM'); // override wins for competition only
    expect(purple.input.meet.date).toBe('October 22, 2026'); // ...and the date still comes from the row
    const green = get('s2-green');
    expect(green.input.meet.date).toBe(MEET.date); // no date for Session 2: the single meet date
    expect(green.type === 'artistic' && green.input.schedule.competition).toBe('1:00 PM');
  });
  it('typed schedule values (not saved yet) override what was read', () => {
    const b = buildExportSessions(base());
    const o = applySchedules(b.sessions, { meet: { name: 'New', date: 'Soon' }, rows: { '1': { date: '2026-10-23', competition: '1 PM' } }, overrides: { 's1-purple': { competition: '2 PM' } } });
    expect(o.every((s) => s.input.input.meet.name === 'New')).toBe(true);
    const t = o.find((s) => s.id === 's1-purple')!.input;
    expect(t.type === 'tnt' && t.input.competitionTime).toBe('Friday 2 PM');
    expect(o.find((s) => s.id === 's3-red')!.input.input.meet.date).toBe('Soon');
    expect(b.sessions.find((s) => s.id === 's1-purple')!.input.input.meet.name).toBe(MEET.name); // the original is untouched
  });
});

describe('buildExportSessions: synchro pairs and their sessions', () => {
  const tnt2: Session = { id: 's2-purple', number: 2, gym: 'Purple', discipline: 'TNT', levelCodes: ['NF', 'IF', 'HF'] };
  const sy2 = ['One', 'Two'].map((n) => ({
    ...tnt.athletes.find((a) => a.apparatus.includes('SY'))!, id: `TNT_elsewhere_${n}`, first: n, last: 'Elsewhere', clubId: 'elsewhere', clubName: 'Elsewhere Club',
    sessionId: tnt2.id, apparatus: ['SY'], tnt: { SY: 'IF' },
  }));
  const raw = (p: { id: string; level: string; name1: string; name2: string; club1: string; club2: string }) =>
    ({ id: p.id, level: p.level, a1: '', name1: p.name1, club1: p.club1, a2: '', name2: p.name2, club2: p.club2, createdAt: null, source: '' });
  const two = () => ({
    ...base(), sessions: [...base().sessions, tnt2], athletes: [...base().athletes, ...sy2],
    synchroPairs: [...base().synchroPairs, raw({ id: 'e1', level: 'IF', name1: 'One Elsewhere', club1: 'Elsewhere Club', name2: 'Two Elsewhere', club2: 'Elsewhere Club' })],
  });
  const flightIds = (b: ReturnType<typeof buildExportSessions>, id: string) => {
    const s = b.sessions.find((x) => x.id === id)!.input;
    return s.type === 'tnt' ? s.input.flights.flatMap((f) => f.pairs.map((p) => p.id)) : [];
  };

  it('puts each pair on the session both athletes are in', () => {
    const b = buildExportSessions(two());
    expect(flightIds(b, tnt2.id)).toEqual(['e1']);
    expect(flightIds(b, tnt.session.id)).not.toContain('e1');
    expect(flightIds(b, tnt.session.id).length).toBeGreaterThan(0);
    expect(b.warnings.some((w) => w.session === 'Synchro')).toBe(false);
  });

  it('a pair the host moved appears on the assigned session\'s synchro sheet and rotation sheet, not the old one', () => {
    const moved = tnt.pairs[0].id;
    const b = buildExportSessions({ ...two(), synchroAssignments: { [moved]: tnt2.id } });
    expect(flightIds(b, tnt2.id)).toContain(moved);
    expect(flightIds(b, tnt.session.id)).not.toContain(moved);
    const input = b.sessions.find((x) => x.id === tnt2.id)!.input;
    const pages = input.type === 'tnt' ? [...sessionPages('scorecards', input), ...sessionPages('rotation', input)] : [];
    expect(pages.filter((p) => p.kind === 'synchro').length).toBeGreaterThan(0);
    expect(JSON.stringify(pages.filter((p) => p.kind === 'tnt-rotation'))).toContain(tnt.pairs[0].name1);
  });

  it('a pair across two sessions is on no sheet and a warning names it until the host chooses', () => {
    const cross = raw({ id: 'x1', level: 'IF', name1: tnt.pairs[0].name1, club1: tnt.pairs[0].club1, name2: 'Two Elsewhere', club2: 'Elsewhere Club' });
    const input = { ...two(), synchroPairs: [...two().synchroPairs, cross] };
    const b = buildExportSessions(input);
    const w = b.warnings.find((x) => x.session === 'Synchro')!;
    expect(w.text).toContain(`${tnt.pairs[0].name1} & Two Elsewhere`);
    expect(w.text).toMatch(/still needs? a session/);
    expect(flightIds(b, tnt.session.id)).not.toContain('x1');
    expect(flightIds(b, tnt2.id)).not.toContain('x1');
    const chosen = buildExportSessions({ ...input, synchroAssignments: { x1: tnt2.id } });
    expect(chosen.warnings.some((x) => x.session === 'Synchro')).toBe(false);
    expect(flightIds(chosen, tnt2.id)).toContain('x1');
  });
});

describe('files', () => {
  const inputs = () => buildExportSessions(base()).sessions.map((s) => s.input);

  it('one session is one PDF with the spec file name', async () => {
    const f = await sessionPdf('scorecards', inputs()[0], 'Oct 18, 2026');
    expect(f.name).toBe('Session 2 - Green - Scorecards.pdf');
    expect(head(f.bytes)).toBe('%PDF-');
    const r = await sessionPdf('rotation', inputs()[2], 'Oct 18, 2026');
    expect(r.name).toBe('Session 1 - Orange - Rotation Sheet.pdf');
  });

  it('all sessions in one PDF, collated', async () => {
    const f = await allSessionsPdf('rotation', inputs(), undefined, 'x');
    expect(f.name).toBe('All Sessions - Rotation Sheets.pdf');
    expect(head(f.bytes)).toBe('%PDF-');
    const s = await allSessionsPdf('scorecards', inputs(), undefined, 'x');
    expect(s.name).toBe('All Sessions - Scorecards.pdf');
    expect(s.bytes.byteLength).toBeGreaterThan(f.bytes.byteLength);
  });

  it('separate PDFs: a zip with one file per printable session in collation order', async () => {
    const z = await allSessionsZip('scorecards', inputs(), undefined, 'x');
    expect(z.name).toBe('All Sessions - Scorecards.zip');
    const zip = await JSZip.loadAsync(await toBuffer(z.bytes));
    expect(Object.keys(zip.files)).toEqual(['Session 2 - Green - Scorecards.pdf', 'Session 1 - Orange - Scorecards.pdf', 'Session 1 - Purple - Scorecards.pdf']); // Red has no squads: nothing to print, so no empty file
    for (const f of Object.values(zip.files)) expect(head(await f.async('arraybuffer'))).toBe('%PDF-');
    const r = await allSessionsZip('rotation', inputs(), undefined, 'x');
    const rz = await JSZip.loadAsync(await toBuffer(r.bytes));
    expect(Object.keys(rz.files)).toEqual(['Session 1 - Orange - Rotation Sheet.pdf', 'Session 1 - Purple - Rotation Sheet.pdf', 'Session 2 - Green - Rotation Sheet.pdf', 'Session 3 - Red - Rotation Sheet.pdf']);
  });
});
