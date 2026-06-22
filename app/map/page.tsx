import { Box, Heading, Link as CLink } from '@chakra-ui/react';
import NextLink from 'next/link';
import { MapExplorer } from '../../components/MapExplorer';

/** Full-screen map explorer (B1-B3). Offers a list-view equivalent for accessibility (WCAG, §14). */
export default function MapPage() {
  return (
    <Box position="fixed" top="57px" left={0} right={0} bottom={0}>
      <Heading as="h1" srOnly>Map of National Parks</Heading>
      <MapExplorer />
      <CLink
        asChild
        position="absolute"
        bottom={3}
        left={3}
        bg="bg.panel"
        borderWidth="1px"
        borderRadius="md"
        px={3}
        py={1.5}
        fontSize="sm"
        shadow="md"
      >
        <NextLink href="/explore">List view →</NextLink>
      </CLink>
    </Box>
  );
}
