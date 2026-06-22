/**
 * Sanity-checks that the schema is in place. Run with: pnpm db:verify
 */
import '../lib/load-env';
import { readGraph, closeDriver } from '../lib/neo4j';

async function main() {
  const constraints = await readGraph('SHOW CONSTRAINTS YIELD name RETURN count(*) AS n');
  const indexes = await readGraph(
    "SHOW INDEXES YIELD name, type RETURN type AS type, count(*) AS n",
  );
  console.log('Constraints:', constraints[0]?.n ?? 0);
  console.table(indexes);
  await closeDriver();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
