'use client';
import { Box, HStack, Stack, Text } from '@chakra-ui/react';
import { LuCalendar, LuCalendarCheck, LuMoonStar, LuNewspaper, LuTriangleAlert } from 'react-icons/lu';

/**
 * Presentational digest item list (Proactive Ranger, ADR-052) — reused by the chat `digest_card` and the
 * /me inbox. Tone drives the accent: warn = closures/alerts, good = dark-sky/fee-free windows, info =
 * events/news (Proactive Ranger P1-1).
 */
export interface DigestItemView {
  kind: 'closure' | 'alert' | 'darksky' | 'feefree' | 'event' | 'news';
  parkName?: string;
  title: string;
  detail: string;
  tone: 'good' | 'warn' | 'info';
}

const TONE_BORDER: Record<DigestItemView['tone'], string> = { good: 'trail.solid', warn: 'orange.solid', info: 'border' };

function ItemIcon({ kind }: { kind: DigestItemView['kind'] }) {
  if (kind === 'darksky') return <LuMoonStar />;
  if (kind === 'feefree') return <LuCalendarCheck />;
  if (kind === 'event') return <LuCalendar />;
  if (kind === 'news') return <LuNewspaper />;
  return <LuTriangleAlert />;
}

export function DigestItems({ items, emptyHint }: { items: DigestItemView[]; emptyHint?: string }) {
  if (!items.length) {
    return (
      <Text fontSize="sm" color="fg.muted">
        {emptyHint ?? 'All clear — no closures or alerts on your watched trips, and the moon is up tonight.'}
      </Text>
    );
  }
  return (
    <Stack gap={2}>
      {items.map((it, i) => (
        <Box key={i} borderLeftWidth="4px" borderColor={TONE_BORDER[it.tone]} pl={3} py={1}>
          <HStack gap={2}>
            <ItemIcon kind={it.kind} />
            <Text fontWeight="semibold" fontSize="sm" fontFamily="heading">
              {it.title}
            </Text>
          </HStack>
          <Text fontSize="sm" color="fg.muted">
            {it.detail}
          </Text>
        </Box>
      ))}
    </Stack>
  );
}
