// Security & cost hardening (audit C1/C2/C5/C6). Idempotent — safe to re-run.

// --- Rate limiting (lib/rate-limit.ts) ----------------------------------------------------------
// :RateBucket — one fixed-window counter per (key, window-index). The composite uniqueness keeps
// MERGE fast and prevents duplicate buckets under concurrency. expiresAt drives the daily prune.
CREATE CONSTRAINT ratebucket_key IF NOT EXISTS FOR (b:RateBucket) REQUIRE (b.key, b.widx) IS UNIQUE;
CREATE INDEX ratebucket_expires IF NOT EXISTS FOR (b:RateBucket) ON (b.expiresAt);

// :AgentClamp — runaway-turn kill switch (C2 observe-and-clamp). turn-accounting.ts sets `until` when
// a single turn blows past the per-turn tool-call cap; the channel onMessage clamps the user until then.
CREATE CONSTRAINT agentclamp_user IF NOT EXISTS FOR (c:AgentClamp) REQUIRE c.userId IS UNIQUE;

// --- Query-embedding cache (lib/embed-cache.ts) -------------------------------------------------
// :QueryEmbedding — caches a normalized query's embedding vector so repeated searches don't re-bill
// the AI Gateway (C5). Keyed by sha256(normalized query). createdAt drives an optional TTL prune.
CREATE CONSTRAINT queryembedding_hash IF NOT EXISTS FOR (q:QueryEmbedding) REQUIRE q.hash IS UNIQUE;
