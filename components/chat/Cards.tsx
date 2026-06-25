'use client';
import { useState } from 'react';
import { Badge, Box, Card, Icon, Input, Text, Stack, HStack, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { LuTriangleAlert } from 'react-icons/lu';
import { DarkSkyCard, WeatherCard, AstroCard, ConditionsCard, TripDashboardCard } from '../conditions/ConditionCards';
import { TripDiffCard } from '../plan/TripDiffCard';
import { SkyLeaderboard, type LeaderboardEntry } from '../collective/SkyLeaderboard';
import { DigestItems, type DigestItemView } from '../inbox/DigestItems';
import { ProvenanceEdges } from '../parks/ProvenanceEdges';
import { SourceInfo } from '../ui/SourceInfo';
import { decodeEntities } from '../../lib/html-entities';
import { WATCH_CAP } from '../../lib/watch-cap';

/** Renders a tool's `{kind,data}` output as a structured card (ADR-013, D5). Graph-grounded only.
 * `onAnswer` is passed only for interactive cards (the `question_card`) and only on the latest turn — it
 * sends the user's chosen option back to the ranger as their next message. */
export function ToolCard({ kind, data: raw, onAnswer }: { kind: string; data: unknown; onAnswer?: (text: string, clientContext?: Record<string, string>) => void }) {
  const data = (raw ?? {}) as Record<string, unknown>;
  // Surface tool errors instead of silently dropping them (R2 §3.1 — the blank "save as trip" turn).
  if (typeof data.error === 'string') {
    return (
      <HStack
        borderWidth="1px"
        borderColor="orange.emphasized"
        borderRadius="l2"
        p={3}
        my={2}
        bg="orange.subtle"
        gap={2}
        align="start"
      >
        <Icon as={LuTriangleAlert} color="orange.fg" mt={0.5} flexShrink={0} />
        <Text fontSize="sm" color="orange.fg">{data.error}</Text>
      </HStack>
    );
  }
  switch (kind) {
    case 'park_card':
      return <ParkCards data={data} />;
    case 'node_results':
      return <NodeResults data={data} />;
    case 'itinerary_preview':
      return <ItineraryCard data={data} onAnswer={onAnswer} />;
    case 'alert_list':
      return <AlertList data={data} />;
    case 'dark_sky_card':
      return <DarkSkyCard data={data} />;
    case 'weather_card':
      return <WeatherCard data={data} />;
    case 'astro_card':
      return <AstroCard data={data} />;
    case 'conditions_card':
      return <ConditionsCard data={data} />;
    case 'trip_dashboard':
      return <TripDashboardCard data={data} />;
    case 'trip_diff':
      return <TripDiffCard data={data} />;
    case 'leaderboard_card':
      return <LeaderboardCard data={data} />;
    case 'digest_card':
      return <DigestCard data={data} />;
    case 'question_card':
      return <QuestionCard data={data} onAnswer={onAnswer} />;
    case 'watch_list':
      return <WatchListCard data={data} />;
    case 'hours_card':
      return <HoursCard data={data} />;
    case 'budget_card':
      return <BudgetCard data={data} />;
    case 'accessibility_card':
      return <AccessibilityCard data={data} />;
    case 'news_card':
      return <NewsCard data={data} />;
    case 'media_card':
      return <MediaCard data={data} />;
    case 'why_this':
      return (
        <Card.Root variant="subtle" size="sm" my={2}>
          <Card.Body p={3}>
            <Text fontWeight="semibold" fontFamily="heading" mb={2}>
              Why {(data.park as string) ?? 'this park'}?
            </Text>
            <ProvenanceEdges data={data} />
          </Card.Body>
        </Card.Root>
      );
    case 'lesson_card':
      return <LessonCard data={data} />;
    case 'explanation_card':
      return <ExplanationCard data={data} />;
    case 'quiz_card':
      return <QuizCard data={data} onAnswer={onAnswer} />;
    case 'quiz_feedback_card':
      return <QuizFeedbackCard data={data} />;
    case 'next_step_card':
      return <NextStepCard data={data} />;
    default:
      return null;
  }
}

// Renderability guard lives in lib/tool-output.ts (pure + unit-tested); re-export to keep the import path.
export { isRenderableToolOutput } from '../../lib/tool-output';

function ParkCards({ data }: { data: Record<string, unknown> }) {
  const raw = (data.parks ?? (data.park ? [data.park] : [])) as {
    parkCode: string;
    name: string;
    designation?: string;
    matched?: string[];
  }[];
  // De-dupe by parkCode (§2.6) — the model can surface the same park more than once.
  const seen = new Set<string>();
  const parks = raw.filter((p) => (seen.has(p.parkCode) ? false : (seen.add(p.parkCode), true)));
  if (!parks.length) return null;
  // Constraint-narrowing provenance (ADR-046, Friction #2): make it legible that candidates were
  // narrowed to the user's saved constraints, rather than reading like a different, looser query.
  const narrowedBy = (data.narrowedBy as string[] | undefined)?.filter(Boolean) ?? [];
  return (
    <Stack gap={2} my={2}>
      {narrowedBy.length ? (
        <Text fontSize="xs" color="fg.muted">
          Narrowed to parks that fit your constraints: {narrowedBy.join(' · ')}
        </Text>
      ) : null}
      {parks.map((p) => (
        <CLink key={p.parkCode} asChild _hover={{ textDecoration: 'none' }} display="block" w="full">
          <NextLink href={`/parks/${p.parkCode}`}>
            <Card.Root variant="interactive" size="sm" w="full">
              <Card.Body p={3}>
                <HStack gap={2} wrap="wrap">
                  <Text as="span" fontWeight="semibold" fontFamily="heading">{p.name}</Text>
                  {p.designation ? <Badge colorPalette="pine">{p.designation}</Badge> : null}
                </HStack>
                {p.matched?.length ? (
                  <Text fontSize="xs" color="fg.muted" mt={1}>
                    matches: {p.matched.join(', ')}
                  </Text>
                ) : null}
              </Card.Body>
            </Card.Root>
          </NextLink>
        </CLink>
      ))}
    </Stack>
  );
}

/** Semantic place/person results (find_place / find_person). Each links to its related park page —
 * places/people have no detail route, so the park is the navigable target. */
function NodeResults({ data }: { data: Record<string, unknown> }) {
  const type = (data.type as 'place' | 'person') ?? 'place';
  const results = (data.results ?? []) as {
    id: string;
    title: string;
    parks?: { parkCode: string; parkName: string }[];
    isStamp?: boolean;
    tags?: string[];
  }[];
  if (!results.length) return null;
  return (
    <Stack gap={2} my={2}>
      {results.map((r) => (
        <Card.Root key={r.id} variant="outline" size="sm">
          <Card.Body p={3}>
            <HStack mb={r.tags?.length || r.parks?.length ? 1 : 0} wrap="wrap" gap={2}>
              <Badge colorPalette={type === 'place' ? 'trail' : 'pine'}>{type}</Badge>
              <Text as="span" fontWeight="semibold" fontFamily="heading">{r.title}</Text>
              {type === 'place' && r.isStamp ? <Badge colorPalette="trail" variant="solid">stamp</Badge> : null}
            </HStack>
            {type === 'person' && r.tags?.length ? (
              <Text fontSize="xs" color="fg.muted">{r.tags.slice(0, 4).join(', ')}</Text>
            ) : null}
            {r.parks?.length ? (
              <HStack wrap="wrap" gap={2} mt={1}>
                <Text fontSize="xs" color="fg.muted">at</Text>
                {r.parks.map((p) => (
                  <CLink key={p.parkCode} asChild fontSize="xs" color="brand.fg">
                    <NextLink href={`/parks/${p.parkCode}`}>{p.parkName}</NextLink>
                  </CLink>
                ))}
              </HStack>
            ) : null}
          </Card.Body>
        </Card.Root>
      ))}
    </Stack>
  );
}

/** Interactive clarifying question (ask_question tool). Tapping an option sends its label back to the
 * ranger as the user's next message via `onAnswer`; chips disable after a pick so a question isn't
 * answered twice. `onAnswer` is absent for stale (non-latest) turns, leaving the card read-only. */
function QuestionCard({ data, onAnswer }: { data: Record<string, unknown>; onAnswer?: (text: string, clientContext?: Record<string, string>) => void }) {
  const prompt = data.prompt as string | undefined;
  const options = (data.options ?? []) as { id: string; label: string; description?: string }[];
  const allowFreeform = !!data.allowFreeform;
  const [answered, setAnswered] = useState(false);
  const [draft, setDraft] = useState('');
  if (!prompt || !options.length) return null;
  const disabled = answered || !onAnswer;
  const canSubmitFreeform = !disabled && !!draft.trim();
  const submitFreeform = () => {
    if (!canSubmitFreeform) return;
    setAnswered(true);
    onAnswer?.(draft.trim());
  };
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        <Text fontWeight="semibold" fontFamily="heading" mb={2}>{prompt}</Text>
        <Stack gap={2} align="stretch">
          {options.map((o) => (
            <Box
              key={o.id}
              as="button"
              textAlign="start"
              borderWidth="1px"
              borderColor="border"
              borderRadius="l2"
              px={3}
              py={2}
              opacity={answered ? 0.55 : 1}
              cursor={disabled ? 'default' : 'pointer'}
              transition="background 0.15s, border-color 0.15s"
              _hover={disabled ? undefined : { bg: 'brand.muted', borderColor: 'brand.solid' }}
              onClick={() => {
                if (disabled) return;
                setAnswered(true);
                onAnswer?.(o.label);
              }}
            >
              <Text fontWeight="medium">{o.label}</Text>
              {o.description ? <Text fontSize="xs" color="fg.muted" mt={0.5}>{o.description}</Text> : null}
            </Box>
          ))}
        </Stack>
        {allowFreeform && !answered ? (
          <HStack mt={2} gap={2}>
            <Input
              size="sm"
              flex="1"
              borderRadius="l2"
              bg="bg.canvas"
              placeholder="…or type your own answer"
              value={draft}
              disabled={disabled}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitFreeform();
                }
              }}
            />
            <Box
              as="button"
              px={3}
              py={1.5}
              borderRadius="l2"
              fontSize="sm"
              fontWeight="medium"
              bg="brand.solid"
              color="brand.contrast"
              flexShrink={0}
              opacity={canSubmitFreeform ? 1 : 0.5}
              cursor={canSubmitFreeform ? 'pointer' : 'default'}
              _hover={canSubmitFreeform ? { bg: 'brand.emphasized' } : undefined}
              onClick={submitFreeform}
            >
              Send
            </Box>
          </HStack>
        ) : null}
      </Card.Body>
    </Card.Root>
  );
}

