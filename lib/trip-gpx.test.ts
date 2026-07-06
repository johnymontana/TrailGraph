import { describe, it, expect } from 'vitest';
import { tripToGpx } from './trip-gpx';

const TIME = '2026-06-23T00:00:00Z';

function trip(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    name: 'Big Sky Loop',
    startDate: '2026-07-01',
    endDate: null,
    stops: [
      { id: 's1', order: 0, kind: 'park', parkName: 'Yellowstone', lat: 44.6, lng: -110.5, driveTo: { miles: 84.4, minutes: 95.2, source: 'ors' } },
      { id: 's2', order: 1, kind: 'campground', campgroundName: 'Apgar', lat: 48.5, lng: -113.9, driveTo: null },
      { id: 's3', order: 2, kind: 'custom', name: 'Trailhead', lat: null, lng: null }, // no coords → dropped
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...overrides,
  } as any;
}

describe('tripToGpx (ADR-048)', () => {
  it('drops stops without coordinates and keeps located ones in order', () => {
    const gpx = tripToGpx(trip(), { time: TIME });
    expect((gpx.match(/<wpt /g) ?? []).length).toBe(2); // s3 has no coords
    expect(gpx).toContain('<name>1. Yellowstone</name>');
    expect(gpx).toContain('<name>2. Apgar</name>');
    const trkpts = gpx.match(/<trkpt /g) ?? [];
    expect(trkpts.length).toBe(2);
  });

  it('summarizes the drive leg in the waypoint desc, flagging great-circle as approximate', () => {
    const gpx = tripToGpx(
      trip({ stops: [{ id: 's1', order: 0, kind: 'park', parkName: 'Yellowstone', lat: 44.6, lng: -110.5, driveTo: { miles: 84.4, minutes: 95.2, source: 'great_circle' } }] }),
      { time: TIME },
    );
    expect(gpx).toContain('Drive to next: 84 mi / 95 min (approx)');
  });

  it('names the track and notes the honest geometry caveat in metadata', () => {
    const gpx = tripToGpx(trip(), { time: TIME });
    expect(gpx).toContain('<name>Big Sky Loop route</name>');
    expect(gpx).toContain('straight stop-to-stop connector');
  });

  it('handles a single-stop trip (one waypoint, one-point track)', () => {
    const gpx = tripToGpx(trip({ stops: [{ id: 's1', order: 0, kind: 'park', parkName: 'Solo', lat: 1, lng: 2 }] }), { time: TIME });
    expect((gpx.match(/<wpt /g) ?? []).length).toBe(1);
    expect((gpx.match(/<trkpt /g) ?? []).length).toBe(1);
  });

  // Trip origin (ADR-074): a ⌂ start waypoint + origin-extended route legs.
  it('prepends the origin waypoint and leg, and closes the loop on a round trip', () => {
    const gpx = tripToGpx(
      trip({ origin: { lat: 45.6, lng: -111.0, label: 'Bozeman, MT' }, returnToOrigin: true }),
      { time: TIME },
    );
    expect(gpx).toContain('⌂ Bozeman, MT');
    expect(gpx).toContain('Round trip — the route returns here.');
    // Track: origin + 2 located stops + origin again = 4 points.
    expect((gpx.match(/<trkpt /g) ?? []).length).toBe(4);
    // The first and last track points are the origin.
    const pts = [...gpx.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(pts[0]).toEqual([45.6, -111]);
    expect(pts[pts.length - 1]).toEqual([45.6, -111]);
  });

  it('adds only the start leg when returnToOrigin is off', () => {
    const gpx = tripToGpx(trip({ origin: { lat: 45.6, lng: -111.0, label: 'Bozeman, MT' }, returnToOrigin: false }), { time: TIME });
    expect((gpx.match(/<trkpt /g) ?? []).length).toBe(3); // origin + 2 stops, no closing point
    expect(gpx).not.toContain('Round trip');
  });

  it('ignores the origin when the trip has no located stops (no phantom one-point route)', () => {
    const gpx = tripToGpx(trip({ origin: { lat: 45.6, lng: -111.0, label: 'Bozeman, MT' }, returnToOrigin: true, stops: [] }), { time: TIME });
    expect(gpx).not.toContain('⌂');
    expect((gpx.match(/<trkpt /g) ?? []).length).toBe(0);
  });
});
