import { EmptyState as ChakraEmptyState, VStack } from '@chakra-ui/react';
import * as React from 'react';

export interface EmptyStateProps extends ChakraEmptyState.RootProps {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
}

/**
 * Branded empty/zero state (Chakra v3 official snippet shape). Used for no-results, signed-out surfaces,
 * and 404. Pass an icon (react-icons), a title, optional description, and CTA buttons as children.
 */
export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(props, ref) {
  const { title, description, icon, children, ...rest } = props;
  return (
    <ChakraEmptyState.Root ref={ref} {...rest}>
      <ChakraEmptyState.Content>
        {icon ? (
          <ChakraEmptyState.Indicator color="brand.solid">{icon}</ChakraEmptyState.Indicator>
        ) : null}
        <VStack textAlign="center" gap={1}>
          <ChakraEmptyState.Title fontFamily="heading">{title}</ChakraEmptyState.Title>
          {description ? (
            <ChakraEmptyState.Description>{description}</ChakraEmptyState.Description>
          ) : null}
        </VStack>
        {children}
      </ChakraEmptyState.Content>
    </ChakraEmptyState.Root>
  );
});
