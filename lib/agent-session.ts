import { readGraph, writeGraph } from './neo4j';
import { memory } from './memory';

/**
 * Maps an Eve durable session to a NAMS conversation (§10.6, Phase 2 item #3). Stored in Neo4j so a
 * returning user resumes the right memory. Lazily creates the NAMS conversation on first use.
 */
export async function getOrCreateConversation(userId: string, eveSessionId: string): Promise<string> {
  const existing = await readGraph<{ conversationId: string }>(
    `MATCH (u:User {userId:$userId})-[:HAS_AGENT_SESSION]->(s:AgentSession {eveSessionId:$eveSessionId})
     RETURN s.conversationId AS conversationId`,
    { userId, eveSessionId },
  );
  if (existing[0]?.conversationId) return existing[0].conversationId;

  const conversationId = await memory.createConversation(userId, { eveSessionId });
  await writeGraph(
    `MERGE (u:User {userId:$userId})
     MERGE (u)-[:HAS_AGENT_SESSION]->(s:AgentSession {eveSessionId:$eveSessionId})
     SET s.conversationId = $conversationId, s.createdAt = coalesce(s.createdAt, datetime())`,
    { userId, eveSessionId, conversationId },
  );
  return conversationId;
}
