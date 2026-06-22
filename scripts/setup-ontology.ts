import '../lib/load-env';
import { MemoryClient } from '@neo4j-labs/agent-memory';
import { env } from '../lib/env';
import { trailgraphOntology } from '../lib/ontology';

/**
 * One-time (idempotent-ish) ontology setup (ADR-011): create the TrailGraph ontology and activate it.
 * Run: pnpm ontology:setup
 *
 * Flow per §11.5: create → activate. (Preview/dry-run can be added once we have sample transcripts.)
 */
async function main() {
  const baseUrl = process.env.NAMS_BASE_URL;
  const client = new MemoryClient({
    endpoint: baseUrl ? (/\/v1\/?$/.test(baseUrl) ? baseUrl : `${baseUrl.replace(/\/$/, '')}/v1`) : undefined,
    apiKey: env.nams.apiKey,
    workspaceId: env.nams.workspaceId || undefined,
  });

  console.log('[ontology] existing:');
  const existing = await client.ontology.list().catch(() => []);
  console.table(existing);

  console.log('[ontology] creating TrailGraph ontology…');
  const version = await client.ontology.create({
    name: 'TrailGraph Travel & Parks',
    schema: trailgraphOntology,
    validationMode: 'lenient',
  });
  console.log(`[ontology] created version ${version.id} (revision ${version.revision})`);

  console.log('[ontology] activating…');
  const active = await client.ontology.activate(version.id);
  console.log(`[ontology] active version = ${active.id}`);

  const check = await client.ontology.getActive();
  console.log(`[ontology] confirmed active: ${check.document.domain.name} (rev ${check.revision})`);
}

main().catch((err) => {
  console.error('[ontology] error:', err);
  process.exit(1);
});
