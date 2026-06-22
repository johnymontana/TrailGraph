import { MemoryClient } from '@neo4j-labs/agent-memory';
import { env } from './env';

/**
 * MemoryGateway (AD-3) — the single boundary around NAMS, backed by the official
 * `@neo4j-labs/agent-memory` SDK so NAMS route/shape drift is absorbed by the SDK (R2), not us.
 *
 * Isolation (R4): the SDK scopes by workspace + conversation + `namespace`, but its long-term
 * entity reads/writes take NO per-call userId. So we enforce per-user isolation at the adapter by
 * instantiating a MemoryClient **with `namespace = userId`** (cached per user). The gateway derives
 * userId from the authenticated server session and never trusts a client-supplied id.
 *
 * Conversation ids are SERVER-assigned (createConversation has no id field) — callers create a
 * conversation, then persist the eveSessionId ↔ namsConversationId ↔ userId mapping (§10.6, Phase 2).
 *
 * Feedback gathered while building this is in docs/NAMS-FEEDBACK.md.
 */

export type { Entity, Preference, Message } from '@neo4j-labs/agent-memory';

export interface ConversationContext {
  reflections: string[];
  observations: string[];
  recentMessages: { role: string; content: string }[];
}

export interface ReasoningStep {
  conversationId: string;
  summary: string;
  actionTaken?: string;
  result?: string;
  toolCalls?: { tool: string; input: unknown; output: unknown }[];
}

export interface MemoryGateway {
  /** Create a server-assigned conversation; returns its id. */
  createConversation(userId: string, metadata?: Record<string, unknown>): Promise<string>;
  addMessages(
    userId: string,
    conversationId: string,
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  ): Promise<void>;
  getConversationContext(userId: string, conversationId: string): Promise<ConversationContext>;
  searchEntities(args: {
    userId: string;
    type?: string;
    query?: string;
    limit?: number;
  }): Promise<import('@neo4j-labs/agent-memory').Entity[]>;
  addPreference(args: {
    userId: string;
    category: string;
    value: string;
    context?: string;
  }): Promise<{ id: string; category: string; value: string }>;
  deleteEntity(userId: string, entityId: string): Promise<void>;
  recordReasoning(userId: string, step: ReasoningStep): Promise<void>;
  /** Read-only tenant-scoped Cypher for cross-graph bridge reads (§11.3). */
  queryReadonly<T = Record<string, unknown>>(
    userId: string,
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<T[]>;
  feedback(userId: string, entityId: string, vote: 'up' | 'down'): Promise<void>;
  waitForExtraction(userId: string, expectedNames: string[]): Promise<boolean>;
}

function restEndpoint(baseUrl: string): string {
  // SDK selects REST transport when the endpoint contains /v1 (the documented hosted surface).
  return /\/v1\/?$/.test(baseUrl) ? baseUrl : `${baseUrl.replace(/\/$/, '')}/v1`;
}

class NamsMemoryGateway implements MemoryGateway {
  // One client per user → per-user namespace isolation (R4). Cheap; just config + a transport.
  private clients = new Map<string, MemoryClient>();

  private clientFor(userId: string): MemoryClient {
    let c = this.clients.get(userId);
    if (!c) {
      // Only override endpoint when NAMS_BASE_URL is explicitly set; otherwise let the SDK use its
      // built-in hosted endpoint (avoids guessing the wrong REST base).
      const baseUrl = process.env.NAMS_BASE_URL;
      c = new MemoryClient({
        endpoint: baseUrl ? restEndpoint(baseUrl) : undefined,
        apiKey: env.nams.apiKey,
        workspaceId: env.nams.workspaceId || undefined,
        namespace: userId, // isolation boundary
      });
      this.clients.set(userId, c);
    }
    return c;
  }

  async createConversation(userId: string, metadata?: Record<string, unknown>): Promise<string> {
    const conv = await this.clientFor(userId).shortTerm.createConversation({ userId, metadata });
    return conv.id;
  }

  async addMessages(
    userId: string,
    conversationId: string,
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  ): Promise<void> {
    const client = this.clientFor(userId);
    // ≤100 per bulk call (§11.2).
    for (let i = 0; i < messages.length; i += 100) {
      await client.shortTerm.bulkAddMessages(conversationId, messages.slice(i, i + 100));
    }
  }

  async getConversationContext(
    userId: string,
    conversationId: string,
  ): Promise<ConversationContext> {
    const ctx = await this.clientFor(userId).shortTerm.getContext(conversationId);
    return {
      reflections: ctx.reflections.map((r) => r.content),
      observations: ctx.observations.map((o) => o.content),
      recentMessages: ctx.recentMessages.map((m) => ({ role: m.role, content: m.content })),
    };
  }

  async searchEntities({
    userId,
    type,
    query,
    limit,
  }: {
    userId: string;
    type?: string;
    query?: string;
    limit?: number;
  }) {
    const client = this.clientFor(userId);
    // No query → list (optionally typed); query → vector search.
    return query
      ? client.longTerm.searchEntities(query, { type, limit })
      : client.longTerm.listEntities({ type, limit });
  }

  async addPreference({
    userId,
    category,
    value,
    context,
  }: {
    userId: string;
    category: string;
    value: string;
    context?: string;
  }) {
    const pref = await this.clientFor(userId).longTerm.addPreference(category, value, { context });
    return { id: pref.id, category: pref.category, value: pref.preference };
  }

  async deleteEntity(userId: string, entityId: string): Promise<void> {
    await this.clientFor(userId).longTerm.deleteEntity(entityId);
  }

  async recordReasoning(userId: string, step: ReasoningStep): Promise<void> {
    const client = this.clientFor(userId);
    const agentStep = await client.reasoning.recordStep({
      conversationId: step.conversationId,
      reasoning: step.summary,
      actionTaken:
        step.actionTaken ?? ((step.toolCalls ?? []).map((t) => t.tool).join(', ') || 'respond'),
      result: step.result,
    });
    for (const tc of step.toolCalls ?? []) {
      await client.reasoning.recordToolCall(
        agentStep.id,
        tc.tool,
        (tc.input ?? {}) as Record<string, unknown>,
        { result: tc.output },
      );
    }
  }

  async queryReadonly<T = Record<string, unknown>>(
    userId: string,
    cypher: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const res = await this.clientFor(userId).query.cypher({ cypher, params });
    // CypherResult is columnar (columns + rows: unknown[][]); map to keyed objects like readGraph.
    return res.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      res.columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj as T;
    });
  }

  async feedback(userId: string, entityId: string, vote: 'up' | 'down'): Promise<void> {
    await this.clientFor(userId).longTerm.setEntityFeedback(entityId, {
      userScore: vote === 'up' ? 1 : 0,
      confirmed: vote === 'up',
    });
  }

  async waitForExtraction(userId: string, expectedNames: string[]): Promise<boolean> {
    return this.clientFor(userId).longTerm.waitForExtraction({ expectedNames, timeoutMs: 15000 });
  }
}

export const memory: MemoryGateway = new NamsMemoryGateway();
