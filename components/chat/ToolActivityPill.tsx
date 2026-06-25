'use client';
import { useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react';
import { Badge, Box, chakra, Code, HStack, Icon, Stack, Text } from '@chakra-ui/react';
import { LuBrain, LuCheck, LuChevronDown, LuWrench, LuX } from 'react-icons/lu';
import { toolLabel, type ToolCallSummary } from '../../lib/tool-activity';
import { durations, easings, springs, stagger } from '../../theme/motion';

/**
 * Tool-call disclosure pill (§7.7 made auditable). Always shows the ranger's tool calls as live chips —
 * each springs in (staggered) and its status dot breathes while running, settling to ✓ on completion.
 * Clicking the pill discloses the details (raw input args + result kind per call) and, when the turn has
 * reasoning, an OPTIONAL nested "Show reasoning" disclosure (hidden by default). Everything is read from
 * the stream (never model prose). Reduced-motion: loops + the height reveal collapse to instant.
 */
export function ToolActivityPill({
  toolCalls,
  reasoning,
  streaming,
}: {
  toolCalls: ToolCallSummary[];
  reasoning: { text: string; streaming: boolean } | null;
  streaming: boolean;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const detailsId = useId();
  const reasonId = useId();

  const hasTools = toolCalls.length > 0;
  if (!hasTools && !reasoning) return null;

  // Collapse superseded retries (P0.4): show only the polished final calls as chips + in the count; the
  // superseded steps stay in the disclosure (de-emphasized) so the audit trail is never lost.
  const shownCalls = toolCalls.filter((t) => !t.superseded);
  const retried = toolCalls.length - shownCalls.length;

  const reveal = reduce ? { duration: 0 } : { duration: durations.base, ease: easings.standard };
  const doneCount = shownCalls.filter((t) => t.done).length;
  const summary = hasTools
    ? streaming && doneCount < shownCalls.length
      ? `Using ${shownCalls.length} tool${shownCalls.length === 1 ? '' : 's'}…`
      : `Used ${shownCalls.length} tool${shownCalls.length === 1 ? '' : 's'}${retried ? ` · ${retried} retried` : ''}`
    : "Ranger's reasoning";

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.subtle" mb={3} overflow="hidden">
      {/* Header = the disclosure trigger (click anywhere). */}
      <chakra.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={detailsId}
        w="full"
        textAlign="start"
        px={3}
        py={2}
        _hover={{ bg: 'bg.muted' }}
        cursor="pointer"
      >
        <HStack gap={2} align="center" minW={0}>
          <Icon as={LuWrench} boxSize={3.5} color="fg.subtle" flexShrink={0} />
          {hasTools ? (
            <HStack gap={1.5} wrap="wrap" minW={0} flex="1">
              <AnimatePresence initial={false}>
                {shownCalls.map((tc, i) => (
                  <motion.div
                    key={tc.id}
                    layout={!reduce}
                    initial={{ opacity: 0, scale: 0.85, y: 6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={reduce ? { duration: 0 } : { ...springs.snappy, delay: i * stagger.tight }}
                    style={{ display: 'inline-flex' }}
                  >
                    <Chip tc={tc} reduce={!!reduce} streaming={streaming} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </HStack>
          ) : (
            <Text fontSize="sm" fontWeight="medium" color="fg.muted" flex="1">
              {summary}
            </Text>
          )}
          {hasTools ? (
            <Text fontSize="xs" color="fg.subtle" flexShrink={0} display={{ base: 'none', sm: 'block' }}>
              {summary}
            </Text>
          ) : null}
          <motion.div
            animate={{ rotate: open ? 180 : 0 }}
            transition={reduce ? { duration: 0 } : { duration: durations.fast }}
            style={{ display: 'inline-flex', flexShrink: 0 }}
          >
            <Icon as={LuChevronDown} boxSize={4} color="fg.subtle" />
          </motion.div>
        </HStack>
      </chakra.button>

      {/* Disclosure: per-call details (raw args + result kind) + the optional reasoning sub-disclosure. */}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="details"
            id={detailsId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reveal}
            style={{ overflow: 'hidden' }}
          >
            <Stack gap={3} px={3} pb={3} pt={1} borderTopWidth="1px" borderColor="border">
              {toolCalls.map((tc) => (
                <Box key={tc.id} opacity={tc.superseded ? 0.5 : 1}>
                  <HStack gap={2} wrap="wrap" mb={1}>
                    <StatusGlyph tc={tc} reduce={!!reduce} streaming={streaming} />
                    <Text fontSize="sm" fontWeight="semibold" fontFamily="heading">
                      {toolLabel(tc.name)}
                    </Text>
                    <Code fontSize="2xs" colorPalette="gray" variant="surface">
                      {tc.name}
                    </Code>
                    {tc.superseded ? (
                      <Badge size="sm" colorPalette="gray" variant="surface">
                        retried
                      </Badge>
                    ) : null}
                    {tc.resultKind ? (
                      <Badge size="sm" colorPalette="pine" variant="surface">
                        {tc.resultKind}
                      </Badge>
                    ) : null}
                  </HStack>
                  {tc.input != null && Object.keys(tc.input as object).length > 0 ? (
                    <Box
                      as="pre"
                      fontFamily="mono"
                      fontSize="2xs"
                      color="fg.muted"
                      bg="bg.panel"
                      borderWidth="1px"
                      borderColor="border"
                      borderRadius="l1"
                      p={2}
                      overflowX="auto"
                      whiteSpace="pre"
                    >
                      {safeJson(tc.input)}
                    </Box>
                  ) : null}
                </Box>
              ))}

              {reasoning ? (
                hasTools ? (
                  <ReasoningDisclosure
                    reasoning={reasoning}
                    open={reasonOpen}
                    onToggle={() => setReasonOpen((v) => !v)}
                    reveal={reveal}
                    reduce={!!reduce}
                    id={reasonId}
                  />
                ) : (
                  // Reasoning-only turn: the main disclosure already revealed it — show directly.
                  <ReasoningBody reasoning={reasoning} reduce={!!reduce} />
                )
              ) : null}
            </Stack>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Box>
  );
}

/** A live tool chip: friendly label + a status indicator (breathing dot / ✓ / ✕). */
function Chip({ tc, reduce, streaming }: { tc: ToolCallSummary; reduce: boolean; streaming: boolean }) {
  const settled = !streaming && !tc.done && !tc.isError; // turn stopped/errored mid-tool (P1.1)
  const tone = tc.isError ? 'red' : tc.done ? 'pine' : settled ? 'gray' : 'trail';
  return (
    <HStack
      gap={1.5}
      px={2}
      py={0.5}
      borderRadius="full"
      bg="bg.panel"
      borderWidth="1px"
      borderColor={tc.isError ? 'red.emphasized' : 'border'}
      flexShrink={0}
    >
      <StatusGlyph tc={tc} reduce={reduce} streaming={streaming} />
      <Text fontSize="xs" fontWeight="medium" colorPalette={tone} color={`${tone}.fg`} whiteSpace="nowrap">
        {toolLabel(tc.name)}
      </Text>
    </HStack>
  );
}

/** ✓ when done, ✕ on error, a breathing dot while the tool runs — and a static dot once the turn has
 * settled without finishing (the user pressed Stop, or the turn failed mid-tool, P1.1) so a never-finished
 * tool doesn't breathe forever. */
function StatusGlyph({ tc, reduce, streaming }: { tc: ToolCallSummary; reduce: boolean; streaming: boolean }) {
  if (tc.isError) return <Icon as={LuX} boxSize={3} color="red.fg" flexShrink={0} />;
  if (tc.done) return <Icon as={LuCheck} boxSize={3} color="pine.fg" flexShrink={0} />;
  if (!streaming) {
    // Settled without output (stopped/aborted): a static muted dot, never an endless animation.
    return (
      <Box as="span" display="inline-block" w="7px" h="7px" borderRadius="full" bg="fg.subtle" opacity={0.5} flexShrink={0} />
    );
  }
  // Running: a breathing dot (opacity loop is a tween — never a spring keyframe array; gated on reduce).
  return (
    <motion.span
      animate={reduce ? { opacity: 1 } : { opacity: [1, 0.3, 1] }}
      transition={reduce ? { duration: 0 } : { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 999, background: 'var(--chakra-colors-trail-solid)', flexShrink: 0 }}
    />
  );
}

function ReasoningDisclosure({
  reasoning,
  open,
  onToggle,
  reveal,
  reduce,
  id,
}: {
  reasoning: { text: string; streaming: boolean };
  open: boolean;
  onToggle: () => void;
  reveal: Transition;
  reduce: boolean;
  id: string;
}) {
  return (
    <Box borderTopWidth="1px" borderColor="border" pt={2}>
      <chakra.button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} cursor="pointer">
        <HStack gap={1.5} color="accent.fg">
          <Icon as={LuBrain} boxSize={3.5} />
          <Text fontSize="xs" fontWeight="semibold">
            {open ? 'Hide reasoning' : 'Show reasoning'}
          </Text>
          <motion.div animate={{ rotate: open ? 180 : 0 }} transition={reduce ? { duration: 0 } : { duration: durations.fast }} style={{ display: 'inline-flex' }}>
            <Icon as={LuChevronDown} boxSize={3.5} />
          </motion.div>
        </HStack>
      </chakra.button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="reason" id={id} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={reveal} style={{ overflow: 'hidden' }}>
            <Box pt={2}>
              <ReasoningBody reasoning={reasoning} reduce={reduce} />
            </Box>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Box>
  );
}

function ReasoningBody({ reasoning, reduce }: { reasoning: { text: string; streaming: boolean }; reduce: boolean }) {
  return (
    <Text fontSize="xs" color="fg.muted" fontStyle="italic" whiteSpace="pre-wrap" overflowWrap="anywhere">
      {reasoning.text}
      {reasoning.streaming ? (
        <motion.span
          animate={reduce ? { opacity: 1 } : { opacity: [1, 0.2, 1] }}
          transition={reduce ? { duration: 0 } : { duration: 1, repeat: Infinity }}
          style={{ display: 'inline-block', marginLeft: 2 }}
        >
          ▍
        </motion.span>
      ) : null}
    </Text>
  );
}

function safeJson(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
