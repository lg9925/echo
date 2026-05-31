import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Load server/.env into process.env BEFORE anything reads it (config.ts reads
// env at import time, so this module must be imported first in index.ts).
//
// Resolved relative to THIS module (src/env.ts in dev, bundled dist/index.js in
// prod) → server/.env in both — so it works regardless of the cwd the backend
// is started from. Local dev: put keys/routing in server/.env. Production:
// systemd's EnvironmentFile populates the env and there's no .env file here, so
// the missing-file case is a harmless no-op.
try {
  const here = dirname(fileURLToPath(import.meta.url));
  (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.(
    join(here, "..", ".env"),
  );
} catch {
  /* no server/.env — env comes from the shell / systemd */
}
