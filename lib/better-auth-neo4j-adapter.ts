import { createAdapter } from 'better-auth/adapters';
import { readGraph, writeGraph } from './neo4j';

/**
 * Custom Better Auth → Neo4j adapter (ADR-008).
 *
 * Keeps auth state in our single Neo4j (ADR-002) instead of a separate SQL DB. The `user` model
 * maps to `:User` — the SAME node that anchors the context graph (§8.2) and every §8.3 bridge.
 * On user create we mirror Better Auth's `id` into `userId` so the rest of the app/agent can match
 * `(:User {userId})` while Better Auth matches `(:User {id})` (the two are always equal).
 *
 * ⚠️ Better Auth's custom-adapter contract can shift across minor versions — if create/find/update
 * signatures change, this file is the only thing to fix.
 *
 * We declare supportsDates:false / supportsJSON:false so Better Auth hands us ISO strings and
 * stringified JSON, which Neo4j stores natively as strings — avoiding temporal-type round-trip bugs.
 */

const MODEL_LABEL: Record<string, string> = {
  user: 'User',
  session: 'AuthSession',
  account: 'AuthAccount',
  verification: 'AuthVerification',
};

function labelFor(model: string): string {
  return MODEL_LABEL[model] ?? model.charAt(0).toUpperCase() + model.slice(1);
}

type Where = {
  field: string;
  value: unknown;
  operator?: string;
  connector?: 'AND' | 'OR';
};

function buildWhere(where: Where[] | undefined, params: Record<string, unknown>): string {
  if (!where || where.length === 0) return '';
  const clauses = where.map((w, i) => {
    const key = `w${i}`;
    params[key] = w.value;
    const op = (w.operator ?? 'eq').toLowerCase();
    switch (op) {
      case 'in':
        return `n.${w.field} IN $${key}`;
      case 'ne':
        return `n.${w.field} <> $${key}`;
      case 'gt':
        return `n.${w.field} > $${key}`;
      case 'gte':
        return `n.${w.field} >= $${key}`;
      case 'lt':
        return `n.${w.field} < $${key}`;
      case 'lte':
        return `n.${w.field} <= $${key}`;
      case 'contains':
        return `n.${w.field} CONTAINS $${key}`;
      case 'starts_with':
        return `n.${w.field} STARTS WITH $${key}`;
      case 'ends_with':
        return `n.${w.field} ENDS WITH $${key}`;
      default:
        return `n.${w.field} = $${key}`;
    }
  });
  const connector = where.find((w) => w.connector === 'OR') ? ' OR ' : ' AND ';
  return `WHERE ${clauses.join(connector)}`;
}

export const neo4jAdapter = () =>
  createAdapter({
    config: {
      adapterId: 'neo4j',
      adapterName: 'Neo4j Adapter',
      supportsJSON: false,
      supportsDates: false,
      supportsBooleans: true,
      supportsNumericIds: false,
    },
    adapter: () => ({
      create: async <T extends Record<string, unknown>>({
        model,
        data,
      }: {
        model: string;
        data: T;
        select?: string[];
      }): Promise<T> => {
        const label = labelFor(model);
        const props: Record<string, unknown> = { ...data };
        if (model === 'user' && props.id != null && props.userId == null) {
          props.userId = props.id; // mirror so (:User {userId}) matches the auth id
        }
        const rows = await writeGraph<{ n: Record<string, unknown> }>(
          `CREATE (n:\`${label}\`) SET n = $props RETURN n{.*} AS n`,
          { props },
        );
        return (rows[0]?.n ?? props) as T;
      },

      findOne: async <T>({
        model,
        where,
      }: {
        model: string;
        where: Where[];
        select?: string[];
      }): Promise<T | null> => {
        const label = labelFor(model);
        const params: Record<string, unknown> = {};
        const rows = await readGraph<{ n: Record<string, unknown> }>(
          `MATCH (n:\`${label}\`) ${buildWhere(where, params)} RETURN n{.*} AS n LIMIT 1`,
          params,
        );
        return (rows[0]?.n ?? null) as T | null;
      },

      findMany: async <T>({
        model,
        where,
        limit,
        offset,
        sortBy,
      }: {
        model: string;
        where?: Where[];
        limit: number;
        offset?: number;
        sortBy?: { field: string; direction: 'asc' | 'desc' };
      }): Promise<T[]> => {
        const label = labelFor(model);
        const params: Record<string, unknown> = {};
        const order = sortBy ? `ORDER BY n.${sortBy.field} ${sortBy.direction.toUpperCase()}` : '';
        const skip = offset ? `SKIP ${Math.trunc(offset)}` : '';
        const take = typeof limit === 'number' ? `LIMIT ${Math.trunc(limit)}` : '';
        const rows = await readGraph<{ n: Record<string, unknown> }>(
          `MATCH (n:\`${label}\`) ${buildWhere(where, params)} RETURN n{.*} AS n ${order} ${skip} ${take}`,
          params,
        );
        return rows.map((r) => r.n) as T[];
      },

      update: async <T>({
        model,
        where,
        update,
      }: {
        model: string;
        where: Where[];
        update: T;
      }): Promise<T | null> => {
        const label = labelFor(model);
        const params: Record<string, unknown> = { update };
        const rows = await writeGraph<{ n: Record<string, unknown> }>(
          `MATCH (n:\`${label}\`) ${buildWhere(where, params)} SET n += $update RETURN n{.*} AS n`,
          params,
        );
        return (rows[0]?.n ?? null) as T | null;
      },

      updateMany: async ({
        model,
        where,
        update,
      }: {
        model: string;
        where: Where[];
        update: Record<string, unknown>;
      }): Promise<number> => {
        const label = labelFor(model);
        const params: Record<string, unknown> = { update };
        const rows = await writeGraph<{ c: number }>(
          `MATCH (n:\`${label}\`) ${buildWhere(where, params)} SET n += $update RETURN count(n) AS c`,
          params,
        );
        return rows[0]?.c ?? 0;
      },

      delete: async ({ model, where }: { model: string; where: Where[] }): Promise<void> => {
        const label = labelFor(model);
        const params: Record<string, unknown> = {};
        await writeGraph(
          `MATCH (n:\`${label}\`) ${buildWhere(where, params)} DETACH DELETE n`,
          params,
        );
      },

      deleteMany: async ({ model, where }: { model: string; where: Where[] }): Promise<number> => {
        const label = labelFor(model);
        const params: Record<string, unknown> = {};
        const rows = await writeGraph<{ c: number }>(
          `MATCH (n:\`${label}\`) ${buildWhere(where, params)}
           WITH collect(n) AS ns
           FOREACH (m IN ns | DETACH DELETE m)
           RETURN size(ns) AS c`,
          params,
        );
        return rows[0]?.c ?? 0;
      },

      count: async ({ model, where }: { model: string; where?: Where[] }): Promise<number> => {
        const label = labelFor(model);
        const params: Record<string, unknown> = {};
        const rows = await readGraph<{ c: number }>(
          `MATCH (n:\`${label}\`) ${buildWhere(where, params)} RETURN count(n) AS c`,
          params,
        );
        return rows[0]?.c ?? 0;
      },
    }),
  });
