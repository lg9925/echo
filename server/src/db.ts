// libSQL/Turso data layer. The async job queue is the first table; later
// phases (users, sync) add more. One client, created from env:
//
//   TURSO_DATABASE_URL  — hosted Turso URL (libsql://…). If unset, we fall back
//                         to a LOCAL FILE (file:./data/echo.db) so dev works
//                         with zero setup; flipping to hosted Turso is just
//                         setting these two env vars, no code change.
//   TURSO_AUTH_TOKEN    — hosted Turso token (not needed for a local file).
//
// @libsql/client is pure JS (no native build) — fine on Windows.
import { mkdirSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL?.trim() || "file:./data/echo.db";
const authToken = process.env.TURSO_AUTH_TOKEN?.trim() || undefined;

// A local file:./data/ DB needs its directory to exist first.
if (url.startsWith("file:")) {
  try {
    mkdirSync("./data", { recursive: true });
  } catch {
    // already exists / not creatable — createClient will surface real errors
  }
}

export const db: Client = createClient({ url, authToken });

export async function initDb(): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS jobs (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    task       TEXT NOT NULL,
    status     TEXT NOT NULL,
    input      TEXT NOT NULL,
    result     TEXT,
    error      TEXT,
    progress   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  // Runtime per-task LLM routing overrides (provider/model). Layered on top of
  // the env/default routing in config.ts so model switching takes effect live —
  // no restart, no .env edit. See routing.ts.
  await db.execute(`CREATE TABLE IF NOT EXISTS routing_overrides (
    task       TEXT PRIMARY KEY,
    provider   TEXT,
    model      TEXT,
    updated_at INTEGER NOT NULL
  )`);

  // Reaper: any job still queued/running belongs to a previous (now-dead)
  // process — a fire-and-forget runJob() can't survive a restart. Mark them
  // errored so the client stops polling and can retry.
  await db.execute({
    sql: `UPDATE jobs SET status='error', error='interrupted (server restarted)', updated_at=?
          WHERE status IN ('queued','running')`,
    args: [Date.now()],
  });

  console.log(`echo-server db ready (${url.startsWith("file:") ? "local file" : "turso"})`);
}
