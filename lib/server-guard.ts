/**
 * Server-only guard (audit S9). Importing this into a secret-bearing module turns a careless
 * `'use client'` value-import of that module into a visible error in the browser, instead of silently
 * shipping server code to the client bundle.
 *
 * Why not the `server-only` npm package? It throws at module eval in *plain Node* (it resolves to a
 * throwing module unless the bundler sets the `react-server` export condition). This repo shares
 * lib/neo4j, lib/env, etc. between Next, ~13 `tsx` scripts, and vitest — all plain Node — so the npm
 * package would break db:migrate/seed/tests unless every runner passed `--conditions=react-server`, an
 * easy-to-forget footgun. This guard is a no-op in Node/SSR (no `window`) and trips only in a real
 * browser bundle. (Note: Next never inlines non-NEXT_PUBLIC_ env into client bundles, so the practical
 * risk these modules pose if mis-imported is shipping dead server code, which this catches at runtime.)
 */
if (typeof window !== 'undefined') {
  throw new Error(
    'A server-only module (e.g. lib/neo4j, lib/env, lib/auth) was imported into the browser bundle. ' +
      'Keep it out of "use client" files — use a server component, route handler, or `import type`.',
  );
}

export {};
