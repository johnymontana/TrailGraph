'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import { Box, Button, Container, Heading, HStack, Icon, Text, Wrap, Spinner, Link as CLink } from '@chakra-ui/react';
import { LuCheck, LuCompass } from 'react-icons/lu';
import { heroContourTexture } from '../../theme/textures';

/**
 * 20-second onboarding seed (§5.5): pick what you love so the ranger and "For you" have something to
 * personalize from on day one. Each pick writes a canonical preference (NAMS + PREFERS bridge). The
 * server wrapper (`page.tsx`) only renders this for a signed-in user with no preferences yet (ADR-038).
 */
const CHOICES: { category: string; value: string; label: string }[] = [
  { category: 'topic', value: 'Lakes', label: 'Alpine lakes' },
  { category: 'activity', value: 'stargazing', label: 'Dark skies' },
  { category: 'crowd', value: 'fewer crowds', label: 'Fewer crowds' },
  { category: 'topic', value: 'history', label: 'History' },
  { category: 'activity', value: 'birding', label: 'Wildlife & birding' },
  { category: 'activity', value: 'Hiking', label: 'Easy hikes' },
  { category: 'activity', value: 'backcountry skiing', label: 'Backcountry skiing' },
  { category: 'activity', value: 'climbing', label: 'Climbing' },
];

export function OnboardingClient() {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  function toggle(label: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    const chosen = CHOICES.filter((c) => picked.has(c.label));
    await Promise.all(
      chosen.map((c) =>
        fetch('/api/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'addPreference', category: c.category, value: c.value }),
        }).catch(() => {}),
      ),
    );
    router.push('/me');
  }

  return (
    <Box
      bg="bg.subtle"
      backgroundImage={heroContourTexture}
      borderBottomWidth="1px"
      borderColor="border"
      minH="calc(100vh - 57px)"
    >
      <Container maxW="2xl" px={{ base: 4, md: 8 }} py={{ base: 12, md: 20 }}>
        <HStack gap={2} color="accent.fg" mb={3}>
          <Icon as={LuCompass} boxSize={4} />
          <Text fontSize="xs" fontWeight="bold" letterSpacing="0.14em" textTransform="uppercase">
            Welcome to TrailGraph
          </Text>
        </HStack>
        <Heading as="h1" size={{ base: '2xl', md: '3xl' }} mb={3} lineHeight="1.1">
          What do you love about parks?
        </Heading>
        <Text color="fg.muted" mb={8} fontSize="lg">
          Pick a few — the ranger uses these to tailor recommendations. You can change or delete them
          anytime on your memory page.
        </Text>

        <Wrap gap={3} mb={10}>
          {CHOICES.map((c) => {
            const on = picked.has(c.label);
            return (
              <Button
                key={c.label}
                size="lg"
                variant={on ? 'solid' : 'outline'}
                colorPalette="pine"
                bg={on ? undefined : 'bg.panel'}
                onClick={() => toggle(c.label)}
                aria-pressed={on}
              >
                {on ? <Icon as={LuCheck} /> : null}
                {c.label}
              </Button>
            );
          })}
        </Wrap>

        <HStack gap={4}>
          <Button colorPalette="pine" size="lg" onClick={save} disabled={picked.size === 0 || saving}>
            {saving ? <Spinner size="sm" mr={2} /> : null}
            Save {picked.size > 0 ? `${picked.size} ` : ''}and continue
          </Button>
          <CLink asChild color="fg.muted" fontSize="sm">
            <NextLink href="/explore">Skip for now</NextLink>
          </CLink>
        </HStack>
      </Container>
    </Box>
  );
}
