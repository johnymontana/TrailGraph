import './server-guard'; // reads process.env secrets; block accidental client-bundle import (S9)
/**
 * Typed, lazy environment access. We don't validate everything at import time because
 * different surfaces need different subsets (the marketing page needs none of it; the
 * sync workflow needs NPS + Neo4j; the agent needs NAMS + Eve). Each accessor throws a
 * clear error only when something that truly needs a var is missing.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const env = {
  nps: {
    get apiKey() {
      return required('NPS_API_KEY');
    },
    baseUrl: 'https://developer.nps.gov/api/v1',
  },
  neo4j: {
    get uri() {
      return required('NEO4J_URI');
    },
    get username() {
      return required('NEO4J_USERNAME');
    },
    get password() {
      return required('NEO4J_PASSWORD');
    },
    get database() {
      return optional('NEO4J_DATABASE', 'neo4j');
    },
  },
  nams: {
    get baseUrl() {
      return optional('NAMS_BASE_URL', 'https://memory.neo4jlabs.com');
    },
    get apiKey() {
      return required('NAMS_API_KEY');
    },
    get workspaceId() {
      return optional('NAMS_WORKSPACE_ID');
    },
  },
  // NOTE: do NOT define EVE_BASE_URL. eve's `withEve` reads that exact env var to locate the eve dev
  // server; setting it (e.g. to the app's own origin) makes the proxy self-loop (EADDRNOTAVAIL).
  routing: {
    get apiKey() {
      return required('ORS_API_KEY');
    },
    get baseUrl() {
      return optional('ORS_BASE_URL', 'https://api.openrouteservice.org');
    },
  },
  models: {
    get embedding() {
      return optional('EMBEDDING_MODEL', 'openai/text-embedding-3-small');
    },
    get agent() {
      return optional('AGENT_MODEL', 'anthropic/claude-sonnet-4-6');
    },
    get aiGatewayKey() {
      return optional('AI_GATEWAY_API_KEY');
    },
  },
} as const;

/** Embedding dimension is fixed at index-creation time; changing it requires a re-backfill (ADR-012). */
export const EMBEDDING_DIM = 1536;
