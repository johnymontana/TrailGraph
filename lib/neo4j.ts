import './server-guard'; // secret-bearing (driver creds); block accidental client-bundle import (S9)
import neo4j, { type Driver, type Session, type QueryResult } from 'neo4j-driver';
import { env } from './env';

/**
 * Single canonical datastore (ADR-002). One driver, reused across the process.
 * - `readGraph` runs read transactions (discovery, map, "For you", agent read tools).
 * - `writeGraph` runs write transactions (bolt-written app data: trips, stops, bridges, auth).
 *
 * NAMS owns the context-graph writes; the app owns domain + app-data writes. Both land in the
 * same database, which is the whole point (AD-1).
 */

let driver: Driver | undefined;

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      env.neo4j.uri,
      neo4j.auth.basic(env.neo4j.username, env.neo4j.password),
      { disableLosslessIntegers: true, maxConnectionPoolSize: 50 },
    );
  }
  return driver;
}

export async function closeDriver(): Promise<void> {
  await driver?.close();
  driver = undefined;
}

type Params = Record<string, unknown>;

/**
 * neo4j-driver DROPS params whose value is `undefined`, which surfaces as a confusing
 * "Expected parameter(s): $x" at query time (and "can not store undefined" for map props). Callers
 * (notably the Better Auth adapter, which passes optional fields/where-clauses as `undefined`) can't
 * always avoid it, so we normalize undefined → null at the boundary. null is a valid Cypher value.
 */
export function sanitizeParams(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  // We store timestamps as ISO strings (Better Auth adapter uses supportsDates:false), and the
  // driver can't bind a raw JS Date. Convert so where-clause comparisons stay string-vs-string.
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeParams);
  // Plain objects (Cypher maps). Leave driver/temporal/point instances untouched.
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeParams(v);
    return out;
  }
  return value;
}

async function run<T = Record<string, unknown>>(
  mode: 'READ' | 'WRITE',
  cypher: string,
  params: Params = {},
): Promise<T[]> {
  const session: Session = getDriver().session({
    database: env.neo4j.database,
    defaultAccessMode: mode,
  });
  const safeParams = sanitizeParams(params) as Params;
  try {
    const result: QueryResult =
      mode === 'READ'
        ? await session.executeRead((tx) => tx.run(cypher, safeParams))
        : await session.executeWrite((tx) => tx.run(cypher, safeParams));
    return result.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

export function readGraph<T = Record<string, unknown>>(cypher: string, params: Params = {}) {
  return run<T>('READ', cypher, params);
}

export function writeGraph<T = Record<string, unknown>>(cypher: string, params: Params = {}) {
  return run<T>('WRITE', cypher, params);
}

/** Helper: build a Neo4j point literal from lat/lng for parameterized queries. */
export function pointParam(latitude: number, longitude: number) {
  return { latitude, longitude };
}

export const MILES_PER_METER = 1 / 1609.344;
