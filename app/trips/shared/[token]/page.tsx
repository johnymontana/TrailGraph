import { notFound } from 'next/navigation';
import { Badge, Box, Card, Container, Heading, HStack, Stack, Text } from '@chakra-ui/react';
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
    <Container maxW="3xl" px={{ base: 4, md: 8 }} py={{ base: 8, md: 12 }}>
      <Badge colorPalette="pine" variant="subtle" mb={3}>
        Shared itinerary · read-only{role === 'edit' ? ' (edit link)' : ''}
      </Badge>
      <Heading as="h1" size="2xl" mb={6}>{trip.name}</Heading>

      {stops.some((s) => s.lat != null && s.lng != null) ? (
        <Box mb={6} borderRadius="l2" overflow="hidden" borderWidth="1px" borderColor="border">
          <TripMap stops={stops.map((s) => ({ lat: s.lat ?? null, lng: s.lng ?? null, label: s.parkName ?? s.name ?? 'Stop', order: s.order }))} />
        </Box>
      ) : null}

      <Stack gap={2}>
        {stops.map((s, i) => (
          <Card.Root key={s.id} variant="outline" size="sm">
            <Card.Body p={3}>
              <HStack gap={3} align="center">
                <Badge colorPalette="pine" variant="solid" borderRadius="full" minW="24px" h="24px" justifyContent="center">
                  {i + 1}
                </Badge>
                <Box>
                  <Text fontWeight="medium" fontFamily="heading">{s.parkName ?? s.name ?? 'Stop'}</Text>
                  {s.driveTo ? (
                    <Text fontSize="xs" color="fg.muted">↓ {Math.round(s.driveTo.miles)} mi · {Math.round(s.driveTo.minutes)} min drive</Text>
                  ) : null}
                </Box>
              </HStack>
            </Card.Body>
          </Card.Root>
        ))}
      </Stack>

      <Text fontSize="xs" color="fg.muted" mt={8}>
        Planned with TrailGraph. Not an official NPS source — verify hours, fees, and closures at nps.gov before you go.
      </Text>
    </Container>
  );
}
