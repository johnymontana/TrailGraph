'use client';
import { Badge, Box, Card, HStack, Progress, SimpleGrid, Stack, Tabs, Text } from '@chakra-ui/react';
import { LuCamera, LuCompass, LuMoon, LuSatellite, LuSparkles, LuStar, LuSunrise, LuTelescope } from 'react-icons/lu';
import { StatCard } from '../ui/stat-card';
import { CountUp } from '../ui/count-up';
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
 * (graph + ephemeris), never parsed from prose. `'use client'` for the count-up motion (ADR-044, via
 * `<CountUp>`); markup is theme-token-driven (no color-mode branch), so no mounted gate needed.
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
            <StatCard
              label="SQM"
              value={<CountUp to={d.sqmEstimate} prefix="~" />}
              hint="Est. from Bortle (mag/arcsec²)"
              tone="accent"
            />
          ) : null}
          {d.bestMonths ? <StatCard label="Best months" value={d.bestMonths} /> : null}
          {d.crowdLevel ? <StatCard label="Crowds" value={d.crowdLevel} /> : null}
          {d.astro ? (
            <StatCard
              label="Moon"
              value={
                <>
                  {d.astro.moonEmoji} <CountUp to={d.astro.moonIllumination} suffix="%" />
                </>
              }
              hint={d.astro.moonPhase}
              icon={LuMoon}
              tone="accent"
            />
          ) : null}
          {d.astro?.darkHours != null ? (
            <StatCard
              label="Dark hours"
              value={<CountUp to={d.astro.darkHours} suffix=" h" />}
              hint="astronomical night"
              tone="accent"
            />
          ) : null}
        </SimpleGrid>
      </Card.Body>
    </Card.Root>
  );
}

// --- Astro Command Center (ADR-055) --------------------------------------------------------------

interface AstroCardData {
  park?: string;
  bortle?: number | null;
  sqm?: { sqm: number; label: string } | null;
  moon?: { phaseName: string; illuminationPct: number; emoji: string };
  sun?: { rise: string | null; set: string | null };
  darkHours?: { hours: number | null; start?: string | null; end?: string | null };
  galacticCore?: { rise: string | null; riseAzimuthDeg: number | null; maxAltitudeDeg: number | null; visible: boolean };
  meteorShowers?: {
    name: string; zhr: number; radiant: string; peakDate: string; daysToPeak: number; intensityPct: number; isPeakTonight: boolean;
  }[];
  satellitePasses?: {
    name: string; start: string; peak: string; end: string; maxElevationDeg: number; startAzimuthDeg: number; endAzimuthDeg: number; durationMin: number; visible: boolean;
  }[];
  satellitesAvailable?: boolean;
  shot?: {
    foregroundAzimuthDeg: number; coreVisible: boolean; aligned: boolean; toleranceDeg: number;
    bestAlignment: { time: string; azimuthDeg: number; altitudeDeg: number; deltaDeg: number } | null;
    moonIlluminationPct: number; moonInterference: 'none' | 'low' | 'moderate' | 'high'; window: { hours: number | null }; advice: string;
  } | null;
}

const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';

/** Degrees → 8-point compass label (N, NE, E, …). Pure. */
function compass(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/**
 * Shot-planning azimuth dial: a compass rose with the foreground bearing (pine) and the Milky-Way core's
 * azimuth at best alignment (trail). Closing the gap between the two needles == the core sits over the
 * foreground. SVG with brand-token colors via CSS vars (the canvas can't read Chakra tokens directly).
 */
function AzimuthCompass({ foregroundDeg, coreDeg }: { foregroundDeg: number; coreDeg: number | null }) {
  const size = 132;
  const c = size / 2;
  const r = c - 16;
  const at = (deg: number, rad: number) => ({
    x: c + rad * Math.sin((deg * Math.PI) / 180),
    y: c - rad * Math.cos((deg * Math.PI) / 180),
  });
  const fg = at(foregroundDeg, r - 6);
  const core = coreDeg != null ? at(coreDeg, r - 6) : null;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      style={{ color: 'var(--chakra-colors-fg-muted)', flexShrink: 0 }}
    >
      <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={1.5} />
      {['N', 'E', 'S', 'W'].map((lbl, i) => {
        const p = at(i * 90, r + 9);
        return (
          <text key={lbl} x={p.x} y={p.y} fontSize={9} fill="currentColor" textAnchor="middle" dominantBaseline="central">
            {lbl}
          </text>
        );
      })}
      <line x1={c} y1={c} x2={fg.x} y2={fg.y} stroke="var(--chakra-colors-pine-solid)" strokeWidth={3} strokeLinecap="round" />
      <circle cx={fg.x} cy={fg.y} r={3} fill="var(--chakra-colors-pine-solid)" />
      {core ? (
        <>
          <line x1={c} y1={c} x2={core.x} y2={core.y} stroke="var(--chakra-colors-trail-solid)" strokeWidth={2.5} strokeDasharray="4 3" strokeLinecap="round" />
          <circle cx={core.x} cy={core.y} r={3} fill="var(--chakra-colors-trail-solid)" />
        </>
      ) : null}
      <circle cx={c} cy={c} r={2.5} fill="currentColor" />
    </svg>
  );
}

