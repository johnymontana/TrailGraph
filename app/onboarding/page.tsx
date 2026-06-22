'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Heading, Text, Wrap, Button, Spinner } from '@chakra-ui/react';

/**
 * 20-second onboarding seed (§5.5): pick what you love so the ranger and "For you" have something to
 * personalize from on day one. Each pick writes a canonical preference (NAMS + PREFERS bridge).
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

export default function OnboardingPage() {
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
    <Box maxW="2xl" mx="auto" px={{ base: 4, md: 8 }} py={12}>
      <Heading as="h1" size="lg" mb={2}>What do you love about parks?</Heading>
      <Text color="fg.muted" mb={6}>
        Pick a few — the ranger uses these to tailor recommendations. You can change or delete them
        anytime on your memory page.
      </Text>
      <Wrap gap={3} mb={8}>
        {CHOICES.map((c) => (
          <Button
            key={c.label}
            variant={picked.has(c.label) ? 'solid' : 'outline'}
            colorPalette="blue"
            onClick={() => toggle(c.label)}
          >
            {c.label}
          </Button>
        ))}
      </Wrap>
      <Button colorPalette="blue" onClick={save} disabled={picked.size === 0 || saving}>
        {saving ? <Spinner size="sm" mr={2} /> : null}
        Save {picked.size > 0 ? `${picked.size} ` : ''}and continue
      </Button>
    </Box>
  );
}
