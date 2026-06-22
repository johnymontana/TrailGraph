import { describe, it, expect } from 'vitest';
import { suggestDays } from './itinerary';

describe('suggestDays', () => {
  it('keeps light stops on the same day', () => {
    const days = suggestDays(
      [
        { id: 'a', driveMinutesToHere: 0, visitMinutes: 120 },
        { id: 'b', driveMinutesToHere: 30, visitMinutes: 120 },
      ],
      { maxMinutesPerDay: 480 },
    );
    expect(days).toEqual([
      { id: 'a', day: 1 },
      { id: 'b', day: 1 },
    ]);
  });

  it('rolls to a new day when the budget is exceeded', () => {
    const days = suggestDays(
      [
        { id: 'a', driveMinutesToHere: 0, visitMinutes: 300 },
        { id: 'b', driveMinutesToHere: 240, visitMinutes: 180 }, // 420 + 300 > 480 → day 2
      ],
      { maxMinutesPerDay: 480 },
    );
    expect(days.find((d) => d.id === 'b')?.day).toBe(2);
  });

  it('uses the default visit time when none is given', () => {
    const days = suggestDays([{ id: 'a' }, { id: 'b' }], { maxMinutesPerDay: 300, defaultVisitMinutes: 180 });
    // 180 then +180 > 300 → b on day 2
    expect(days).toEqual([
      { id: 'a', day: 1 },
      { id: 'b', day: 2 },
    ]);
  });

  it('never strands an oversized single stop in a loop', () => {
    const days = suggestDays([{ id: 'big', visitMinutes: 1000 }], { maxMinutesPerDay: 480 });
    expect(days).toEqual([{ id: 'big', day: 1 }]);
  });
});
