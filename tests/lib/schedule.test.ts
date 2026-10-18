import { describe, expect, it } from 'vitest';
import { collectLegacy, formatDate, parseFields, parseRows, planMigration, resolveSchedule, weekdayOf, whenText } from '../../src/lib/schedule';

const rows = { '1': { date: '2026-10-22', stretch: '6:45 AM', warmups: '7:00 AM', competition: '7:30 AM' }, '2': { competition: '1:00 PM' } };

describe('resolveSchedule', () => {
  it('uses the number\'s row when there is no override', () => {
    expect(resolveSchedule(1, rows, undefined)).toEqual({ date: '2026-10-22', stretch: '6:45 AM', warmups: '7:00 AM', competition: '7:30 AM' });
  });
  it('an override wins per field, the rest comes from the row', () => {
    expect(resolveSchedule(1, rows, { competition: '9:00 AM', date: '' })).toEqual({ date: '2026-10-22', stretch: '6:45 AM', warmups: '7:00 AM', competition: '9:00 AM' });
  });
  it('a missing row gives empty fields; the date falls back to the meet date only', () => {
    expect(resolveSchedule(5, rows, undefined)).toEqual({ date: '', stretch: '', warmups: '', competition: '' });
    expect(resolveSchedule(5, rows, undefined, 'October 22–25, 2026').date).toBe('October 22–25, 2026');
    expect(resolveSchedule(2, rows, undefined, 'Fallback')).toEqual({ date: 'Fallback', stretch: '', warmups: '', competition: '1:00 PM' });
    expect(resolveSchedule(1, rows, undefined, 'Fallback').date).toBe('2026-10-22'); // the row wins over the fallback
  });
  it('ignores blanks and whitespace in an override', () => {
    expect(resolveSchedule(1, rows, { stretch: '   ' }).stretch).toBe('6:45 AM');
  });
});

describe('parsing', () => {
  it('reads only known non-empty string fields', () => {
    expect(parseFields({ date: ' 2026-10-22 ', stretch: 5, warmups: '', x: 'y' })).toEqual({ date: '2026-10-22' });
    expect(parseFields(null)).toEqual({});
    expect(parseRows({ '1': { competition: '8' }, '2': {}, '3': 'x' })).toEqual({ '1': { competition: '8' } });
    expect(parseRows(undefined)).toEqual({});
  });
});

describe('dates and the T&T rotation sheet time', () => {
  it('formats an ISO date and finds its weekday; free text is kept as typed', () => {
    expect(formatDate('2026-10-22')).toBe('October 22, 2026');
    expect(weekdayOf('2026-10-22')).toBe('Thursday');
    expect(formatDate('October 22–25, 2026')).toBe('October 22–25, 2026');
    expect(weekdayOf('October 22–25, 2026')).toBe('');
    expect(weekdayOf('2026-02-31')).toBe('');
  });
  it('weekday + competition; no second weekday when the time already has one', () => {
    expect(whenText({ date: '2026-10-22', competition: '7:30 AM' })).toBe('Thursday 7:30 AM');
    expect(whenText({ date: '2026-10-22', competition: 'Thursday 7:30 AM' })).toBe('Thursday 7:30 AM');
    expect(whenText({ date: '2026-10-22', competition: '' })).toBe('Thursday');
    expect(whenText({ date: '', competition: '7:30 AM' })).toBe('7:30 AM');
  });
});

describe('migrating the older per-session times', () => {
  const sessions = [
    { id: 's1-orange', number: 1 },
    { id: 's1-purple', number: 1, competitionTime: 'Thursday 9:00 AM' },
    { id: 's2-green', number: 2 },
    { id: 's3-red', number: 3 },
  ];
  const docs = {
    's1-orange': { schedule: { stretch: '6:45 AM', warmups: '', competition: '7:30 AM' } },
    's2-green': { schedule: { stretch: '', warmups: '', competition: '' } },
  };
  it('finds only sessions that have something saved the old way', () => {
    const l = collectLegacy(sessions, docs);
    expect(l.map((x) => x.sessionId)).toEqual(['s1-orange', 's1-purple']);
    expect(l[1]).toMatchObject({ competition: 'Thursday 9:00 AM', hadCompetitionTime: true, hadSquadSchedule: false });
  });
  it('keeps what differs from the number\'s row as an override and drops what matches', () => {
    const plan = planMigration(collectLegacy(sessions, docs), rows, {});
    expect(plan.overrides).toEqual({ 's1-purple': { competition: 'Thursday 9:00 AM' } });
    expect(plan.moved).toBe(1);
    expect(plan.dropped).toBe(2); // Orange's 6:45 and 7:30 match Session 1's row
    expect(plan.clearSquadSchedule).toEqual(['s1-orange']);
    expect(plan.clearCompetitionTime).toEqual(['s1-purple']);
  });
  it('a row with nothing in that field makes the old time an override; an existing override is never replaced', () => {
    const plan = planMigration(collectLegacy(sessions, docs), {}, { 's1-orange': { stretch: '5:00 AM' } });
    expect(plan.overrides['s1-orange']).toEqual({ stretch: '5:00 AM', competition: '7:30 AM' });
    expect(plan.overrides['s1-purple']).toEqual({ competition: 'Thursday 9:00 AM' });
  });
});
