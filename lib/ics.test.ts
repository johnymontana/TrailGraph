import { describe, it, expect } from 'vitest';
import { generateICS } from './ics';

describe('generateICS', () => {
  const ics = generateICS(
    'My Trip',
    [
      { uid: 'stop-1@trailgraph', date: '20260701', summary: 'Yellowstone National Park', location: 'WY' },
      { uid: 'stop-2@trailgraph', date: '20260703', summary: 'Glacier; with, commas', description: 'line1\nline2' },
    ],
    '20260620T000000Z',
  );

  it('emits a valid VCALENDAR envelope with CRLF', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trim().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
  });

  it('emits one VEVENT per stop with exclusive all-day DTEND', () => {
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260701');
    expect(ics).toContain('DTEND;VALUE=DATE:20260702'); // next day (exclusive)
  });

  it('escapes commas/semicolons and newlines per RFC 5545', () => {
    expect(ics).toContain('SUMMARY:Glacier\\; with\\, commas');
    expect(ics).toContain('DESCRIPTION:line1\\nline2');
  });
});