function ItineraryCard({ data, onAnswer }: { data: Record<string, unknown>; onAnswer?: (text: string, clientContext?: Record<string, string>) => void }) {
  const [saving, setSaving] = useState(false);
  const trip = data.trip as
    | { name: string; stops: ({ name?: string; parkName?: string; driveTo?: { miles: number; minutes: number } } | null)[] }
    | undefined;
  if (!trip) return null;
  const stops = (trip.stops ?? []).filter(Boolean) as {
    parkName?: string;
    name?: string;
    driveTo?: { miles: number; minutes: number };
  }[];
  // A `draft` card is a *proposed* plan (propose_itinerary) that was NOT saved — show a one-tap save
  // action so the user always has a predictable way to keep it (R5 §2.8). onAnswer is present only on the
  // latest turn, so stale drafts stay read-only.
  const isDraft = !!data.draft;
  // F1 (plan P0-1): date-aware closure flags for stops whose road/facility is closed on the travel dates.
  const closures = (data.closureWarnings ?? []) as { parkCode: string; name: string; state: string; summary: string | null }[];
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        <Text fontWeight="semibold" fontFamily="heading" mb={2}>
          {decodeEntities(trip.name)}
        </Text>
        {closures.length ? (
          <Stack gap={1} mb={3} borderWidth="1px" borderColor="orange.emphasized" bg="orange.subtle" borderRadius="l2" p={2}>
            <HStack gap={1.5}>
              <Icon as={LuTriangleAlert} color="orange.fg" boxSize={3.5} />
              <Text fontSize="xs" fontWeight="medium" color="orange.fg">Heads up for your dates</Text>
            </HStack>
            {closures.map((c) => (
              <Text key={c.parkCode} fontSize="xs" color="orange.fg">
                <b>{c.name}</b>{c.state === 'closed' ? ' — closed on your start date.' : ''} {c.summary ?? ''}
              </Text>
            ))}
            <Text fontSize="2xs" color="fg.muted">Hours are reported by the park — verify before you go.</Text>
          </Stack>
        ) : null}
        {(() => {
          // F2 (plan P0-2): entrance-fee budget + fee-free-day nudge.
          const budget = data.budget as { total: number; atbCost: number; atbSaves: boolean } | null;
          const feeFreeDay = data.feeFreeDay as { name: string } | null;
          if (!budget && !feeFreeDay) return null;
          return (
            <Stack gap={0.5} mb={3} fontSize="xs" color="fg.muted">
              {budget ? (
                <Text>
                  Est. entrance fees: <b>${budget.total.toFixed(0)}</b> per vehicle
                  {budget.atbSaves ? ` — the $${budget.atbCost.toFixed(0)} annual pass is cheaper.` : ''}
                </Text>
              ) : null}
              {feeFreeDay ? <Text color="brand.fg">🎉 Your start date is a fee-free day ({feeFreeDay.name}) — entrance is free.</Text> : null}
            </Stack>
          );
        })()}
        <Stack gap={1}>
          {stops.map((s, i) => (
            <Box key={i}>
              <HStack gap={2} align="baseline">
                <Badge colorPalette="pine" variant="solid" borderRadius="full" minW="20px" justifyContent="center">
                  {i + 1}
                </Badge>
                <Text fontSize="sm">{s.parkName ?? s.name ?? 'Stop'}</Text>
              </HStack>
              {s.driveTo ? (
                <Text fontSize="xs" color="fg.muted" pl={7}>
                  ↓ {Math.round(s.driveTo.miles)} mi · {Math.round(s.driveTo.minutes)} min
                </Text>
              ) : null}
            </Box>
          ))}
        </Stack>
        {(() => {
          // Before/After edit diff (P1.1) — promote the change to the existing TripDiffCard instead of prose.
          const diff = data.diff as { a?: unknown; b?: unknown } | undefined;
          return diff?.a && diff?.b ? (
            <Box mt={3}>
              <TripDiffCard data={diff as Record<string, unknown>} />
            </Box>
          ) : null;
        })()}
        {onAnswer ? (
          // Quick-action chips (P1.3): one-tap iteration without typing. Latest turn only (onAnswer present).
          <HStack gap={2} mt={3} wrap="wrap">
            {['Make it shorter', 'Swap a stop', 'Make it cheaper', 'Add a stop'].map((label) => (
              <Box
                key={label}
                as="button"
                fontSize="xs"
                px={2.5}
                py={1}
                borderRadius="full"
                borderWidth="1px"
                borderColor="border"
                bg="bg.panel"
                color="fg.muted"
                transition="background 0.15s, border-color 0.15s, color 0.15s"
                _hover={{ bg: 'brand.muted', borderColor: 'brand.solid', color: 'brand.fg' }}
                onClick={() => onAnswer(label)}
              >
                {label}
              </Box>
            ))}
          </HStack>
        ) : null}
        {isDraft && onAnswer ? (
          <Box
            as="button"
            mt={3}
            w="full"
            textAlign="center"
            bg={saving ? 'brand.muted' : 'brand.solid'}
            color="brand.contrast"
            borderRadius="l2"
            px={3}
            py={2}
            fontSize="sm"
            fontWeight="medium"
            cursor={saving ? 'default' : 'pointer'}
            transition="background 0.15s"
            _hover={saving ? undefined : { bg: 'brand.emphasized' }}
            onClick={() => {
              if (saving) return;
              setSaving(true);
              onAnswer('Yes, save this as a trip.');
            }}
          >
            {saving ? 'Saving…' : '+ Save this as a trip'}
          </Box>
        ) : null}
      </Card.Body>
    </Card.Root>
  );
}

