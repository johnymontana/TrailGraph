import { Box, Button, HStack } from '@chakra-ui/react';
import NextLink from 'next/link';
import { LuMountainSnow } from 'react-icons/lu';
import { EmptyState } from '../components/ui/empty-state';

/** Friendly 404 with recovery paths (§2.16) instead of the bare Next default. */
export default function NotFound() {
  return (
    <Box maxW="2xl" mx="auto" px={4} py={24}>
      <EmptyState
        icon={<LuMountainSnow />}
        title="We couldn't find that page"
        description="The park or page you're looking for doesn't exist. Try exploring from here."
      >
        <HStack justify="center" gap={3} mt={2}>
          <Button asChild colorPalette="pine">
            <NextLink href="/explore">Explore parks</NextLink>
          </Button>
          <Button asChild variant="outline">
            <NextLink href="/">Home</NextLink>
          </Button>
        </HStack>
      </EmptyState>
    </Box>
  );
}
