'use client';
import { useState } from 'react';
import { Button, HStack, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';

/**
 * Park-page actions (§4): let users express preference. "Save" records a memory signal (considered,
 * source 'saved'); "Plan a trip" jumps to the builder. No-ops gracefully for anonymous users.
 */
export function ParkActions({ parkCode }: { parkCode: string }) {
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaved(true);
    await fetch('/api/considered', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parkCode, source: 'saved' }),
    }).catch(() => setSaved(false));
  }

  return (
    <HStack gap={3}>
      <Button colorPalette="blue" variant={saved ? 'solid' : 'outline'} onClick={save} disabled={saved}>
        {saved ? '♥ Saved' : '♥ Save'}
      </Button>
      <Button asChild variant="outline"><NextLink href="/plan">Plan a trip →</NextLink></Button>
    </HStack>
  );
}