/** Park-level Closure/Danger alerts. Exported (P1.2) so the trip artifact (TripBuilder) can pin the same
 * structured card the chat uses, instead of a bespoke prose list. */
export function AlertList({ data }: { data: Record<string, unknown> }) {
  const parks = (data.parks ?? []) as { park: string; alerts: { category: string; title: string }[] }[];
  if (!parks.length) return <Text fontSize="sm" color="fg.muted" my={2}>No active Closure/Danger alerts.</Text>;
  return (
    <Stack gap={2} my={2}>
      {parks.map((p, i) => {
        const hasDanger = p.alerts.some((a) => a.category === 'Danger');
        return (
          <Box key={i} borderLeftWidth="4px" borderColor={hasDanger ? 'red.solid' : 'orange.solid'} pl={3}>
            <Text fontWeight="semibold" fontSize="sm" fontFamily="heading">{p.park}</Text>
            {p.alerts.map((a, j) => (
              <HStack key={j} gap={2} mt={0.5}>
                <Badge colorPalette={a.category === 'Danger' ? 'red' : 'orange'}>{a.category}</Badge>
                <Text fontSize="sm">{a.title}</Text>
              </HStack>
            ))}
          </Box>
        );
      })}
    </Stack>
  );
}

/** Ranger digest (Proactive Ranger) — from the `digest_card` envelope (preview_digest). */
function DigestCard({ data }: { data: Record<string, unknown> }) {
  const items = (data.items ?? []) as DigestItemView[];
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        <Text fontWeight="semibold" fontFamily="heading" mb={2}>
          Your ranger digest{data.forDate ? ` · ${String(data.forDate)}` : ''}
        </Text>
        <DigestItems items={items} />
      </Card.Body>
    </Card.Root>
  );
}

