'use client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Heading, Text, List, Link as CLink, Separator, Code, Box, Table } from '@chakra-ui/react';
import type { ReactNode } from 'react';

/**
 * Renders the ranger's markdown into Chakra elements (D5/§2.2) — no more literal `##`/`**`/`---`.
 * react-markdown does not emit raw HTML by default, so this is safe; we map a small element subset.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <Box fontSize="sm" lineHeight="1.6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children: c }) => <Heading size="md" mt={3} mb={1}>{c as ReactNode}</Heading>,
          h2: ({ children: c }) => <Heading size="sm" mt={3} mb={1}>{c as ReactNode}</Heading>,
          h3: ({ children: c }) => <Heading size="xs" mt={2} mb={1}>{c as ReactNode}</Heading>,
          h4: ({ children: c }) => <Heading size="xs" mt={2} mb={1}>{c as ReactNode}</Heading>,
          p: ({ children: c }) => <Text mb={2}>{c as ReactNode}</Text>,
          ul: ({ children: c }) => <List.Root mb={2} ps={4}>{c as ReactNode}</List.Root>,
          ol: ({ children: c }) => <List.Root as="ol" mb={2} ps={4}>{c as ReactNode}</List.Root>,
          li: ({ children: c }) => <List.Item>{c as ReactNode}</List.Item>,
          a: ({ children: c, href }) => (
            <CLink href={href} color="blue.600" target="_blank" rel="noreferrer">{c as ReactNode}</CLink>
          ),
          hr: () => <Separator my={3} />,
          code: ({ children: c }) => <Code fontSize="xs">{c as ReactNode}</Code>,
          // Trip Summary tables (§3.6) — proper cell spacing instead of run-together text.
          table: ({ children: c }) => (
            <Table.Root size="sm" variant="outline" my={3}>{c as ReactNode}</Table.Root>
          ),
          thead: ({ children: c }) => <Table.Header>{c as ReactNode}</Table.Header>,
          tbody: ({ children: c }) => <Table.Body>{c as ReactNode}</Table.Body>,
          tr: ({ children: c }) => <Table.Row>{c as ReactNode}</Table.Row>,
          th: ({ children: c }) => <Table.ColumnHeader px={3} py={1.5}>{c as ReactNode}</Table.ColumnHeader>,
          td: ({ children: c }) => <Table.Cell px={3} py={1.5}>{c as ReactNode}</Table.Cell>,
          strong: ({ children: c }) => <Text as="strong" fontWeight="semibold">{c as ReactNode}</Text>,
          em: ({ children: c }) => <Text as="em">{c as ReactNode}</Text>,
        }}
      >
        {children}
      </ReactMarkdown>
    </Box>
  );
}
