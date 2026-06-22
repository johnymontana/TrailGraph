import { Box, Heading, Text, Button, HStack } from '@chakra-ui/react';
import NextLink from 'next/link';

/** Friendly 404 with recovery paths (§2.16) instead of the bare Next default. */
export default function NotFound() {
  return (
    <Box maxW="2xl" mx="auto" px={4} py={20} textAlign="center">
      <Heading size="lg" mb={2}>We couldn&apos;t find that page</Heading>
      <Text color="fg.muted" mb={6}>
        The park or page you&apos;re looking for doesn&apos;t exist. Try exploring from here.
      </Text>
      <HStack justify="center" gap={3}>
        <Button asChild colorPalette="blue"><NextLink href="/explore">Explore parks</NextLink></Button>
        <Button asChild variant="outline"><NextLink href="/">Home</NextLink></Button>
      </HStack>
    </Box>
  );
}