function TonightTab({ d }: { d: AstroCardData }) {
  return (
    <Stack gap={1.5} fontSize="sm">
      {d.moon ? (
        <HStack gap={2}>
          <LuMoon />
          <Text>
            {d.moon.emoji} {d.moon.phaseName} · <CountUp to={d.moon.illuminationPct} suffix="%" /> illuminated
          </Text>
        </HStack>
      ) : null}
      {d.sun ? (
        <HStack gap={2}>
          <LuSunrise />
          <Text>
            Sunrise {fmtTime(d.sun.rise)} · sunset {fmtTime(d.sun.set)}
          </Text>
        </HStack>
      ) : null}
      {d.darkHours?.hours != null ? (
        <Text color="fg.muted">
          <CountUp to={d.darkHours.hours} suffix=" h" /> of astronomical darkness
        </Text>
      ) : null}
      {d.galacticCore ? (
        <Text color="fg.muted">
          {d.galacticCore.visible
            ? `Milky-Way core rises ${fmtTime(d.galacticCore.rise)}${
                d.galacticCore.riseAzimuthDeg != null ? ` (az ${d.galacticCore.riseAzimuthDeg}° ${compass(d.galacticCore.riseAzimuthDeg)})` : ''
              }${d.galacticCore.maxAltitudeDeg != null ? `, peaks ${d.galacticCore.maxAltitudeDeg}° up` : ''}`
            : 'Milky-Way core stays below the horizon tonight'}
        </Text>
      ) : null}
      {d.sqm ? (
        <Text color="fg.muted">
          SQM <CountUp to={d.sqm.sqm} prefix="~" /> <Text as="span" color="fg.subtle">({d.sqm.label})</Text>
        </Text>
      ) : null}
    </Stack>
  );
}

function ShowersTab({ showers, moonPct }: { showers: NonNullable<AstroCardData['meteorShowers']>; moonPct?: number }) {
  return (
    <Stack gap={3} fontSize="sm">
      {moonPct != null && moonPct > 50 ? (
        <Text fontSize="xs" color="fg.muted">
          🌕 A {moonPct}% moon will wash out fainter meteors tonight.
        </Text>
      ) : null}
      {showers.map((s) => (
        <Box key={s.name}>
          <HStack justify="space-between" mb={1} wrap="wrap" gap={1}>
            <HStack gap={2}>
              <LuStar />
              <Text fontWeight="semibold">{s.name}</Text>
              {s.isPeakTonight ? <Badge colorPalette="trail" variant="solid">peak tonight</Badge> : null}
            </HStack>
            <Text fontSize="xs" color="fg.muted">
              ~<CountUp to={s.zhr} />/hr at peak · radiant {s.radiant}
            </Text>
          </HStack>
          <Progress.Root value={s.intensityPct} size="sm" colorPalette="trail">
            <Progress.Track>
              <Progress.Range />
            </Progress.Track>
          </Progress.Root>
          <Text fontSize="xs" color="fg.subtle" mt={0.5}>
            {s.isPeakTonight
              ? 'peaking tonight'
              : s.daysToPeak > 0
                ? `peaks in ${s.daysToPeak} day${s.daysToPeak === 1 ? '' : 's'} (${s.peakDate})`
                : `peaked ${-s.daysToPeak} day${s.daysToPeak === -1 ? '' : 's'} ago`}
          </Text>
        </Box>
      ))}
    </Stack>
  );
}

function PassesTab({ passes, available }: { passes: NonNullable<AstroCardData['satellitePasses']>; available?: boolean }) {
  if (!passes.length) {
    return (
      <Text fontSize="sm" color="fg.muted">
        {available === false ? 'Satellite data is unavailable right now.' : 'No bright passes overhead this night.'}
      </Text>
    );
  }
  return (
    <Stack gap={2} fontSize="sm">
      {passes.map((p, i) => (
        <HStack key={`${p.name}-${i}`} justify="space-between" wrap="wrap" gap={2}>
          <HStack gap={2}>
            <LuSatellite />
            <Text fontWeight="semibold">{p.name}</Text>
            {p.visible ? <Badge colorPalette="trail" variant="solid">visible</Badge> : null}
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            {fmtTime(p.peak)} · max <CountUp to={p.maxElevationDeg} suffix="°" /> · {compass(p.startAzimuthDeg)}→{compass(p.endAzimuthDeg)} · {p.durationMin} min
          </Text>
        </HStack>
      ))}
    </Stack>
  );
}

