/**
 * Applies all .cypher files in db/migrations in lexical order. Each statement is idempotent
 * (IF NOT EXISTS), so this is safe to re-run. Run with: pnpm db:migrate
 */
import '../lib/load-env';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDriver, closeDriver } from '../lib/neo4j';
import { env } from '../lib/env';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.cypher')).sort();
  const driver = getDriver();
  let applied = 0;

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const statements = splitStatements(sql);
    console.log(`\n▶ ${file} (${statements.length} statements)`);
    for (const stmt of statements) {
      const session = driver.session({ database: env.neo4j.database });
      try {
        await session.run(stmt);
        applied++;
        process.stdout.write('.');
      } catch (err) {
        console.error(`\n✗ Failed: ${stmt.slice(0, 80)}…\n  ${(err as Error).message}`);
        throw err;
      } finally {
        await session.close();
      }
    }
  }
  console.log(`\n\n✓ Applied ${applied} statements across ${files.length} file(s).`);
  await closeDriver();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
