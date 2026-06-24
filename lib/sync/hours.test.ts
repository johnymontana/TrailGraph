import { describe, it, expect } from 'vitest';
import {
  dayState,
  parseNpsDate,
  parseOperatingHours,
  weekdayOf,
  dateInException,
  scheduleStateOn,
  openStateOn,
  summarizeClosures,
  monthToSeason,
  monthsInRange,
  deriveOpenSeasons,
} from './hours';

const GTSR = [
  {
    name: 'Park Hours',
    standardHours: {
      monday: 'All Day',
      tuesday: 'All Day',
      wednesday: 'All Day',
      thursday: 'All Day',
      friday: 'All Day',
      saturday: 'All Day',
      sunday: 'All Day',
    },
    exceptions: [],
  },
  {
    name: 'Going-to-the-Sun Road',
    standardHours: {
      monday: 'All Day',
      tuesday: 'All Day',
      wednesday: 'All Day',
      thursday: 'All Day',
      friday: 'All Day',
      saturday: 'All Day',
      sunday: 'All Day',
    },
    exceptions: [
      {
        name: 'Winter closure',
        startDate: '2026-10-15',
        endDate: '2027-05-20',
        exceptionHours: {
          monday: 'Closed',
          tuesday: 'Closed',
          wednesday: 'Closed',
          thursday: 'Closed',
          friday: 'Closed',
          saturday: 'Closed',
          sunday: 'Closed',
        },
      },
    ],
  },
];

describe('dayState', () => {
  it('classifies open/closed/unknown', () => {
    expect(dayState('All Day')).toBe('open');
    expect(dayState('8:00AM - 5:00PM')).toBe('open');
    expect(dayState('Closed')).toBe('closed');
    expect(dayState('')).toBe('unknown');
    expect(dayState(null)).toBe('unknown');
    expect(dayState('By appointment')).toBe('unknown');
  });
});

describe('parseNpsDate', () => {
  it('accepts ISO dates and rejects junk', () => {
    expect(parseNpsDate('2026-10-15')).toBe('2026-10-15');
    expect(parseNpsDate('10/15/2026')).toBeNull();
    expect(parseNpsDate(undefined)).toBeNull();
  });
});

describe('weekdayOf', () => {
  it('maps ISO date → mon-first weekday', () => {
    expect(weekdayOf('2026-06-22')).toBe('mon'); // 2026-06-22 is a Monday
    expect(weekdayOf('2026-06-21')).toBe('sun');
    expect(weekdayOf('nope')).toBeNull();
  });
});

describe('parseOperatingHours', () => {
  it('parses schedules + dated exceptions with synthetic ids', () => {
    const out = parseOperatingHours(GTSR, 'glac');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'glac:hours:0', name: 'Park Hours', allYear: true, mon: 'All Day' });
    expect(out[1].allYear).toBe(false);
    expect(out[1].exceptions[0]).toMatchObject({
      id: 'glac:hours:1:exc:0',
      startDate: '2026-10-15',
      endDate: '2027-05-20',
      mon: 'Closed',
    });
  });

  it('returns [] for non-array / missing', () => {
    expect(parseOperatingHours(undefined, 'x')).toEqual([]);
    expect(parseOperatingHours('[]', 'x')).toEqual([]);
  });
});

describe('dateInException / scheduleStateOn', () => {
  const [, road] = parseOperatingHours(GTSR, 'glac');
  it('detects in-range dates', () => {
    expect(dateInException(road.exceptions[0], '2026-12-01')).toBe(true);
    expect(dateInException(road.exceptions[0], '2026-09-01')).toBe(false);
  });
  it('exception hours win over standard', () => {
    expect(scheduleStateOn(road, '2026-12-01')).toBe('closed'); // winter → closed
    expect(scheduleStateOn(road, '2026-09-01')).toBe('open'); // outside closure → open
  });
});

describe('scheduleStateOn — unknown days & partial-open exceptions', () => {
  it('returns unknown for a day the park does not report', () => {
    const [sched] = parseOperatingHours(
      [{ name: 'Park Hours', standardHours: { monday: '', tuesday: 'All Day' }, exceptions: [] }],
      'x',
    );
    expect(scheduleStateOn(sched, '2026-06-22')).toBe('unknown'); // 2026-06-22 is a Monday (empty → unknown)
    expect(scheduleStateOn(sched, '2026-06-23')).toBe('open'); // Tuesday → All Day
  });

  it('an exception can re-open a specific day inside a closure window', () => {
    const [sched] = parseOperatingHours(
      [
        {
          name: 'Park Hours',
          standardHours: { monday: 'All Day', tuesday: 'All Day', wednesday: 'All Day', thursday: 'All Day', friday: 'All Day', saturday: 'All Day', sunday: 'All Day' },
          exceptions: [
            {
              name: 'Holiday week',
              startDate: '2026-12-24',
              endDate: '2026-12-26',
              exceptionHours: { thursday: 'Closed', friday: '9:00AM - 1:00PM' },
            },
          ],
        },
      ],
      'x',
    );
    expect(scheduleStateOn(sched, '2026-12-24')).toBe('closed'); // Thursday → Closed
    expect(scheduleStateOn(sched, '2026-12-25')).toBe('open'); // Friday → has a time range
  });
});