function ShotTab({ shot }: { shot: NonNullable<AstroCardData['shot']> }) {
  const b = shot.bestAlignment;
  return (
    <Stack gap={3} fontSize="sm">
      <HStack gap={3} align="start" wrap="wrap">
        <AzimuthCompass foregroundDeg={shot.foregroundAzimuthDeg} coreDeg={b?.azimuthDeg ?? null} />
        <Stack gap={1} flex="1" minW="160px">
          <HStack gap={2} wrap="wrap">
            <Badge colorPalette={shot.aligned ? 'pine' : 'sand'} variant="solid">
              {shot.aligned ? 'aligned' : 'reframe'}
            </Badge>
            <Badge colorPalette={shot.moonInterference === 'none' || shot.moonInterference === 'low' ? 'trail' : 'orange'}>
              moon: {shot.moonInterference}
            </Badge>
          </HStack>
          <HStack gap={2} fontSize="xs" color="fg.muted">
            <Box as="span" color="pine.fg">▬ foreground {shot.foregroundAzimuthDeg}° {compass(shot.foregroundAzimuthDeg)}</Box>
          </HStack>
          {b ? (
            <HStack gap={2} fontSize="xs" color="fg.muted">
              <Box as="span" color="trail.fg">▬ core {b.azimuthDeg}° {compass(b.azimuthDeg)} at {b.altitudeDeg}° up</Box>
            </HStack>
          ) : null}
        </Stack>
      </HStack>
      {b ? (
        <SimpleGrid columns={3} gap={2}>
          <StatCard label="Best time" value={fmtTime(b.time)} icon={LuCamera} tone="accent" />
          <StatCard label="Core altitude" value={<CountUp to={b.altitudeDeg} suffix="°" />} tone="accent" />
          <StatCard label="Off-target" value={<CountUp to={b.deltaDeg} suffix="°" />} tone={shot.aligned ? 'brand' : 'neutral'} />
        </SimpleGrid>
      ) : null}
      <Text color="fg.muted">{shot.advice}</Text>
    </Stack>
  );
}

/**
 * Astro Command Center — the `astro_card` tool envelope (get_astro / plan_astro_shot), rebuilt into a
 * tabbed instrument (ADR-055): Tonight always; Showers / Passes / Shot appear only when the tool returned
 * that data. Every number arrives precomputed server-side (ephemeris + SGP4); count-ups make them feel
 * alive. We keep the `astro_card` kind (not a new `astro_command`) so existing wiring/instructions hold.
 */
export function AstroCard({ data }: { data: Record<string, unknown> }) {
  const d = data as AstroCardData;
  const showers = d.meteorShowers ?? [];
  const passes = d.satellitePasses ?? [];
  const hasPasses = passes.length > 0 || d.satellitesAvailable === false;
  const hasShot = !!d.shot;
  const defaultTab = hasShot ? 'shot' : 'tonight';
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        {d.park ? (
          <Text fontWeight="semibold" fontFamily="heading" mb={2}>
            {d.park} · tonight's sky
          </Text>
        ) : null}
        <Tabs.Root defaultValue={defaultTab} size="sm" variant="line" colorPalette="trail" lazyMount>
          <Tabs.List>
            <Tabs.Trigger value="tonight">
              <LuTelescope /> Tonight
            </Tabs.Trigger>
            {showers.length ? (
              <Tabs.Trigger value="showers">
                <LuStar /> Showers
              </Tabs.Trigger>
            ) : null}
            {hasPasses ? (
              <Tabs.Trigger value="passes">
                <LuSatellite /> Passes
              </Tabs.Trigger>
            ) : null}
            {hasShot ? (
              <Tabs.Trigger value="shot">
                <LuCompass /> Shot
              </Tabs.Trigger>
            ) : null}
          </Tabs.List>
          <Tabs.Content value="tonight" pt={3}>
            <TonightTab d={d} />
          </Tabs.Content>
          {showers.length ? (
            <Tabs.Content value="showers" pt={3}>
              <ShowersTab showers={showers} moonPct={d.moon?.illuminationPct} />
            </Tabs.Content>
          ) : null}
          {hasPasses ? (
            <Tabs.Content value="passes" pt={3}>
              <PassesTab passes={passes} available={d.satellitesAvailable} />
            </Tabs.Content>
          ) : null}
          {hasShot ? (
            <Tabs.Content value="shot" pt={3}>
              <ShotTab shot={d.shot!} />
            </Tabs.Content>
          ) : null}
        </Tabs.Root>
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
