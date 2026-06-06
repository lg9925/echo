# `server/` — the pluggable middle layer (原则五的落地)

A small Hono backend (its own `package.json`) that fronts every LLM and TTS
vendor behind one stable interface. The static frontend (`echo.*`) calls this
over HTTP at `api.echo.*`. This is the concrete implementation of project
principle 五 (可插拔的中间层) — read that in the root `CLAUDE.md` for the "why".

## Boundary rule (non-negotiable)

- **Adapters only forward + authenticate + adapt formats.** `llm/adapters/*` and `tts/adapters/*` each wrap one vendor and nothing more.
- **Prompts, output schemas, and routing live in the core, never in adapters:**
  - prompts → `llm/prompts.ts`
  - output JSON schemas (zod) → `llm/schema.ts`
  - task routing + voice presets → `config.ts`
- Upper layers (`routes/*`, `llm/index.ts`) are provider-agnostic.

## Task routing (`config.ts` → `TASK_ROUTING`)

- Tasks: `authoring` (`/v1/compose` "想说"), `gloss` (`/v1/gloss` "想懂"), `scenario` (`/v1/scenario`), `split` (`/v1/split` 拆岛), `keywords` (`/v1/keywords` 字词表关键词提取), `ask` (`/v1/ask` 随手助手), `judge` (`/v1/judge` 复习裁判 — interactive, sync, default haiku/cheap).
- **Code default: all → `anthropic` / `claude-sonnet-4-6`.** Three layers resolve the route for a task, in order: **runtime override (DB) → env (`LLM_<TASK>_PROVIDER`/`_MODEL`) → code default**. `config.ts` computes the env/default snapshot at startup; `routing.ts` (`resolveRoute(task)`) layers the runtime override on top. `llm/index.ts` calls `resolveRoute(task)` per request — so **switching a task's model takes effect live, no restart**.
  - Env (startup, server-wide): `LLM_GLOSS_PROVIDER=deepseek LLM_GLOSS_MODEL=deepseek-chat`.
  - Runtime (live, persisted in `routing_overrides`): `GET/PUT /v1/routing` — backs the app's advanced-settings "模型路由". `maxTokens` always stays the per-task default (not user-chosen). Keys never cross this API; only provider/model **names**.
- `scenario` uses `maxTokens: 8192` (it generates 15+ cards in one go).
- `llm/index.ts` `runStructured()` is the provider-agnostic engine: send prompt → `extractJson` → zod-validate → on failure, feed the error back and retry once. `scenarioStream()` is the streaming variant (falls back to non-stream if the adapter has no `completeStream`).
- The OpenAI-compatible adapter (gemini/openai/deepseek) sends `response_format: {type:"json_object"}` so the model can't break parsing with stray quotes/newlines — every task here is JSON. (The one plain-text task, `einb_literal`, runs on claude-cli, not this adapter.) Our prompts all contain the word "JSON", which the mode requires.

## Async jobs (`/v1/jobs`) + DB

Production = this local backend behind a **Cloudflare tunnel with a FIXED ~100s
edge timeout (524)**. A slow LLM run held in one request outruns it → the browser
sees `Load failed`. **The async job queue solves this properly** (and replaces the
old "route slow tasks to fast models" workaround):

- `POST /v1/jobs {task, input}` → creates a row, fire-and-forgets `runJob()`, returns `{jobId}` immediately.
- `GET /v1/jobs/:id` → `{status, progress, result?, error?}`. The client **polls** this (every ~3s) — each request is short, so the tunnel never times out, while the LLM runs server-side and the result is **held in the DB** until fetched (a client that disconnected mid-run gets it on reconnect; the inbox persists the `jobId` and resumes the same job after a reload).
- `routes/jobs.ts` → `jobs.ts` (`createJob`/`getJobState`/`runJob`) → **dispatches to the existing `llm/index.ts` functions** (`compose`/`gloss`/`scenario`/`split`/`keywords`/`ask`). It adds **no** task types and owns **no** prompts — boundary rule intact (原则五). `scenario` streams internally and writes the sentence count to the row's `progress`.
- `GET /v1/jobs/:id` is **exempt from the per-IP rate limit** (`ratelimit.ts`) — polling is cheap and intentionally frequent.
- **Because of this, all tasks can use STRONG models again** (原则二). Production `.env` routes everything to `claude-cli` (free + strong); the only reason to pick a fast model now is speed-over-quality (e.g. scenario → gemini ~28s vs claude-cli 2–4 min). `compose` was always fast/strong.

**DB layer (`db.ts`)** — `@libsql/client` (pure JS, no native build). `url =
TURSO_DATABASE_URL || "file:./data/echo.db"`: unset → a **local file** (zero
setup); set the two `TURSO_*` env vars → hosted Turso, no code change. `initDb()`
creates the `jobs` table and reaps any `queued`/`running` job left by a previous
process (a fire-and-forget `runJob` can't survive a restart). Rows carry a
`user_id` (constant `"owner"` for now) so the per-user system is a drop-in (原则四).
`.env` is git-ignored — a real deploy (systemd `EnvironmentFile`) must replicate
the routing + `TURSO_*`.

## Adding a vendor

1. New adapter file in `llm/adapters/` (or `tts/adapters/`) implementing the adapter interface (`adapters/types.ts`).
2. Register one line in `adapters/index.ts`.
3. Add the provider string literal to `config.ts` (`LlmProvider` / `TtsProvider`).

That's it — **don't touch `routes/*` or `llm/index.ts`.** A new "call AI" feature should reuse this layer and add a `task` type, not start a parallel path.

## Keys & secrets

- **API keys live only in server-side env** — `env.ts` loads `server/.env` via `process.loadEnvFile` in dev; production uses systemd's `EnvironmentFile` (no `.env` present, harmless no-op). See `server/.env.example`.
- **The frontend never holds a vendor key** — it only carries the shared `ECHO_API_TOKEN` Bearer (stored in client `settings`). Every `/v1/*` route is gated by `auth` (Bearer) + `rateLimit`.

## TTS

- `tts/adapters/*`: `edge` (free, default) / `openai` / `google` / `elevenlabs` / `gemini`.
- Voice presets per language live in `config.ts` (`VOICE_PRESETS`); switch the default vendor with the `TTS_PROVIDER` env var.

## Contracts

`contracts.ts` is a **MIRROR of `src/lib/api/contracts.ts`** (frontend). Change a
wire shape here and you must change it there too — the frontend keeps its own
copy so its static build has no dependency on this package.

## Running it

- Hono app in `index.ts`. `/health` is public; everything under `/v1` is rate-limited + token-gated (`/v1/ping`, `/compose`, `/gloss`, `/jobs`, `/tts`). `/scenario` + `/scenario/stream` are **retired** (return 410) — scenario runs through `/jobs`; the stub stays mounted only to give stale clients a clear error instead of a 524.
- Port from `PORT` env (default `8787`). It has its own `package.json` / `tsconfig.json` — run it from inside `server/` (`pnpm dev` = `tsx watch src/index.ts`).
- **This process IS production** (behind the Cloudflare tunnel) — it must run in a persistent terminal / auto-start task, not a transient session. See root `CLAUDE.md` → "Production = this machine behind a Cloudflare tunnel".
- **`.env` is read once at startup** (`env.ts`). `tsx watch` reloads on `src/` edits but **not** on `.env` edits — change LLM routing or any env var, then **restart the backend** to apply it.
