'use client';
import { Badge, Box, Card, HStack, SimpleGrid, Stack, Text } from '@chakra-ui/react';
import { LuMoon, LuSparkles, LuSunrise } from 'react-icons/lu';
import { StatCard } from '../ui/stat-card';
import { SectionHeading } from '../ui/section-heading';
// Type-only import — never pull lib/conditions' server deps (neo4j/astronomy-engine) into this client bundle.
import type { ConditionsCardData, TempBand } from '../../lib/conditions';

// Inlined client-safe label (mirror of lib/conditions#tempBandLabel) to keep this module server-dep-free.
const TEMP_BAND_LABEL: Record<TempBand, string> = {
  cold: 'Cold · below 32°F',
  cool: 'Cool · 32–50°F',
  mild: 'Mild · 50–70°F',
  warm: 'Warm · 70–85°F',
  hot: 'Hot · 85°F+',
};

/**
 * Conditions/dashboard chat cards (ADR-042) — the data-dense "instruments" that promote the ranger's
 * structured tool output to UI. Pure presentational: every number arrives already computed server-side
 * (graph + ephemeris), never parsed from prose. `'use client'` because the count-up motion (ADR-044)
 * will hook these later; markup is theme-token-driven (no color-mode branch), so no mounted gate needed.
 */

function stars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
}

/** Dark-Sky Scorecard — from the `dark_sky_card` tool envelope. Astro tiles render only when present. */
export function DarkSkyCard({ data }: { data: Record<string, unknown> }) {
  const d = data as {
    park?: string;
    bortleScale?: number | null;
    rating?: { stars: number; label: string } | null;
    sqmEstimate?: number | null;
    bestMonths?: string | null;
    crowdLevel?: string | null;
    astro?: { moonIllumination: number; moonPhase: string; moonEmoji: string; darkHours: number | null } | null;
  };
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        {d.park ? (
          <Text fontWeight="semibold" fontFamily="heading" mb={2}>
            {d.park} · dark-sky scorecard
          </Text>
        ) : null}
        <SimpleGrid minChildWidth="130px" gap={2}>
          {d.rating ? (
            <StatCard
              label="Dark sky"
              value={stars(d.rating.stars)}
              hint={`${d.rating.label}${d.bortleScale != null ? ` · Bortle ${d.bortleScale}` : ''}`}
              icon={LuSparkles}
              tone="accent"
            />
          ) : null}
          {d.sqmEstimate != null ? (
            <StatCard label="SQM" value={`~${d.sqmEstimate}`} hint="Est. from Bortle (mag/arcsec²)" tone="accent" />
          ) : null}
          {d.bestMonths ? <StatCard label="Best months" value={d.bestMonths} /> : null}
          {d.crowdLevel ? <StatCard label="Crowds" value={d.crowdLevel} /> : null}
          {d.astro ? (
            <StatCard
              label="Moon"
              value={`${d.astro.moonEmoji} ${d.astro.moonIllumination}%`}
              hint={d.astro.moonPhase}
              icon={LuMoon}
              tone="accent"
            />
          ) : null}
          {d.astro?.darkHours != null ? (
            <StatCard label="Dark hours" value={`${d.astro.darkHours} h`} hint="astronomical night" tone="accent" />
          ) : null}
        </SimpleGrid>
      </Card.Body>
    </Card.Root>
  );
}

