'use client';
import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  Field,
  Flex,
  Heading,
  HStack,
  Icon,
  Input,
  Stack,
  Text,
} from '@chakra-ui/react';
import { LuCheck, LuCompass, LuMail, LuMountainSnow, LuNetwork, LuSparkles } from 'react-icons/lu';
import { signIn } from '../../lib/auth-client';
import { heroContourTexture } from '../../theme/textures';

/** Passwordless magic-link sign-in (F1, ADR-008). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PERKS = [
  { icon: LuSparkles, text: 'An AI ranger that remembers what you love' },
  { icon: LuNetwork, text: '470+ parks as one connected, explorable graph' },
  { icon: LuCompass, text: 'Trips with drive times, fees, and alerts — share a link' },
];

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
    <Flex minH="calc(100vh - 57px)">
      {/* Brand panel (desktop) */}
      <Box
        flex="1"
        display={{ base: 'none', lg: 'flex' }}
        flexDirection="column"
        justifyContent="center"
        gap={8}
        px={16}
        bg="bg.subtle"
        backgroundImage={heroContourTexture}
        borderRightWidth="1px"
        borderColor="border"
      >
        <HStack gap={2}>
          <Icon as={LuMountainSnow} color="brand.solid" boxSize={7} />
          <Text fontFamily="heading" fontWeight="bold" letterSpacing="0.08em" fontSize="xl">
            TRAILGRAPH
          </Text>
        </HStack>
        <Heading size="2xl" maxW="md" lineHeight="1.1">
          Your next park trip, planned by a ranger who knows you.
        </Heading>
        <Stack gap={4}>
          {PERKS.map((p) => (
            <HStack key={p.text} gap={3}>
              <Box boxSize={9} borderRadius="l2" bg="brand.muted" color="brand.fg" display="flex" alignItems="center" justifyContent="center" flexShrink={0}>
                <Icon as={p.icon} boxSize={5} />
              </Box>
              <Text color="fg.muted">{p.text}</Text>
            </HStack>
          ))}
        </Stack>
      </Box>

      {/* Form */}
      <Flex flex="1" align="center" justify="center" p={{ base: 6, md: 10 }}>
        <Card.Root variant="elevated" w="full" maxW="sm">
          <Card.Body p={{ base: 6, md: 8 }}>
            <Stack gap={2} mb={6}>
              <Heading as="h1" size="lg">
                Sign in to TrailGraph
              </Heading>
              <Text color="fg.muted" fontSize="sm">
                We&apos;ll email you a one-time sign-in link — no password. Browse freely without an
                account; sign in to unlock the ranger and graph-native memory.
              </Text>
            </Stack>

            {state === 'sent' ? (
              <Stack
                align="center"
                textAlign="center"
                gap={3}
                borderWidth="1px"
                borderColor="brand.muted"
                borderRadius="l2"
                p={6}
                bg="brand.subtle"
              >
                <Box boxSize={12} borderRadius="full" bg="brand.solid" color="brand.contrast" display="flex" alignItems="center" justifyContent="center">
                  <Icon as={LuCheck} boxSize={6} />
                </Box>
                <Text fontWeight="semibold" fontFamily="heading">Check your inbox</Text>
                <Text fontSize="sm" color="fg.muted">
                  We sent a sign-in link to <Text as="span" fontWeight="medium" color="fg">{email.trim()}</Text>.
                </Text>
              </Stack>
            ) : (
              <Stack gap={4}>
                <Field.Root invalid={state === 'invalid'}>
                  <Field.Label>Email address</Field.Label>
                  <Box position="relative" w="full">
                    <Box position="absolute" left={3} top="50%" transform="translateY(-50%)" color="fg.subtle" pointerEvents="none">
                      <Icon as={LuMail} boxSize={4} />
                    </Box>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      ps={9}
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (state === 'invalid' || state === 'error') setState('idle');
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && send()}
                    />
                  </Box>
                  <Field.ErrorText>Please enter a valid email address.</Field.ErrorText>
                </Field.Root>
                <Button colorPalette="pine" size="lg" onClick={send} loading={state === 'sending'} disabled={!email}>
                  Send magic link
                </Button>
                {state === 'error' ? (
                  <Text color="red.fg" fontSize="sm">
                    We couldn&apos;t send the link right now — please try again in a moment.
                  </Text>
                ) : null}
              </Stack>
            )}
          </Card.Body>
        </Card.Root>
      </Flex>
    </Flex>
  );
}
