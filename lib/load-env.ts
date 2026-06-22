/**
 * Loads .env.local (preferred) or .env into process.env for STANDALONE scripts run via tsx
 * (db:migrate, db:verify, nams:spike). Next.js loads these automatically for the app, but plain
 * tsx does not. Import this FIRST in any script. No dependency — uses Node's built-in loader.
 */
import { existsSync } from 'node:fs';

const file = existsSync('.env.local') ? '.env.local' : existsSync('.env') ? '.env' : null;
if (file && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(file);
  // eslint-disable-next-line no-console
  console.log(`[env] loaded ${file}`);
}
