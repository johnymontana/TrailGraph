'use client';
import { useState } from 'react';
import { Box, Heading, Text, Input, Button, Stack } from '@chakra-ui/react';
import { signIn } from '../../lib/auth-client';

/** Passwordless magic-link sign-in (F1, ADR-008). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'invalid' | 'error'>('idle');

  async function send() {
    if (!EMAIL_RE.test(email.trim())) {
      setState('invalid'); // §2.12: distinguish a malformed address from a server failure
      return;
    }
    setState('sending');
    // New users land on /onboarding to seed a few preferences (the onboarding route bounces returning
    // users with existing preferences straight to /explore). See ADR-038.
    const { error } = await signIn.magicLink({ email: email.trim(), callbackURL: '/onboarding?welcome=1' });
    setState(error ? 'error' : 'sent');
  }

  return (
    <Box maxW="sm" mx="auto" px={4} py={16}>
      <Heading as="h1" size="lg" mb={2}>
        Sign in to TrailGraph
      </Heading>
      <Text color="fg.muted" mb={2}>
        We&apos;ll email you a one-time sign-in link — no password.
      </Text>
      <Text color="fg.muted" fontSize="sm" mb={6}>
        Browse freely without an account. Sign in to unlock the ranger and let TrailGraph remember what
        you love.
      </Text>

      {state === 'sent' ? (
        <Box borderWidth="1px" borderRadius="md" p={4} bg="bg.subtle">
          <Text>Check your inbox for a sign-in link.</Text>
        </Box>
      ) : (
        <Stack gap={3}>
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state === 'invalid' || state === 'error') setState('idle');
            }}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            aria-invalid={state === 'invalid'}
          />
          <Button colorPalette="blue" onClick={send} loading={state === 'sending'} disabled={!email}>
            Send magic link
          </Button>
          {state === 'invalid' ? (
            <Text color="red.500">Please enter a valid email address.</Text>
          ) : null}
          {state === 'error' ? (
            <Text color="red.500">We couldn&apos;t send the link right now — please try again in a moment.</Text>
          ) : null}
        </Stack>
      )}
    </Box>
  );
}
