import '../../lib/load-env';
import { describe } from 'vitest';
import { readGraph } from '../../lib/neo4j';

/**
 * Integration tests run ONLY when `RUN_INTEGRATION=1` AND a Neo4j is reachable. The explicit gate is
 * a safety rail: the seed uses real parkCodes and MERGE-overwrites park properties, so it must never
 * run against a populated production DB. CI sets RUN_INTEGRATION=1 and points NEO4J_* at an ephemeral
 * service container; local `pnpm test` skips these by default.
 */
let available = false;
if (process.env.RUN_INTEGRATION === '1') {
  try {
    await readGraph('RETURN 1 AS ok');
    available = true;
  } catch {
    // eslint-disable-next-line no-console
    console.warn('[integration] RUN_INTEGRATION=1 but no Neo4j reachable — skipping');
  }
} else {
  // eslint-disable-next-line no-console
  console.warn('[integration] RUN_INTEGRATION!=1 — skipping integration tests (safety rail)');
}

export const dbAvailable = available;
export const describeIntegration = available ? describe : describe.skip;
