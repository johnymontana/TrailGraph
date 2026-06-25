'use client';
import { useState } from 'react';
import { Button, Icon } from '@chakra-ui/react';
import { LuCheck, LuLink } from 'react-icons/lu';

/**
 * Copy the current page URL to the clipboard (for the certificate share page). Client island — reads
 * `window.location.href` in the click handler (never at render, so SSR is unaffected).
 */
export function CopyLinkButton({ label = 'Copy share link' }: { label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      colorPalette="pine"
      size="sm"
      borderRadius="full"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard blocked (insecure context / permissions) — no-op */
        }
      }}
    >
      <Icon>{copied ? <LuCheck /> : <LuLink />}</Icon>
      {copied ? 'Copied!' : label}
    </Button>
  );
}
