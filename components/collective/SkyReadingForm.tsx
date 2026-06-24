'use client';
import { useState } from 'react';
import { Box, Button, HStack, Input, Stack, Text } from '@chakra-ui/react';
import { LuTelescope } from 'react-icons/lu';

/**
 * Log-a-sky-reading form (Collective Intelligence v2, ADR-053) — a user submits their own SQM
 * measurement for a park; it feeds the anonymized community leaderboard (opt-in). Client; posts to
 * /api/readings, which validates (16–22 mag/arcsec²) server-side.
 */
export function SkyReadingForm({ parkCode }: { parkCode: string; parkName?: string }) {
  const [sqm, setSqm] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function submit() {
    const val = parseFloat(sqm);
    if (Number.isNaN(val)) {
      setStatus('error');
      setMsg('Enter a number, e.g. 21.4');
      return;
    }
    setStatus('saving');
    try {
      const res = await fetch('/api/readings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parkCode, sqm: val }),
      });
      if (res.ok) {
        setStatus('done');
        setMsg('Logged — thanks for contributing to the dark-sky map!');
        setSqm('');
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus('error');
        setMsg(d.error ?? 'Could not save your reading.');
      }
    } catch {
      setStatus('error');
      setMsg('Could not save your reading.');
    }
  }

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg.panel" p={4}>
      <HStack gap={2} mb={1}>
        <LuTelescope />
        <Text fontWeight="semibold" fontFamily="heading" fontSize="sm">
          Log a sky reading
        </Text>
      </HStack>
      <Text fontSize="xs" color="fg.muted" mb={3}>
        Measured the sky with an SQM meter or app? Add your reading (16 = city glow … 22 = pristine). Opt
        in under “Travelers like you” to share it on the community leaderboard.
      </Text>
      <HStack gap={2}>
        <Input
          value={sqm}
          onChange={(e) => setSqm(e.target.value)}
          placeholder="e.g. 21.6"
          type="number"
          step="0.1"
          min={16}
          max={22}
          maxW="140px"
          size="sm"
        />
        <Button onClick={submit} loading={status === 'saving'} colorPalette="pine" size="sm">
          Log reading
        </Button>
      </HStack>
      {msg ? (
        <Text fontSize="xs" mt={2} color={status === 'error' ? 'orange.fg' : 'brand.fg'}>
          {msg}
        </Text>
      ) : null}
    </Box>
  );
}
