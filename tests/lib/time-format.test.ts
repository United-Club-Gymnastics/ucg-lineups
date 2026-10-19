import { describe, expect, it } from 'vitest';
import { formatTime } from '../../src/lib/schedule';

describe('formatTime (session times tidy into h:mm AM/PM)', () => {
  it.each([
    ['7:30 AM', '7:30 AM'],
    ['7:30am', '7:30 AM'],
    ['7:30 a.m.', '7:30 AM'],
    ['7.30a', '7:30 AM'],
    ['730', '7:30 AM'],
    ['0730', '7:30 AM'],
    ['7', '7:00 AM'],
    ['7 pm', '7:00 PM'],
    ['10:30AM', '10:30 AM'],
    ['1130', '11:30 AM'],
    ['12:15', '12:15 PM'],
    ['1:45', '1:45 PM'],
    ['19:30', '7:30 PM'],
    ['1930', '7:30 PM'],
    ['0:15', '12:15 AM'],
    ['12am', '12:00 AM'],
    ['  8:00   PM ', '8:00 PM'],
  ])('%s → %s', (input, out) => expect(formatTime(input)).toBe(out));

  it('leaves anything that is not a time as typed', () => {
    expect(formatTime('')).toBe('');
    expect(formatTime('TBD')).toBe('TBD');
    expect(formatTime('7:75')).toBe('7:75');
    expect(formatTime('13 pm')).toBe('13 pm');
    expect(formatTime('25:00')).toBe('25:00');
    expect(formatTime(' after Session 2 ')).toBe('after Session 2');
  });
});
