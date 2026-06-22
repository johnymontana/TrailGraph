'use client';
import { useEffect } from 'react';

/**
 * Fire-and-forget beacon: when a signed-in user views a park, record it as a "considered" memory
 * signal (§5). Renders nothing; the API no-ops for anonymous sessions.
 */
export function RecordView({ parkCode }: { parkCode: string }) {
  useEffect(() => {
    fetch('/api/considered', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parkCode }),
      keepalive: true,
    }).catch(() => {});
  }, [parkCode]);
  return null;
}
