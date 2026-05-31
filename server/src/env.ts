// Load server/.env into process.env BEFORE anything reads it (config.ts reads
// env at import time, so this module must be imported first in index.ts).
//
// Local dev: put keys in server/.env. Production: systemd's EnvironmentFile
// already populates the environment and there's no .env file here, so the
// missing-file case is a harmless no-op.
try {
  (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.();
} catch {
  /* no server/.env — env comes from the shell / systemd */
}