/** Standing watches (Proactive Ranger) — from the `watch_list` envelope (set_watch / list_watches).
 * Surfaces the per-user cap (P2.4) so the limit is legible before the user hits it. */
function WatchListCard({ data }: { data: Record<string, unknown> }) {
  const watches = (data.watches ?? []) as { id: string; kind: string; refId: string; label: string | null }[];
  if (!watches.length) {
    return (
      <Text fontSize="sm" color="fg.muted" my={2}>
        No active watches yet — watch a trip or park to get it in your morning digest.
      </Text>
    );
  }
  const atCap = watches.length >= WATCH_CAP;
  return (
    <Stack gap={2} my={2}>
      <HStack justify="space-between">
        <Text fontSize="xs" color="fg.muted">Manage watches on Your memory · inbox.</Text>
        <Text fontSize="xs" color={atCap ? 'orange.fg' : 'fg.muted'} fontWeight={atCap ? 'medium' : undefined}>
          {watches.length} / {WATCH_CAP} watches
        </Text>
      </HStack>
      {watches.map((w) => (
        <HStack key={w.id} borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={2} gap={2}>
          <Badge colorPalette={w.kind === 'trip' ? 'pine' : 'trail'}>{w.kind}</Badge>
          <Text fontSize="sm" flex="1">{w.label ?? w.refId}</Text>
        </HStack>
      ))}
      {atCap ? (
        <Text fontSize="xs" color="orange.fg">
          You&apos;re at the watch limit — remove one (ask the ranger to &ldquo;stop watching&rdquo; a trip or park) to add another.
        </Text>
      ) : null}
    </Stack>
  );
}

