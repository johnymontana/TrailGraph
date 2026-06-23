import { Box, Container, Heading, HStack, Stack, Text } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { contourTexture } from '../../theme/textures';

export interface PageHeaderProps {
  /** Small uppercase brand eyebrow, e.g. "EXPLORE". */
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Optional trailing controls (buttons, links). */
  actions?: ReactNode;
  /** Render the subtle contour texture band behind the header. */
  contour?: boolean;
  children?: ReactNode;
}

/** Standard page header band — eyebrow + title + subtitle, optional contour texture and trailing actions. */
export function PageHeader({ eyebrow, title, subtitle, actions, contour, children }: PageHeaderProps) {
  return (
    <Box
      borderBottomWidth={contour ? '1px' : undefined}
      borderColor="border"
      bg={contour ? 'bg.subtle' : undefined}
      backgroundImage={contour ? contourTexture : undefined}
    >
      <Container maxW="6xl" px={{ base: 4, md: 8 }} py={{ base: 8, md: 10 }}>
        <Stack direction={{ base: 'column', md: 'row' }} justify="space-between" align={{ base: 'start', md: 'end' }} gap={4}>
          <Stack gap={2} maxW="3xl">
            {eyebrow ? (
              <Text fontSize="xs" fontWeight="bold" color="accent.fg" letterSpacing="0.12em" textTransform="uppercase">
                {eyebrow}
              </Text>
            ) : null}
            <Heading as="h1" size={{ base: '2xl', md: '3xl' }} lineHeight="1.1">
              {title}
            </Heading>
            {subtitle ? (
              <Text fontSize={{ base: 'md', md: 'lg' }} color="fg.muted">
                {subtitle}
              </Text>
            ) : null}
            {children}
          </Stack>
          {actions ? <HStack gap={3}>{actions}</HStack> : null}
        </Stack>
      </Container>
    </Box>
  );
}
