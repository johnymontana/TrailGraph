import '../lib/load-env';
import { writeGraph, closeDriver } from '../lib/neo4j';

/**
 * Reset specific sync checkpoints so the next `tier=slow` run re-syncs just those resources (the
 * resume logic skips any step with a fresh OK `:SyncState`). Use this after changing a resource's
 * upsert/parse logic — far cheaper than `SYNC_FORCE=1`, which re-fetches the whole corpus.
 *
 *   pnpm sync:reset amenities-places amenities-vcs
 */
export async function resetSyncCheckpoints(resources: string[]): Promise<number> {
  if (!resources.length) return 0;
  const r = await writeGraph<{ c: number }>(
    `MATCH (s:SyncState) WHERE s.resource IN $resources DETACH DELETE s RETURN count(s) AS c`,
    { resources },
  );
  return r[0]?.c ?? 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const resources = process.argv.slice(2);
  if (!resources.length) {
    console.error('usage: pnpm sync:reset <resource> [<resource>...]');
    process.exit(1);
  }
  resetSyncCheckpoints(resources)
    .then((n) => {
      console.log(`✓ reset ${n} checkpoint(s): ${resources.join(', ')}`);
      return closeDriver();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