/** Open/closed + seasonal-closure card (F1, check_open). State is open/closed/unknown — "unknown" when
 * the park reports no hours, never a false "closed". Framed as reported, not a safety guarantee. */
function HoursCard({ data }: { data: Record<string, unknown> }) {
  const state = (data.state as string) ?? 'unknown';
  const name = (data.name as string) ?? 'This park';
  const date = data.date as string | undefined;
  const closure = data.closureSummary as string | null;
  const feeFree = data.feeFree as { name: string } | null;
  const palette = state === 'open' ? 'pine' : state === 'closed' ? 'red' : 'gray';
  const label = state === 'open' ? 'Open' : state === 'closed' ? 'Closed' : 'Hours not reported';
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        <HStack gap={2} wrap="wrap" mb={closure || feeFree ? 1 : 0}>
          <Text fontWeight="semibold" fontFamily="heading">{name}</Text>
          {date ? <Text fontSize="sm" color="fg.muted">· {date}</Text> : null}
          <Badge colorPalette={palette}>{label}</Badge>
          {feeFree ? <Badge colorPalette="trail" variant="solid">Fee-free: {feeFree.name}</Badge> : null}
        </HStack>
        {closure ? <Text fontSize="sm" color="fg.muted">{closure}</Text> : null}
        <Text fontSize="xs" color="fg.muted" mt={2}>Hours are reported by the park — verify before you go.</Text>
      </Card.Body>
    </Card.Root>
  );
}

/** Trip entrance-fee budget vs the annual pass (F2, trip_budget). Entrance fees only. */
function BudgetCard({ data }: { data: Record<string, unknown> }) {
  const unit = (data.unit as string) ?? 'vehicle';
  const parks = (data.parks ?? []) as { parkCode: string; name: string; fee: number | null; feeFree: boolean }[];
  const total = (data.total as number) ?? 0;
  const atbCost = (data.atbCost as number) ?? 80;
  const atbSaves = !!data.atbSaves;
  if (!parks.length) return null;
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        <HStack gap={1.5} mb={2}>
          <Text fontWeight="semibold" fontFamily="heading">Trip entrance fees · per {unit}</Text>
          <SourceInfo
            label="Entrance fees"
            detail="From the NPS API as of our last sync — a strong planning estimate, not a live quote. Excludes timed-entry reservation fees. Verify at nps.gov."
          />
        </HStack>
        <Stack gap={1}>
          {parks.map((p) => (
            <HStack key={p.parkCode} justify="space-between">
              <CLink asChild fontSize="sm" color="brand.fg"><NextLink href={`/parks/${p.parkCode}`}>{p.name}</NextLink></CLink>
              <Text fontSize="sm" color="fg.muted">{p.feeFree ? 'Free' : p.fee != null ? fmt(p.fee) : '—'}</Text>
            </HStack>
          ))}
        </Stack>
        <HStack justify="space-between" mt={2} pt={2} borderTopWidth="1px" borderColor="border">
          <Text fontWeight="medium" fontSize="sm">Pay per park</Text>
          <Text fontWeight="medium" fontSize="sm">{fmt(total)}</Text>
        </HStack>
        <HStack justify="space-between">
          <Text fontSize="sm">America the Beautiful annual pass</Text>
          <Text fontSize="sm">{fmt(atbCost)}</Text>
        </HStack>
        <Text fontSize="xs" color={atbSaves ? 'brand.fg' : 'fg.muted'} mt={2}>
          {atbSaves ? `The annual pass saves ${fmt(total - atbCost)} on this trip.` : 'Paying per park is cheaper for this trip.'}
        </Text>
        <Text fontSize="xs" color="fg.muted" mt={1}>Entrance fees only — excludes timed-entry reservations. As of last sync.</Text>
      </Card.Body>
    </Card.Root>
  );
}

/** Accessibility scorecard (F5, accessibility_scorecard). Self-reported — framed as "reported". */
function AccessibilityCard({ data }: { data: Record<string, unknown> }) {
  const name = (data.name as string) ?? 'This park';
  const features = (data.features ?? []) as string[];
  const accessibleCampgrounds = (data.accessibleCampgrounds as number) ?? 0;
  const audioDescribedPlaces = (data.audioDescribedPlaces as number) ?? 0;
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        <HStack gap={1.5} mb={2}>
          <Text fontWeight="semibold" fontFamily="heading">Accessibility · {name}</Text>
          <SourceInfo
            label="Accessibility data"
            detail="Self-reported by the park to the NPS — useful as a guide, but verify specifics with the park before you go."
          />
        </HStack>
        {features.length ? (
          <HStack wrap="wrap" gap={1} mb={2}>
            {features.map((f) => (
              <Badge key={f} colorPalette="pine">{f}</Badge>
            ))}
          </HStack>
        ) : (
          <Text fontSize="sm" color="fg.muted" mb={2}>No accessibility features reported for this park.</Text>
        )}
        <Stack gap={0.5} fontSize="sm" color="fg.muted">
          {/* P2.2: show explicit zero counts ("0 accessible campgrounds") instead of hiding them — a silent
              omission reads as "no data," whereas a hard 0 is honest reported data. */}
          <Text>{accessibleCampgrounds} accessible campground{accessibleCampgrounds === 1 ? '' : 's'}</Text>
          <Text>{audioDescribedPlaces} audio-described place{audioDescribedPlaces === 1 ? '' : 's'}</Text>
        </Stack>
        <Text fontSize="xs" color="fg.muted" mt={2}>Reported by the park — verify specifics with the park before you go.</Text>
      </Card.Body>
    </Card.Root>
  );
}

