import { describe, expect, it } from 'vitest';
import { assertMeetId, meetPaths, newMeetId, slugify } from '../../src/lib/data/meet-paths';
import { pickMeet, visibleMeets } from '../../src/lib/selected-meet';
import { parseMeet, sortMeets } from '../../src/lib/data/meet-store';

describe('meetPaths', () => {
  it('puts everything meet-specific under meets/{id}', () => {
    const p = meetPaths('nats-ab12');
    expect(p.root).toBe('meets/nats-ab12');
    expect(p.settings).toBe('meets/nats-ab12/settings/meet');
    expect(p.athlete('WAG_1')).toBe('meets/nats-ab12/athletes/WAG_1');
    expect(p.club('alpha')).toBe('meets/nats-ab12/clubs/alpha');
    expect(p.session('s1-green')).toBe('meets/nats-ab12/sessions/s1-green');
    expect(p.squad('s1-green')).toBe('meets/nats-ab12/squads/s1-green');
    expect(p.synchro).toBe('meets/nats-ab12/synchroSessions/main');
    expect(p.athletes).toBe('meets/nats-ab12/athletes');
    expect(p.emailSettings).toBe('meets/nats-ab12/emailSettings/main');
  });

  it('two meets never share a path', () => {
    const a = meetPaths('a-1111');
    const b = meetPaths('b-2222');
    for (const k of ['settings', 'athletes', 'clubs', 'sessions', 'squads', 'synchro', 'emailLog'] as const) expect(a[k]).not.toBe(b[k]);
  });

  it('refuses an empty id or one with a slash', () => {
    expect(() => assertMeetId('')).toThrow();
    expect(() => meetPaths('a/b')).toThrow();
  });
});

describe('meet ids', () => {
  it('slugifies names', () => {
    expect(slugify('NE Regionals 2027')).toBe('ne-regionals-2027');
    expect(slugify('  Café & Co. — Open!  ')).toBe('cafe-co-open');
    expect(slugify('???')).toBe('meet');
    expect(slugify('x'.repeat(100)).length).toBe(40);
  });

  it('adds a short random suffix', () => {
    let n = 0;
    const id = newMeetId('NE Regionals', () => [0, 0.1, 0.5, 0.99][n++ % 4]);
    expect(id).toMatch(/^ne-regionals-[a-z0-9]{4}$/);
    expect(newMeetId('A')).not.toBe(newMeetId('A')); // overwhelmingly likely; 31^4 combinations
  });
});

describe('meet list', () => {
  const meets = sortMeets([
    parseMeet('old', { name: 'Old', createdAt: { toMillis: () => 100 } }),
    parseMeet('new', { name: 'New', createdAt: { toMillis: () => 300 } }),
    parseMeet('arch', { name: 'Arch', createdAt: { toMillis: () => 200 }, archived: true }),
    parseMeet('bare', {}),
  ]);

  it('sorts newest first, falls back to the id for a missing name, and hides archived meets', () => {
    expect(meets.map((m) => m.id)).toEqual(['new', 'arch', 'old', 'bare']);
    expect(meets.at(-1)!.name).toBe('bare');
    expect(visibleMeets(meets).map((m) => m.id)).toEqual(['new', 'old', 'bare']);
  });

  it('keeps the remembered meet when it is visible, else the newest visible, else null', () => {
    expect(pickMeet(meets, 'old')).toBe('old');
    expect(pickMeet(meets, 'arch')).toBe('new'); // archived: not offered
    expect(pickMeet(meets, 'gone')).toBe('new');
    expect(pickMeet(meets, null)).toBe('new');
    expect(pickMeet([], 'x')).toBeNull();
  });
});
