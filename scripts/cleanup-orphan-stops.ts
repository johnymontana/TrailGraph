import '../lib/load-env';
import { writeGraph, closeDriver } from '../lib/neo4j';

/**
 * One-time cleanup (R2 §2.4): delete legacy `:Stop` nodes that have no resolvable park/campground/POI
 * and no custom name/location — the nameless "1. Stop" entries created before addStop validation.
 * Safe to re-run. Run: pnpm cleanup:orphan-stops
 */
async function main() {
  const rows = await writeGraph<{ deleted: number }>(
    `MATCH (s:Stop)
     WHERE NOT (s)-[:OF_PARK|OF_CAMPGROUND|OF_POI]->()
       AND s.name IS NULL AND s.location IS NULL
     WITH collect(s) AS orphans
     FOREACH (o IN orphans | DETACH DELETE o)
     RETURN size(orphans) AS deleted`,
  );
  console.log(`✓ removed ${rows[0]?.deleted ?? 0} orphan stop(s)`);
  await closeDriver();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
