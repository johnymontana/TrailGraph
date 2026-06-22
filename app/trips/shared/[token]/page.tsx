import { notFound } from 'next/navigation';
import { Box, Heading, Text, Stack, Badge } from '@chakra-ui/react';
import { getSharedTrip } from '../../../../lib/share';
import { TripMap } from '../../../../components/plan/TripMap';

/** Public read-only shared itinerary (C6). No auth — the token grants access. */
export const dynamic = 'force-dynamic';

export default async function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = await getSharedTrip(token);
  if (!shared) notFound();

  const { trip, role } = shared;
  const stops = ((trip.stops ?? []).filter(Boolean) as {
    id: string;
    order: number;
    parkName?: string;
    name?: string;
    lat?: number | null;
    lng?: number | null;
    driveTo?: { miles: number; minutes: number } | null;
  }[]);

  return (
    <Box maxW="3xl" mx="auto" px={{ base: 4, md: 8 }} py={8}>
      <Badge colorPalette="gray" mb={2}>Shared itinerary · read-only{role === 'edit' ? ' (edit link)' : ''}</Badge>
      <Heading size="lg" mb={4}>{trip.name}</Heading>

      {stops.some((s) => s.lat != null && s.lng != null) ? (
        <Box mb={6}>
          <TripMap stops={stops.map((s) => ({ lat: s.lat ?? null, lng: s.lng ?? null, label: s.parkName ?? s.name ?? 'Stop', order: s.order }))} />
        </Box>
      ) : null}

      <Stack gap={1}>
        {stops.map((s, i) => (
          <Box key={s.id}>
            <Text>{i + 1}. {s.parkName ?? s.name ?? 'Stop'}</Text>
            {s.driveTo ? (
              <Text fontSize="xs" color="fg.muted" pl={4}>↓ {Math.round(s.driveTo.miles)} mi · {Math.round(s.driveTo.minutes)} min</Text>
            ) : null}
          </Box>
        ))}
      </Stack>

      <Text fontSize="xs" color="fg.muted" mt={8}>
        Planned with TrailGraph. Not an official NPS source — verify hours, fees, and closures at nps.gov before you go.
      </Text>
    </Box>
  );
}