/** Self-guided audio / galleries / videos for a park (F6, get_media). */
function MediaCard({ data }: { data: Record<string, unknown> }) {
  const audio = (data.audio ?? []) as { id: string; title: string; durationMs: number | null; url: string | null; hasTranscript: boolean }[];
  const videos = (data.videos ?? []) as { id: string; title: string; durationMs: number | null; url: string | null }[];
  const galleries = (data.galleries ?? []) as { id: string; title: string; assetCount: number | null; url: string | null }[];
  if (!audio.length && !videos.length && !galleries.length) return null;
  const mins = (ms: number | null) => (ms ? ` · ${Math.round(ms / 60000)} min` : '');
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        <Text fontWeight="semibold" fontFamily="heading" mb={2}>Audio &amp; media</Text>
        <Stack gap={1}>
          {audio.map((a) => (
            <Text key={a.id} fontSize="sm">
              🎧 {a.url ? <CLink href={a.url} color="brand.fg">{a.title} ↗</CLink> : a.title}{mins(a.durationMs)}
              {a.hasTranscript ? <Badge ml={2} colorPalette="pine">transcript</Badge> : null}
            </Text>
          ))}
          {videos.map((v) => (
            <Text key={v.id} fontSize="sm">🎬 {v.url ? <CLink href={v.url} color="brand.fg">{v.title} ↗</CLink> : v.title}{mins(v.durationMs)}</Text>
          ))}
          {galleries.map((g) => (
            <Text key={g.id} fontSize="sm">🖼 {g.url ? <CLink href={g.url} color="brand.fg">{g.title} ↗</CLink> : g.title}{g.assetCount ? ` · ${g.assetCount} photos` : ''}</Text>
          ))}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

/** Latest news releases for a park (F8, find_news). */
function NewsCard({ data }: { data: Record<string, unknown> }) {
  const news = (data.news ?? []) as { id: string; title: string; abstract: string | null; url: string | null; releaseDate: string | null }[];
  if (!news.length) return <Text fontSize="sm" color="fg.muted" my={2}>No recent news releases for this park.</Text>;
  return (
    <Stack gap={2} my={2}>
      {news.map((n) => (
        <Box key={n.id} borderLeftWidth="4px" borderColor="trail.solid" pl={3}>
          {n.url ? (
            <CLink href={n.url} color="brand.fg" fontWeight="medium" fontSize="sm">{n.title} ↗</CLink>
          ) : (
            <Text fontWeight="medium" fontSize="sm">{n.title}</Text>
          )}
          {n.releaseDate ? <Text as="span" fontSize="xs" color="fg.muted"> · {n.releaseDate}</Text> : null}
          {n.abstract ? <Text fontSize="sm" color="fg.muted" lineClamp={2}>{n.abstract}</Text> : null}
        </Box>
      ))}
    </Stack>
  );
}

/** Community SQM leaderboard (Collective Intelligence v2) — from the `leaderboard_card` envelope. */
function LeaderboardCard({ data }: { data: Record<string, unknown> }) {
  const submitted = data.submitted as { parkName?: string; sqm?: number } | undefined;
  const entries = (data.entries ?? []) as LeaderboardEntry[];
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        <Text fontWeight="semibold" fontFamily="heading" mb={2}>
          Community dark-sky leaderboard
        </Text>
        {submitted ? (
          <Text fontSize="xs" color="brand.fg" mb={2}>
            Logged SQM {submitted.sqm} at {submitted.parkName} — thanks for contributing!
          </Text>
        ) : null}
        <SkyLeaderboard entries={entries} />
      </Card.Body>
    </Card.Root>
  );
}

// ---------------------------------------------------------------------------
// Ranger School (Phase 4) tutor cards
// ---------------------------------------------------------------------------

