import '../lib/load-env';
import { closeDriver } from '../lib/neo4j';
import { gdsAvailable } from '../lib/graph-analytics';
import { deriveCentrality } from '../lib/sync/derive-centrality';
import { deriveCommunities } from '../lib/sync/derive-communities';

/**
 * Rebuild the GDS graph analytics (#7) on demand, bypassing the slow-sync 20h step-skip — run after a sync
 * or when iterating on the analytics. Requires the GDS plugin on the target Neo4j (NEVER prod unless
 * intended). Depends on the materialized SHARES_TOPIC/SHARES_ACTIVITY edges (run `pnpm datasources:sync`
 * first if the graph is fresh).
 */
async function main() {
  if (!(await gdsAvailable())) {
    console.error('GDS is not available on this Neo4j — nothing to rebuild. (Install the GDS plugin.)');
    return;
  }
  console.log('centrality :', await deriveCentrality());
  console.log('communities:', await deriveCommunities());
  console.log('done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDriver());
