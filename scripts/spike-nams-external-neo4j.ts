/**
 * Phase-0 de-risk spike (ADR-001): prove that hosted NAMS, configured against our external Neo4j,
 * writes the context graph into the SAME database that holds the domain graph — which is the whole
 * premise of the §8.3 cross-graph bridges.
 *
 * Run: pnpm nams:spike   (requires NAMS_* and NEO4J_* env configured + workspace pointed at our DB)
 *
 * Steps:
 *   1. Write a conversation + a message through the NAMS API (MemoryGateway).
 *   2. Query OUR Neo4j directly over bolt for nodes carrying that conversation id.
 *   3. Report whether the NAMS write is visible in our database.
 *
 * Findings get logged to docs/NAMS-FEEDBACK.md (item N1).
 */
import '../lib/load-env';
import { memory } from '../lib/memory';
import { readGraph, closeDriver } from '../lib/neo4j';

const SPIKE_USER = 'spike-user';

async function main() {
  console.log('[spike] 1/3 writing via NAMS…');
  const conversationId = await memory.createConversation(SPIKE_USER, { source: 'spike' });
  console.log(`[spike] server-assigned conversationId = ${conversationId}`);
  await memory.addMessages(SPIKE_USER, conversationId, [
    { role: 'user', content: 'I love alpine lakes and stargazing, and I avoid crowds.' },
  ]);

  console.log('[spike] 2/3 querying our Neo4j directly over bolt…');
  // We can't assume NAMS's exact labels (ontology-dependent), so cast a wide net for anything
  // referencing this conversation id.
  const rows = await readGraph<{ labels: string[]; n: Record<string, unknown> }>(
    `
    MATCH (n)
    WHERE n.conversationId = $cid OR n.conversation_id = $cid OR n.id = $cid
    RETURN labels(n) AS labels, n LIMIT 25
    `,
    { cid: conversationId },
  );

  console.log('[spike] 3/3 result:');
  if (rows.length > 0) {
    console.log(`  ✓ ${rows.length} node(s) from the NAMS write are visible in OUR Neo4j.`);
    console.log('  → AD-1 holds: domain + context graph co-reside. Cross-graph bridges are viable.');
    console.table(rows.map((r) => ({ labels: r.labels.join(','), keys: Object.keys(r.n).join(',') })));
  } else {
    console.log('  ✗ No NAMS-written nodes found in our Neo4j for this conversation.');
    console.log('  → Either extraction is async (re-run after a delay) OR hosted NAMS is NOT writing');
    console.log('    to our external DB. If the latter: AD-1 is broken — escalate, see NAMS-FEEDBACK N1.');
  }

  await closeDriver();
}

main().catch((err) => {
  console.error('[spike] error:', err);
  process.exit(1);
});