/** A course: either a list of a park's courses (start_lesson with parkCode) or an enrolled module/lesson spine. */
function LessonCard({ data }: { data: Record<string, unknown> }) {
  const courses = data.courses as { id: string; title: string; subject: string | null; gradeLevel: string | null }[] | undefined;
  const modules = data.modules as
    | { id: string; ordinal: number; title: string; lessons: { id: string; ordinal: number; title: string; completed: boolean }[] }[]
    | undefined;
  if (courses) {
    return (
      <Card.Root variant="subtle" size="sm" my={2}>
        <Card.Body p={3}>
          <Text fontWeight="semibold" fontFamily="heading" mb={2}>
            🎓 Courses{data.parkCode ? ` · ${String(data.parkCode).toUpperCase()}` : ''}
          </Text>
          <Stack gap={2}>
            {courses.map((c) => (
              <Box key={c.id}>
                <Text fontSize="sm" fontWeight="medium">{c.title}</Text>
                <HStack gap={1} mt={0.5}>
                  {c.subject ? <Badge colorPalette="pine" size="sm">{c.subject}</Badge> : null}
                  {c.gradeLevel ? <Badge colorPalette="trail" size="sm">{c.gradeLevel}</Badge> : null}
                </HStack>
              </Box>
            ))}
          </Stack>
        </Card.Body>
      </Card.Root>
    );
  }
  const title = data.title as string | undefined;
  const done = data.done as number | undefined;
  const total = data.total as number | undefined;
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        <HStack justify="space-between" mb={2}>
          <Text fontWeight="semibold" fontFamily="heading">🎓 {title ?? 'Course'}</Text>
          {typeof done === 'number' && typeof total === 'number' ? (
            <Badge colorPalette="pine">{done}/{total} done</Badge>
          ) : null}
        </HStack>
        <Stack gap={2}>
          {(modules ?? []).map((m) => (
            <Box key={m.id}>
              <Text fontSize="sm" fontWeight="medium" color="fg.muted">{m.ordinal}. {m.title}</Text>
              <Stack gap={0.5} pl={3} mt={1}>
                {m.lessons.map((l) => (
                  <Text key={l.id} fontSize="sm">{l.completed ? '✅' : '⬜'} {l.title}</Text>
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
        <EarnedBadges ids={data.earnedBadges} />
      </Card.Body>
    </Card.Root>
  );
}

/** A taught lesson: objective + the park's audio tours + field-trip feasibility (tutor_step). */
function ExplanationCard({ data }: { data: Record<string, unknown> }) {
  const title = data.title as string | undefined;
  const moduleTitle = data.moduleTitle as string | undefined;
  const objective = data.objective as string | null | undefined;
  const narrative = data.narrative as string | null | undefined;
  const media = (data.media ?? {}) as { audio?: { id: string; title: string; url: string | null; hasTranscript: boolean }[] };
  const openWindow = data.openWindow as { name?: string; state?: string; closureSummary?: string | null } | null | undefined;
  const audio = media.audio ?? [];
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        <Text fontWeight="semibold" fontFamily="heading">{title ?? 'Lesson'}</Text>
        {moduleTitle ? <Text fontSize="xs" color="fg.muted" mb={2}>{moduleTitle}</Text> : null}
        {objective ? (
          <Text fontSize="sm" mb={2}><Text as="span" fontWeight="medium">Objective: </Text>{objective}</Text>
        ) : null}
        {narrative ? <Text fontSize="sm" mb={2}>{narrative}</Text> : null}
        {audio.length ? (
          <Stack gap={1} mb={2}>
            {audio.map((a) => (
              <Text key={a.id} fontSize="sm">
                🎧 {a.url ? <CLink href={a.url} color="brand.fg">{a.title} ↗</CLink> : a.title}
                {a.hasTranscript ? <Badge ml={2} colorPalette="pine" size="sm">transcript</Badge> : null}
              </Text>
            ))}
          </Stack>
        ) : null}
        {openWindow?.state ? (
          <Text fontSize="xs" color="fg.muted">
            Field trip: {openWindow.name ?? 'the park'} is {openWindow.state}
            {openWindow.closureSummary ? ` — ${openWindow.closureSummary}` : ''} (reported by the park — verify).
          </Text>
        ) : null}
      </Card.Body>
    </Card.Root>
  );
}

/** Interactive quiz (generate_quiz) — forks QuestionCard. A tap sends the chosen answer's LABEL as the next
 * message (the human bubble), with `quizId`/`choiceId` carried in clientContext for grade_answer. Highlights
 * the chosen option and disables after one pick; read-only on stale (non-latest) turns. The correct answer
 * is NOT revealed here (anti-cheat) — it surfaces in the QuizFeedbackCard after grading. */
function QuizCard({ data, onAnswer }: { data: Record<string, unknown>; onAnswer?: (text: string, clientContext?: Record<string, string>) => void }) {
  const quizId = data.quizId as string | undefined;
  const stem = data.stem as string | undefined;
  const choices = (data.choices ?? []) as { id: string; label: string }[];
  const difficulty = data.difficulty as string | undefined;
  const [chosenId, setChosenId] = useState<string | null>(null);
  if (!quizId || !stem || !choices.length) return null;
  const answered = chosenId !== null;
  const disabled = answered || !onAnswer;
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        <HStack justify="space-between" mb={2}>
          <Text fontWeight="semibold" fontFamily="heading">📝 Quiz</Text>
          {difficulty ? <Badge colorPalette="trail" size="sm">{difficulty}</Badge> : null}
        </HStack>
        <Text fontSize="sm" mb={2}>{stem}</Text>
        <Stack gap={2} align="stretch">
          {choices.map((c) => {
            const chosen = c.id === chosenId;
            return (
              <Box
                key={c.id}
                as="button"
                textAlign="start"
                borderWidth="1px"
                borderColor={chosen ? 'brand.solid' : 'border'}
                bg={chosen ? 'brand.muted' : undefined}
                borderRadius="l2"
                px={3}
                py={2}
                // After answering, dim the options NOT chosen so the learner's pick stays legible.
                opacity={answered && !chosen ? 0.55 : 1}
                cursor={disabled ? 'default' : 'pointer'}
                transition="background 0.15s, border-color 0.15s"
                _hover={disabled ? undefined : { bg: 'brand.muted', borderColor: 'brand.solid' }}
                onClick={() => {
                  if (disabled) return;
                  setChosenId(c.id);
                  onAnswer?.(c.label, { quizId, choiceId: c.id });
                }}
              >
                <Text fontWeight="medium">{c.label}</Text>
              </Box>
            );
          })}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

/** Newly-earned badge chips (surfaced by start_lesson / grade_answer / recommend_next). Renders nothing when empty. */
function EarnedBadges({ ids }: { ids?: unknown }) {
  const list = (Array.isArray(ids) ? ids : []) as string[];
  if (!list.length) return null;
  return (
    <HStack gap={1} mt={2} wrap="wrap">
      <Text fontSize="sm">🏅 New badge{list.length > 1 ? 's' : ''}:</Text>
      {list.map((b) => (
        <Badge key={b} colorPalette="trail">{b}</Badge>
      ))}
    </HStack>
  );
}

/** Deterministic grading feedback (grade_answer): green/red + (on a miss) what they chose and the correct
 * answer + the lesson's cited rationale + topic mastery. The correct label is revealed only POST-grade. */
function QuizFeedbackCard({ data }: { data: Record<string, unknown> }) {
  const correct = data.correct as boolean | undefined;
  const correctLabel = data.correctLabel as string | null | undefined;
  const chosenLabel = data.chosenLabel as string | null | undefined;
  const rationale = data.rationale as string | null | undefined;
  const mastery = data.mastery as number | null | undefined;
  return (
    <Card.Root variant="subtle" size="sm" my={2} colorPalette={correct ? 'pine' : 'red'}>
      <Card.Body p={3}>
        <Text fontWeight="semibold" fontFamily="heading" color="colorPalette.fg" mb={1}>
          {correct ? '✅ Correct!' : '❌ Not quite'}
        </Text>
        {!correct && (chosenLabel || correctLabel) ? (
          <Stack gap={0.5} mb={rationale ? 1 : 0}>
            {chosenLabel ? <Text fontSize="sm" color="fg.muted">You chose: {chosenLabel}</Text> : null}
            {correctLabel ? (
              <Text fontSize="sm">Correct answer: <Text as="span" fontWeight="medium">{correctLabel}</Text></Text>
            ) : null}
          </Stack>
        ) : null}
        {rationale ? <Text fontSize="sm">{rationale}</Text> : null}
        {typeof mastery === 'number' ? (
          <Text fontSize="xs" color="fg.muted" mt={2}>Topic mastery: {Math.round(mastery * 100)}%</Text>
        ) : null}
        <EarnedBadges ids={data.earnedBadges} />
      </Card.Body>
    </Card.Root>
  );
}

/** What to do next (recommend_next): advance / remediate / complete (+ certificate + badge on completion). */
function NextStepCard({ data }: { data: Record<string, unknown> }) {
  const rec = data.recommendation as string | undefined;
  const reason = data.reason as string | undefined;
  const cert = data.certificate as { shareSlug?: string } | null | undefined;
  const label =
    rec === 'complete' ? '🎓 Course complete'
    : rec === 'remediate' ? '🔁 Review'
    : rec === 'retry' ? '🔁 Review this lesson'
    : '➡️ Next up';
  const palette = rec === 'complete' ? 'pine' : rec === 'remediate' || rec === 'retry' ? 'sand' : 'trail';
  return (
    <Card.Root variant="subtle" size="sm" my={2}>
      <Card.Body p={3}>
        <HStack justify="space-between" mb={1}>
          <Text fontWeight="semibold" fontFamily="heading">{label}</Text>
          {rec ? <Badge colorPalette={palette} size="sm">{rec}</Badge> : null}
        </HStack>
        {reason ? <Text fontSize="sm">{reason}</Text> : null}
        <EarnedBadges ids={data.earnedBadges} />
        {cert?.shareSlug ? (
          <Text fontSize="sm" mt={2}>📜 <CLink href={`/learn/cert/${cert.shareSlug}`} color="brand.fg">View &amp; share your certificate ↗</CLink></Text>
        ) : null}
      </Card.Body>
    </Card.Root>
  );
}
