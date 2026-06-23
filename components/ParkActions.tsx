'use client';
import { useState } from 'react';
import { Button, HStack, Icon } from '@chakra-ui/react';
import NextLink from 'next/link';
import { LuHeart, LuRoute } from 'react-icons/lu';
import { toast } from '../lib/toast';

/**
 * Park-page actions (§4): let users express preference. "Save" records a memory signal (considered,
 * source 'saved'); "Plan a trip" jumps to the builder. No-ops gracefully for anonymous users.
 */
export function ParkActions({ parkCode }: { parkCode: string }) {
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaved(true);
    const res = await fetch('/api/considered', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parkCode, source: 'saved' }),
    }).catch(() => null);
    const payload = res ? await res.json().catch(() => null) : null;
    if (res?.ok && payload?.ok !== false) {
      toast.success('Saved to your parks', 'The ranger will factor this into your recommendations.');
    } else {
      setSaved(false);
      toast.error("Couldn't save", 'Sign in to save parks to your memory.');
    }
  }

  return (
    <HStack gap={3}>
      <Button colorPalette="trail" variant={saved ? 'solid' : 'outline'} onClick={save} disabled={saved}>
        <Icon as={LuHeart} fill={saved ? 'currentColor' : 'none'} /> {saved ? 'Saved' : 'Save'}
      </Button>
      <Button asChild colorPalette="pine">
        <NextLink href="/plan">
          <Icon as={LuRoute} /> Plan a trip
        </NextLink>
      </Button>
    </HStack>
  );
}
