import { describe, expect, it } from 'vitest';
import { dateToPacific, formatDeadline, formatWhen, pacificDay, pacificToDate } from '../../src/lib/pacific';

describe('Pacific time', () => {
  it('converts a summer (PDT, UTC-7) and a winter (PST, UTC-8) wall-clock time to the right instant', () => {
    expect(pacificToDate('2026-10-18', '15:40')?.toISOString()).toBe('2026-10-18T22:40:00.000Z');
    expect(pacificToDate('2027-03-02', '23:59')?.toISOString()).toBe('2027-03-03T07:59:00.000Z');
  });
  it('handles the days daylight saving changes', () => {
    expect(pacificToDate('2026-11-01', '12:00')?.toISOString()).toBe('2026-11-01T20:00:00.000Z'); // PST again
    expect(pacificToDate('2027-03-14', '12:00')?.toISOString()).toBe('2027-03-14T19:00:00.000Z'); // PDT
  });
  it('round-trips through the date and time inputs', () => {
    const d = pacificToDate('2027-03-27', '23:59')!;
    expect(dateToPacific(d)).toEqual({ date: '2027-03-27', time: '23:59' });
    expect(dateToPacific(new Date('2026-10-19T06:30:00Z'))).toEqual({ date: '2026-10-18', time: '23:30' });
  });
  it('rejects blank or impossible input', () => {
    expect(pacificToDate('', '10:00')).toBeNull();
    expect(pacificToDate('2026-10-18', '')).toBeNull();
    expect(pacificToDate('2026-02-31', '10:00')).toBeNull();
    expect(pacificToDate('2026-10-18', '25:00')).toBeNull();
  });
  it('formats for people', () => {
    expect(formatDeadline(pacificToDate('2027-03-26', '23:59')!)).toBe('Fri Mar 26, 11:59 PM PT');
    expect(formatWhen(Date.UTC(2026, 9, 18, 22, 40))).toBe('Oct 18, 3:40 PM PT');
  });
  it('"today" is the Pacific day, not the UTC day', () => {
    expect(pacificDay(new Date('2026-10-19T03:00:00Z'))).toBe('2026-10-18');
  });
});
