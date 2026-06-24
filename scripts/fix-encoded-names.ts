import '../lib/load-env';
import { readGraph, writeGraph, closeDriver } from '../lib/neo4j';
import { decodeEntities } from '../lib/html-entities';

/**
 * One-time backfill (R5 §2.1): trip/stop names created before the write-boundary decode landed may hold
 * literal HTML entities (e.g. "Four Corners … &amp; Dark Skies"), which render as `&amp;` to the user.
 * Decode them in place. Idempotent — re-running on clean data is a no-op (decodeEntities is identity on
 * entity-free text, and we only touch rows whose name still contains an entity). Run: pnpm db:fix-encoded-names
 */
async function main() {
  let trips = 0;
  let stops = 0;

  // Trips. We match on a literal "&…;" entity so we don't churn every row; decode + write back when changed.
  const tripRows = await readGraph<{ id: string; userId: string; name: string }>(
    `MATCH (t:Trip) WHERE t.name =~ '.*&(amp|lt|gt|quot|apos|nbsp|#x?[0-9a-fA-F]+);.*'
     RETURN t.id AS id, t.userId AS userId, t.name AS name`,
  );
  for (const t of tripRows) {
    const decoded = decodeEntities(t.name);
    if (decoded === t.name) continue;
    await writeGraph(`MATCH (t:Trip {id:$id, userId:$userId}) SET t.name = $name`, {
      id: t.id,
      userId: t.userId,
      name: decoded,
    });
    trips++;
  }

  // Stops (custom stop labels carry the same risk).
  const stopRows = await readGraph<{ id: string; name: string }>(
    `MATCH (s:Stop) WHERE s.name =~ '.*&(amp|lt|gt|quot|apos|nbsp|#x?[0-9a-fA-F]+);.*'
     RETURN s.id AS id, s.name AS name`,
  );
  for (const s of stopRows) {
    const decoded = decodeEntities(s.name);
    if (decoded === s.name) continue;
    await writeGraph(`MATCH (s:Stop {id:$id}) SET s.name = $name`, { id: s.id, name: decoded });
    stops++;
  }

  console.log(`✓ decoded ${trips} trip name(s) and ${stops} stop name(s)`);
  await closeDriver();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