/** Tonight's astronomy — from the `astro_card` tool envelope (get_astro). */
export function AstroCard({ data }: { data: Record<string, unknown> }) {
  const d = data as {
    park?: string;
    bortle?: number | null;
    sqm?: { sqm: number; label: string } | null;
    moon?: { phaseName: string; illuminationPct: number; emoji: string };
    sun?: { rise: string | null; set: string | null };
    darkHours?: { hours: number | null };
    galacticCore?: { rise: string | null; riseAzimuthDeg: number | null; maxAltitudeDeg: number | null; visible: boolean };
  };
  const t = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        {d.park ? (
          <Text fontWeight="semibold" fontFamily="heading" mb={2}>
            {d.park} · tonight's sky
          </Text>
        ) : null}
        <Stack gap={1.5} fontSize="sm">
          {d.moon ? (
            <HStack gap={2}>
              <LuMoon />
              <Text>
                {d.moon.emoji} {d.moon.phaseName} · {d.moon.illuminationPct}% illuminated
              </Text>
            </HStack>
          ) : null}
          {d.sun ? (
            <HStack gap={2}>
              <LuSunrise />
              <Text>
                Sunrise {t(d.sun.rise)} · sunset {t(d.sun.set)}
              </Text>
            </HStack>
          ) : null}
          {d.darkHours?.hours != null ? (
            <Text color="fg.muted">{d.darkHours.hours} h of astronomical darkness</Text>
          ) : null}
          {d.galacticCore ? (
            <Text color="fg.muted">
              {d.galacticCore.visible
                ? `Milky-Way core rises ${t(d.galacticCore.rise)}${
                    d.galacticCore.riseAzimuthDeg != null ? ` (az ${d.galacticCore.riseAzimuthDeg}°)` : ''
                  }${d.galacticCore.maxAltitudeDeg != null ? `, peaks ${d.galacticCore.maxAltitudeDeg}° up` : ''}`
                : 'Milky-Way core stays below the horizon tonight'}
            </Text>
          ) : null}
          {d.sqm ? (
            <Text color="fg.muted">
              SQM ~{d.sqm.sqm} <Text as="span" color="fg.subtle">({d.sqm.label})</Text>
            </Text>
          ) : null}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

/** Current + 3-day weather — from the `weather_card` tool envelope. */
export function WeatherCard({ data }: { data: Record<string, unknown> }) {
  const d = data as {
    park?: string;
    currentTempF?: number | null;
    condition?: string;
    emoji?: string;
    daily?: { date: string; hiF: number; loF: number; emoji: string }[];
  };
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        <HStack justify="space-between" mb={2} wrap="wrap" gap={2}>
          <Text fontWeight="semibold" fontFamily="heading">
            {d.park ? `${d.park} · weather` : 'Weather'}
          </Text>
          {d.currentTempF != null ? (
            <Text fontSize="lg" fontWeight="semibold">
              {d.emoji} {d.currentTempF}°F
            </Text>
          ) : null}
        </HStack>
        {d.daily?.length ? (
          <HStack gap={3} wrap="wrap">
            {d.daily.map((day) => (
              <Stack key={day.date} gap={0} align="center" minW="48px">
                <Text fontSize="xs" color="fg.muted">
                  {new Date(day.date).toLocaleDateString([], { weekday: 'short' })}
                </Text>
                <Text>{day.emoji}</Text>
                <Text fontSize="xs">
                  {day.hiF}°/{day.loF}°
                </Text>
              </Stack>
            ))}
          </HStack>
        ) : null}
      </Card.Body>
    </Card.Root>
  );
}

const BAND_TONE: Record<TempBand, 'brand' | 'accent' | 'neutral'> = {
  cold: 'accent',
  cool: 'accent',
  mild: 'neutral',
  warm: 'brand',
  hot: 'brand',
};

/** One stop's conditions — the reusable unit the Trip Dashboard composes. */
export function ConditionsCard({ data }: { data: Record<string, unknown> }) {
  const d = data as unknown as ConditionsCardData;
  return (
    <Card.Root variant="outline" size="sm">
      <Card.Body p={3}>
        <HStack gap={2} mb={2}>
          {d.order != null ? (
            <Badge colorPalette="pine" variant="solid" borderRadius="full" minW="20px" justifyContent="center">
              {d.order + 1}
            </Badge>
          ) : null}
          <Text fontWeight="semibold" fontFamily="heading">
            {d.parkName}
          </Text>
        </HStack>
        <SimpleGrid columns={2} gap={2}>
          {d.darkSky?.rating ? (
            <StatCard
              label="Dark sky"
              value={stars(d.darkSky.rating.stars)}
              hint={d.darkSky.bortleScale != null ? `Bortle ${d.darkSky.bortleScale}` : undefined}
              icon={LuSparkles}
              tone="accent"
            />
          ) : null}
          {d.weather ? (
            <StatCard
              label="Weather"
              value={`${d.weather.emoji} ${d.weather.currentTempF != null ? `${d.weather.currentTempF}°` : d.weather.condition}`}
              hint={d.weather.hi != null ? `${d.weather.hi}°/${d.weather.lo}°` : undefined}
            />
          ) : null}
          {d.crowdLevel ? <StatCard label="Crowds" value={d.crowdLevel} /> : null}
          {d.tempBand ? <StatCard label="Temps" value={d.tempBand} hint={TEMP_BAND_LABEL[d.tempBand]} tone={BAND_TONE[d.tempBand]} /> : null}
        </SimpleGrid>
        {d.bestMonths ? (
          <Text fontSize="xs" color="fg.muted" mt={2}>
            Quietest: {d.bestMonths}
          </Text>
        ) : null}
      </Card.Body>
    </Card.Root>
  );
}

/** Trip Dashboard — per-stop conditions for a built trip (`trip_dashboard` envelope). */
export function TripDashboardCard({ data }: { data: Record<string, unknown> }) {
  const d = data as {
    tripName?: string;
    stops?: ConditionsCardData[];
  };
  const stops = d.stops ?? [];
  if (!stops.length) return null;
  return (
    <Box my={2}>
      <SectionHeading title={d.tripName ? `${d.tripName} · conditions` : 'Trip conditions'} size="md" />
      <Stack gap={2} mt={2}>
        {stops.map((s) => (
          <ConditionsCard key={`${s.parkCode}-${s.order ?? 0}`} data={s as unknown as Record<string, unknown>} />
        ))}
      </Stack>
    </Box>
  );
}
