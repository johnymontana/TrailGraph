import { generateGPX, type GpxTrackSeg, type GpxWaypoint } from './gpx';
import type { getTrip } from './trips';

type Trip = NonNullable<Awaited<ReturnType<typeof getTrip>>>;

/**
 * Adapt a hydrated trip (the reified :Stop model, ADR-003) into GPX (ADR-048). Mirrors lib/trip-ics.ts:
 * a type-only `getTrip` import (no circular value import). Located stops only, in order; one connector
 * track of the stop coordinates. The `:DRIVE_TO` edge caches distance/minutes only (no geometry), so the
 * connector track is a straight line — labeled as such, never faked into road geometry. `opts.hikeTracks`
 * (ADR-071) carries the REAL trail polylines for hikes attached to the trip's stops, read from Blob.
 */
export function tripToGpx(trip: Trip, opts: { time: string; hikeTracks?: GpxTrackSeg[] }): string {
  const stops = (trip.stops ?? []).filter(
    (s): s is NonNullable<typeof s> => !!s && s.lat != null && s.lng != null,
  );

  const waypoints: GpxWaypoint[] = stops.map((s, i) => {
    const label = s.parkName ?? s.campgroundName ?? s.poiTitle ?? s.placeTitle ?? s.name ?? 'Stop';
    const drive = s.driveTo
      ? `Drive to next: ${Math.round(s.driveTo.miles)} mi / ${Math.round(s.driveTo.minutes)} min` +
        (s.driveTo.source === 'great_circle' ? ' (approx)' : '')
      : undefined;
    return {
      lat: s.lat as number,
      lon: s.lng as number,
      name: `${(s.order ?? i) + 1}. ${label}`,
      type: s.kind ?? undefined,
      desc: drive,
    };
  });

  // Lodging waypoints (Campgrounds feature): where you sleep each stop-night, at the campground's own
  // coordinate (the STAYS_AT-nested campground, distinct from the park stop). No live availability in a
  // static artifact — print the booking pointer instead.
  const lodgingWaypoints: GpxWaypoint[] = stops
    .filter((s) => s.lodging && s.lodging.lat != null && s.lodging.lng != null)
    .map((s) => {
      const l = s.lodging!;
      const fee = l.feeUSD != null ? ` · $${l.feeUSD}/night` : '';
      return {
        lat: l.lat as number,
        lon: l.lng as number,
        name: `🏕️ ${l.name}`,
        type: 'campground',
        desc: `Sleeping here${fee}. Verify/book on recreation.gov.`,
      };
    });

  const tracks: GpxTrackSeg[] = [
    { name: `${trip.name ?? 'TrailGraph Trip'} route`, points: stops.map((s) => ({ lat: s.lat as number, lon: s.lng as number })) },
    ...(opts.hikeTracks ?? []),
  ];

  return generateGPX(
    {
      name: trip.name ?? 'TrailGraph Trip',
      time: opts.time,
      desc: 'TrailGraph itinerary. Track is a straight stop-to-stop connector, not turn-by-turn routing. Verify access/closures at nps.gov.',
    },
    [...waypoints, ...lodgingWaypoints],
    tracks,
  );
}
