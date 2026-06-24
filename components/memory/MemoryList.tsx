'use client';
import { useState, useEffect } from 'react';
import { Box, Heading, Stack, HStack, Text, Badge, Button, IconButton, Link as CLink, Spinner, Input } from '@chakra-ui/react';
import NextLink from 'next/link';
import { LuThumbsDown, LuThumbsUp } from 'react-icons/lu';
import type { UserMemory } from '../../lib/memory-graph';
import { emitMemoryFormed } from './MemoryFormingLayer';

/**
 * "Your memory" surface (E3/E4). Users view, give feedback on, and DELETE remembered facts. Deletes
 * are durable (server tombstones them so extraction won't resurrect them — ADR-016, §13.4).
 */
/** Human-readable "why is this park here?" from the CONSIDERED edge's stored provenance (ADR-039). */
function consideredReason(source: string | null): string | null {
  switch (source) {
    case 'viewed':
      return 'You viewed this';
    case 'added_to_trip':
      return 'Added to a trip';
    case 'agent_recommendation':
      return 'Suggested by the ranger';
    case 'saved':
      return 'You saved this';
    default:
      return null;
  }
}

export function MemoryList({ initial }: { initial: UserMemory }) {
  const [mem, setMem] = useState<UserMemory>(initial);
  const [busy, setBusy] = useState(false);
  const [learning, setLearning] = useState(true);
  const [showAllConsidered, setShowAllConsidered] = useState(false);
  const [rvDraft, setRvDraft] = useState(initial.travel.rvMaxLengthFt != null ? String(initial.travel.rvMaxLengthFt) : '');
  const [startDraft, setStartDraft] = useState(initial.availability.start ?? '');
  const [endDraft, setEndDraft] = useState(initial.availability.end ?? '');

  // On load, reconcile NAMS-extracted chat preferences into the graph so implicit prefs show up
  // here (§2.1/§5), then refresh. Eventually-consistent — this "catches up" the display.
  useEffect(() => {
    fetch('/api/memory/reconcile', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.memory) {
          // Animate any preference the reconcile just surfaced (chat-learned prefs forming into the
          // graph) in lockstep with the persisted bridge — the "memory forming" thesis (ADR-044 §7.2).
          const had = new Set(initial.preferences.map((p) => `${p.kind}:${p.name}`));
          for (const p of (d.memory as UserMemory).preferences) {
            if (!had.has(`${p.kind}:${p.name}`)) emitMemoryFormed({ label: p.name, relation: 'prefers' });
          }
          setMem(d.memory);
        }
      })
      .catch(() => {})
      .finally(() => setLearning(false));
  }, [initial.preferences]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) setMem(await res.json());
    setBusy(false);
  }

  return (
    <Stack gap={8}>
      <Box>
        <HStack mb={1}>
          <Heading size="sm">Preferences</Heading>
          {learning ? (
            <HStack color="fg.muted" gap={1}>
              <Spinner size="xs" />
              <Text fontSize="xs">Learning from your recent chats…</Text>
            </HStack>
          ) : null}
        </HStack>
        <Text fontSize="xs" color="fg.muted" mb={3}>
          What we&apos;ve learned you like. It can be wrong — give feedback or delete anything.
        </Text>
        {mem.preferences.length === 0 ? (
          <Text color="fg.muted" fontSize="sm">Nothing yet. Tell the ranger what you enjoy and it&apos;ll show here.</Text>
        ) : (
          <Stack gap={2}>
            {mem.preferences.map((p) => (
              <HStack key={`${p.kind}:${p.name}`} borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={2}>
                <Badge colorPalette={p.kind === 'activity' ? 'trail' : 'pine'}>{p.kind}</Badge>
                <Text flex="1">
                  {p.name}
                  {p.value && p.value.toLowerCase() !== p.name.toLowerCase() ? (
                    <Text as="span" color="fg.muted"> — you said “{p.value}”</Text>
                  ) : null}
                </Text>
                {p.weight != null && p.weight !== 1 ? (
                  <Badge colorPalette={p.weight < 1 ? 'sand' : 'trail'} title="Influence on your recommendations">
                    {p.weight < 1 ? '↓' : '↑'}{p.weight}×
                  </Badge>
                ) : null}
                <Button size="xs" variant="ghost" disabled={busy} title="Down-rank in recommendations"
                  onClick={() => act({ op: 'setWeight', kind: p.kind, name: p.name, weight: Math.max(0, Math.round(((p.weight ?? 1) - 0.5) * 10) / 10) })}>Less</Button>
                <Button size="xs" variant="ghost" disabled={busy} title="Boost in recommendations"
                  onClick={() => act({ op: 'setWeight', kind: p.kind, name: p.name, weight: Math.min(3, Math.round(((p.weight ?? 1) + 0.5) * 10) / 10) })}>More</Button>
                <IconButton size="xs" aria-label="Mark this preference helpful" colorPalette="pine" variant={p.feedback === 'up' ? 'solid' : 'ghost'} disabled={busy}
                  onClick={() => act({ op: 'feedback', kind: p.kind, name: p.name, vote: 'up' })}><LuThumbsUp /></IconButton>
                <IconButton size="xs" aria-label="Mark this preference wrong" colorPalette="red" variant={p.feedback === 'down' ? 'solid' : 'ghost'} disabled={busy}
                  onClick={() => act({ op: 'feedback', kind: p.kind, name: p.name, vote: 'down' })}><LuThumbsDown /></IconButton>
                <Button size="xs" colorPalette="red" variant="ghost" disabled={busy}
                  onClick={() => act({ op: 'deletePreference', kind: p.kind, name: p.name })}>Delete</Button>
              </HStack>
            ))}
          </Stack>
        )}
      </Box>

      <Box>
        <HStack justify="space-between" mb={1}>
          <Heading size="sm">How you travel</Heading>
          {mem.travel.wheelchair || mem.travel.rvMaxLengthFt != null || mem.travel.requiredAmenities.length > 0 ? (
            <Button size="xs" variant="ghost" colorPalette="red" disabled={busy}
              onClick={() => { setRvDraft(''); act({ op: 'clearTravelConstraints' }); }}>Clear</Button>
          ) : null}
        </HStack>
        <Text fontSize="xs" color="fg.muted" mb={3}>
          Constraints the ranger honors in every recommendation and itinerary.
        </Text>
        <Stack gap={3}>
          <HStack borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={2}>
            <Text flex="1">Wheelchair-accessible sites</Text>
            <Button size="xs" disabled={busy}
              variant={mem.travel.wheelchair ? 'solid' : 'ghost'}
              colorPalette={mem.travel.wheelchair ? 'green' : 'gray'}
              onClick={() => act({ op: 'setTravelConstraints', wheelchair: !mem.travel.wheelchair })}>
              {mem.travel.wheelchair ? 'Required' : 'Off'}
            </Button>
          </HStack>
          <HStack borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={2}>
            <Text flex="1">RV / trailer length (ft)</Text>
            <Input size="xs" type="number" min={0} w="20" value={rvDraft} placeholder="e.g. 30"
              onChange={(e) => setRvDraft(e.target.value)} />
            <Button size="xs" variant="ghost" disabled={busy}
              onClick={() => act({ op: 'setTravelConstraints', rvMaxLengthFt: rvDraft.trim() === '' ? null : Number(rvDraft) })}>Save</Button>
          </HStack>
          {mem.travel.requiredAmenities.length > 0 ? (
            <HStack borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={2} flexWrap="wrap" gap={2}>
              <Text>Must have:</Text>
              {mem.travel.requiredAmenities.map((a) => (
                <Badge key={a} colorPalette="orange">{a}</Badge>
              ))}
            </HStack>
          ) : null}
          <HStack borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={2} flexWrap="wrap">
            <Text flex="1" minW="32">Travel dates</Text>
            <Input size="xs" type="date" w="36" value={startDraft} onChange={(e) => setStartDraft(e.target.value)} />
            <Text color="fg.muted">–</Text>
            <Input size="xs" type="date" w="36" value={endDraft} onChange={(e) => setEndDraft(e.target.value)} />
            <Button size="xs" variant="ghost" disabled={busy}
              onClick={() =>
                startDraft && endDraft
                  ? act({ op: 'setAvailability', start: startDraft, end: endDraft })
                  : act({ op: 'clearAvailability' })
              }>
              Save
            </Button>
          </HStack>
        </Stack>
      </Box>

      <Box>
        <Heading size="sm" mb={1}>Passes &amp; stamps</Heading>
        <Text fontSize="xs" color="fg.muted" mb={3}>
          A pass you hold makes covered parks free in trip costs; stamps are your collection.
        </Text>
        <Stack gap={3}>
          <HStack borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={2}>
            <Text flex="1">America the Beautiful — annual pass</Text>
            {mem.passes.some((p) => p.id === 'atb-annual') ? (
              <Button size="xs" colorPalette="green" disabled={busy} onClick={() => act({ op: 'clearPass', passId: 'atb-annual' })}>
                Held ✓
              </Button>
            ) : (
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => act({ op: 'recordPass', passId: 'atb-annual' })}>
                I have it
              </Button>
            )}
          </HStack>
          {mem.stamps.length > 0 ? (
            <Box borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={2}>
              <Text fontSize="sm" mb={2}>Collected stamps ({mem.stamps.length})</Text>
              <Stack gap={1}>
                {mem.stamps.map((s) => (
                  <HStack key={s.id}>
                    <Text flex="1" fontSize="sm">🎫 {s.label || s.id}</Text>
                    <Button size="xs" colorPalette="red" variant="ghost" disabled={busy}
                      onClick={() => act({ op: 'uncollectStamp', stampId: s.id })}>Remove</Button>
                  </HStack>
                ))}
              </Stack>
            </Box>
          ) : (
            <Text color="fg.muted" fontSize="sm">No stamps collected yet — mark them on park pages.</Text>
          )}
        </Stack>
      </Box>

      <Box>
        <HStack justify="space-between" mb={3}>
          <Heading size="sm">
            Parks you&apos;ve considered{mem.considered.length ? ` (${mem.considered.length})` : ''}
          </Heading>
          {mem.considered.length > 0 ? (
            <Button size="xs" variant="ghost" colorPalette="red" disabled={busy}
              onClick={() => act({ op: 'clearConsidered' })}>Clear all</Button>
          ) : null}
        </HStack>
        {mem.considered.length === 0 ? (
          <Text color="fg.muted" fontSize="sm">None yet.</Text>
        ) : (
          <Stack gap={2}>
            {(showAllConsidered ? mem.considered : mem.considered.slice(0, 8)).map((c) => (
              <HStack key={c.parkCode} borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={2}>
                <Stack flex="1" gap={0}>
                  <CLink asChild color="brand.fg" fontWeight="medium"><NextLink href={`/parks/${c.parkCode}`}>{c.name}</NextLink></CLink>
                  {/* Why is this here? Surface the CONSIDERED edge's provenance (ADR-039, friction #10). */}
                  {(() => {
                    const reason = consideredReason(c.source);
                    return reason ? (
                      <Text fontSize="xs" color="fg.muted">{reason}</Text>
                    ) : null;
                  })()}
                </Stack>
                <Button size="xs" colorPalette="red" variant="ghost" disabled={busy}
                  onClick={() => act({ op: 'deleteConsidered', parkCode: c.parkCode })}>Delete</Button>
              </HStack>
            ))}
            {mem.considered.length > 8 ? (
              <Button size="xs" variant="ghost" alignSelf="start" onClick={() => setShowAllConsidered((v) => !v)}>
                {showAllConsidered ? 'Show fewer' : `Show all ${mem.considered.length}`}
              </Button>
            ) : null}
          </Stack>
        )}
      </Box>

      <Box>
        <Heading size="sm" mb={3}>Your trips</Heading>
        {mem.planned.length === 0 ? (
          <Text color="fg.muted" fontSize="sm">No trips planned yet.</Text>
        ) : (
          <Stack gap={2}>
            {mem.planned.map((t) => (
              <Text key={t.tripId}>{t.name}</Text>
            ))}
          </Stack>
        )}
      </Box>

      <Text fontSize="xs" color="fg.muted">
        TrailGraph&apos;s memory learns and improves, and it can be wrong — you&apos;re always in control here.
      </Text>
    </Stack>
  );
}
