import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * tripMetrics composes the trip service + ephemeris + the external NPS alerts call. We mock the I/O so we
 * can assert the `skipAlerts` behavior added for the cheap before/after edit snapshot (P1.1) — the edit
 * diff must NOT pay the external checkTripAlerts call twice per add_stop. Kept in its own file so the
 * module mocks don't leak into trip-lab.test.ts's mock-free pure-helper / tripBriefHtml tests.
 */
vi.mock('./neo4j', () => ({ readGraph: vi.fn(), writeGraph: vi.fn() }));
vi.mock('./trips', () => ({
  getTrip: vi.fn(),
  tripCost: vi.fn(),
  checkTripAlerts: vi.fn(),
  recomputeSegments: vi.fn(),
}));
vi.mock('./queries', () => ({ parkDetail: vi.fn() }));
vi.mock('./datasources', () => ({ getAstro: vi.fn() }));

import { tripMetrics } from './trip-lab';
import { readGraph } from './neo4j';
import { getTrip, tripCost, checkTripAlerts } from './trips';
import { getAstro } from './datasources';

const mockRead = vi.mocked(readGraph);
const mockGetTrip = vi.mocked(getTrip);
const mockCost = vi.mocked(tripCost);
const mockAlerts = vi.mocked(checkTripAlerts);
const mockAstro = vi.mocked(getAstro);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTrip.mockResolvedValue({
    id: 't1',
    name: 'Test',
    startDate: '2026-09-10',
    endDate: null,
    stops: [
      { id: 's1', order: 0, kind: 'park', day: 1, nights: 0, name: 'A', parkName: 'A', lat: 38, lng: -110, driveTo: { miles: 10, minutes: 20, source: 'great_circle' } },
      { id: 's2', order: 1, kind: 'park', day: 2, nights: 0, name: 'B', parkName: 'B', lat: 39, lng: -111, driveTo: { miles: 30, minutes: 40, source: 'great_circle' } },
    ],
  } as never);
  mockRead.mockResolvedValue([{ version: 1, parentId: null }] as never);
  mockAstro.mockReturnValue({ darkHours: { hours: 5 } } as never);
  mockCost.mockResolvedValue({ total: 30 } as never);
  mockAlerts.mockResolvedValue([] as never);
});

describe('tripMetrics skipAlerts (P1.1 — cheap before/after edit snapshot)', () => {
  it('skips the external checkTripAlerts call and reports zero risk when skipAlerts is set', async () => {
    const m = await tripMetrics('u1', 't1', { skipAlerts: true });
    expect(m).not.toBeNull();
    expect(mockAlerts).not.toHaveBeenCalled(); // the whole point: no external NPS fetch per edit
    expect(m!.alertCount).toBe(0);
    expect(m!.riskScore).toBe(0);
    expect(m!.riskLabel).toBe('none');
    // …but the rest of the comparable metrics are still computed from the graph + ephemeris.
    expect(m!.stops).toBe(2);
    expect(m!.parks).toBe(2);
    expect(m!.driveMiles).toBe(40);
    expect(m!.costTotal).toBe(30);
    expect(m!.darkHoursTotal).toBe(10); // 2 park stops × 5 dark hours (mocked)
  });

  it('DOES call checkTripAlerts by default (compare_trips needs real risk)', async () => {
    mockAlerts.mockResolvedValue([{ alerts: [{}, {}] }] as never);
    const m = await tripMetrics('u1', 't1');
    expect(mockAlerts).toHaveBeenCalledTimes(1);
    expect(m!.alertCount).toBe(2);
    expect(m!.riskScore).toBeGreaterThan(0);
  });

  it('returns null when the trip is gone (so the edit diff is simply omitted)', async () => {
    mockGetTrip.mockResolvedValue(null as never);
    expect(await tripMetrics('u1', 'missing', { skipAlerts: true })).toBeNull();
  });
});
