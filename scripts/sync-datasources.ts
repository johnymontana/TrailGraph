import '../lib/load-env';
import { closeDriver } from '../lib/neo4j';
import { syncDataSources } from '../lib/datasources';

/**
 * Apply all §5 data-source adapters (dark-sky, visitation/crowds, trail difficulty, reservations) into
 * the graph. Idempotent. Run: pnpm datasources:sync
 */
async function main() {
  const res = await syncDataSources();
  console.log('✓ Data sources synced:', res);
  await closeDriver();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
