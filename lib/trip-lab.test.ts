import { describe, it, expect } from 'vitest';
import { addDaysIso, maxFee, riskFromAlerts, round1 } from './trip-lab';
import { tripBriefHtml } from './trip-brief-html';
import type { TripBrief } from './trip-lab';

describe('trip-lab pure helpers (ADR-056)', () => {
  it('round1 rounds to a tenth', () => {
    expect(round1(12.34)).toBe(12.3);
    expect(round1(12.36)).toBe(12.4);
  });

  it('addDaysIso advances UTC dates and rolls months/years/leap days', () => {
    expect(addDaysIso('2026-06-23', 0)).toBe('2026-06-23');
    expect(addDaysIso('2026-06-23', 9)).toBe('2026-07-02');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29'); // 2028 is a leap year
  });

  it('maxFee takes the priciest line and tolerates junk', () => {
    expect(maxFee([{ cost: '20' }, { cost: '35' }, { cost: 'free' }])).toBe(35);
    expect(maxFee([])).toBe(0);
    expect(maxFee(null)).toBe(0);
    expect(maxFee([{ cost: 30 }])).toBe(30);
  });

  it('riskFromAlerts maps active alert load to a 0–3 score + label', () => {
    expect(riskFromAlerts(0)).toEqual({ score: 0, label: 'none' });
    expect(riskFromAlerts(1)).toEqual({ score: 1, label: 'low' });
    expect(riskFromAlerts(3)).toEqual({ score: 2, label: 'moderate' });
    expect(riskFromAlerts(9)).toEqual({ score: 3, label: 'high' });
  });
});

describe('tripBriefHtml (ADR-057)', () => {
  const brief: TripBrief = {
    tripId: 't1',
    name: 'Utah Dark Skies',
    startDate: '2026-09-10',
    endDate: '2026-09-15',
    stops: [
      {
        order: 0,
        name: 'Bryce Canyon',
        parkCode: 'brca',
        designation: 'National Park',
        lat: 37.5931,
        lng: -112.1871,
        entranceFee: 35,
        directionsUrl: 'https://nps.gov/brca/directions',
        alerts: [{ category: 'Closure', title: 'Rim Trail closed' }],
        visitorCenters: ['Bryce Canyon VC'],
        campgrounds: [{ name: 'North Campground', reservationUrl: null }],
        driveToNext: { miles: 72, minutes: 95 },
        hikes: [{ name: 'Navajo Loop', lengthMiles: 1.3, estTimeHrs: 1, difficulty: 'moderate', permitRequired: false }],
        lodging: { name: 'North Campground', feeUSD: 30, reservationUrl: 'https://recreation.gov/x' },
      },
    ],
  };

  it('produces a self-contained printable doc with the key facts', () => {
    const html = tripBriefHtml(brief);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Utah Dark Skies');
    expect(html).toContain('Bryce Canyon');
    expect(html).toContain('37.59310, -112.18710'); // coordinates
    expect(html).toContain('$35 vehicle entrance');
    expect(html).toContain('Rim Trail closed'); // gate/closure note
    expect(html).toContain('North Campground');
    expect(html).toContain('72 mi · 95 min'); // drive to next
    expect(html).toContain('Navajo Loop'); // hike attached to the stop (ADR-071)
    expect(html).toContain('1.3 mi · ~1 hr · moderate'); // hike stats
    expect(html).toContain('not an official safety source'); // honesty footer
  });

  it('escapes HTML to avoid injection from names', () => {
    const evil: TripBrief = { ...brief, name: '<script>alert(1)</script>', stops: [] };
    const html = tripBriefHtml(evil);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
