import { Box, Container, Heading, Stack, Text } from '@chakra-ui/react';
import { notFound } from 'next/navigation';
import { heroContourTexture } from '../../../../theme/textures';
import { certificateBySlug } from '../../../../lib/learn-queries';
import { CopyLinkButton } from '../../../../components/learn/CopyLinkButton';

export const dynamic = 'force-dynamic';

/**
 * Public certificate share page (`/learn/cert/<shareSlug>`). The slug is the only token — no auth, no PII.
 * `notFound()` when the slug doesn't resolve. This is the target of `next_step_card`'s share link.
 */
export default async function CertificatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cert = await certificateBySlug(slug);
  if (!cert) notFound();

  return (
    <Container maxW="2xl" px={{ base: 4, md: 8 }} py={{ base: 10, md: 16 }}>
      <Box
        borderWidth="2px"
        borderColor="pine.solid"
        borderRadius="l3"
        bg="bg.panel"
        backgroundImage={heroContourTexture}
        p={{ base: 8, md: 12 }}
        textAlign="center"
      >
        <Text fontSize="xs" fontWeight="bold" color="accent.fg" letterSpacing="0.2em" textTransform="uppercase" mb={4}>
          Ranger School
        </Text>
        <Heading as="h1" fontFamily="heading" size="2xl" mb={2}>
          Certificate of Completion
        </Heading>
        <Text color="fg.muted" mb={8}>This certifies the completion of</Text>
        <Heading as="h2" size="xl" color="pine.fg" mb={8}>
          {cert.courseTitle ?? 'a Ranger School course'}
        </Heading>
        <Stack direction={{ base: 'column', sm: 'row' }} justify="center" gap={8}>
          {typeof cert.score === 'number' ? (
            <Box>
              <Text fontSize="xs" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">Score</Text>
              <Text fontFamily="heading" fontSize="2xl" fontWeight="bold">{Math.round(cert.score * 100)}%</Text>
            </Box>
          ) : null}
          {cert.issuedAt ? (
            <Box>
              <Text fontSize="xs" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em">Issued</Text>
              <Text fontFamily="heading" fontSize="2xl" fontWeight="bold">{cert.issuedAt.slice(0, 10)}</Text>
            </Box>
          ) : null}
        </Stack>
        <Box mt={10}>
          <CopyLinkButton />
        </Box>
      </Box>
    </Container>
  );
}