describe('openStateOn (park-level uses Park Hours, not road closures)', () => {
  it('park stays open in winter even when the road is closed', () => {
    const schedules = parseOperatingHours(GTSR, 'glac');
    expect(openStateOn(schedules, '2026-12-01')).toBe('open');
  });
  it('unknown when there is no data', () => {
    expect(openStateOn([], '2026-12-01')).toBe('unknown');
  });
});

describe('summarizeClosures', () => {
  it('summarizes a named full closure window', () => {
    const schedules = parseOperatingHours(GTSR, 'glac');
    expect(summarizeClosures(schedules)).toBe('Going-to-the-Sun Road: closed Oct 15 – May 20');
  });
  it('returns null when nothing is closed', () => {
    expect(summarizeClosures(parseOperatingHours([GTSR[0]], 'glac'))).toBeNull();
  });
});

describe('seasons', () => {
  it('monthToSeason', () => {
    expect(monthToSeason(1)).toBe('winter');
    expect(monthToSeason(7)).toBe('summer');
    expect(monthToSeason(10)).toBe('fall');
  });
  it('monthsInRange wraps the year', () => {
    expect(monthsInRange('2026-10-15', '2027-05-20')).toEqual([10, 11, 12, 1, 2, 3, 4, 5]);
    expect(monthsInRange('2026-06-01', '2026-08-31')).toEqual([6, 7, 8]);
  });
  it('a year-round park is open in all four seasons (road closure does not close the park)', () => {
    expect(deriveOpenSeasons(parseOperatingHours(GTSR, 'glac')).sort()).toEqual(
      ['fall', 'spring', 'summer', 'winter'].sort(),
    );
  });
  it('a fully-closed standard week with no exceptions has no open seasons', () => {
    const closed = [
      {
        name: 'Park Hours',
        standardHours: {
          monday: 'Closed', tuesday: 'Closed', wednesday: 'Closed', thursday: 'Closed',
          friday: 'Closed', saturday: 'Closed', sunday: 'Closed',
        },
        exceptions: [],
      },
    ];
    expect(deriveOpenSeasons(parseOperatingHours(closed, 'x'))).toEqual([]);
  });

  it('a park-hours winter closure removes winter', () => {
    const northRim = [
      {
        name: 'Park Hours',
        standardHours: {
          monday: 'All Day',
          tuesday: 'All Day',
          wednesday: 'All Day',
          thursday: 'All Day',
          friday: 'All Day',
          saturday: 'All Day',
          sunday: 'All Day',
        },
        exceptions: [
          {
            name: 'North Rim winter',
            startDate: '2026-12-01',
            endDate: '2027-02-28',
            exceptionHours: {
              monday: 'Closed',
              tuesday: 'Closed',
              wednesday: 'Closed',
              thursday: 'Closed',
              friday: 'Closed',
              saturday: 'Closed',
              sunday: 'Closed',
            },
          },
        ],
      },
    ];
    expect(deriveOpenSeasons(parseOperatingHours(northRim, 'grca'))).not.toContain('winter');
    expect(deriveOpenSeasons(parseOperatingHours(northRim, 'grca'))).toContain('summer');
  });
  it('unknown standard hours do not imply year-round opening', () => {
    const seasonal = [
      {
        name: 'Park Hours',
        standardHours: {
          monday: '',
          tuesday: '',
          wednesday: '',
          thursday: '',
          friday: '',
          saturday: '',
          sunday: '',
        },
        exceptions: [
          {
            name: 'Summer season',
            startDate: '2026-06-01',
            endDate: '2026-08-31',
            exceptionHours: {
              monday: 'All Day',
              tuesday: 'All Day',
              wednesday: 'All Day',
              thursday: 'All Day',
              friday: 'All Day',
              saturday: 'All Day',
              sunday: 'All Day',
            },
          },
        ],
      },
    ];
    expect(deriveOpenSeasons(parseOperatingHours(seasonal, 'x'))).toEqual(['summer']);
  });
});
