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

- Tasks: `authoring` (`/v1/compose` "想说"), `gloss` (`/v1/gloss` "想懂"), `scenario` (`/v1/scenario`), `split` (`/v1/split` 拆岛), `keywords` (`/v1/keywords` 字词表关键词提取).
- **Code default: all → `anthropic` / `claude-sonnet-4-6`.** The constitution's intent is to send high-frequency/batch work to a cheaper model; we get there **without code changes** via per-task env overrides:
  - `LLM_<TASK>_PROVIDER` + `LLM_<TASK>_MODEL`, e.g. `LLM_GLOSS_PROVIDER=deepseek LLM_GLOSS_MODEL=deepseek-chat`.
- `scenario` uses `maxTokens: 8192` (it generates 15+ cards in one go).
- `llm/index.ts` `runStructured()` is the provider-agnostic engine: send prompt → `extractJson` → zod-validate → on failure, feed the error back and retry once. `scenarioStream()` is the streaming variant (falls back to non-stream if the adapter has no `completeStream`).

### ⚠️ Cloudflare-tunnel timeout (production routing gotcha)

Production currently = this local backend exposed via a **Cloudflare tunnel, whose
edge has a FIXED ~100s timeout (524)**. Our tasks don't stream useful bytes, so a
slow LLM run outruns the tunnel and the **browser sees `Load failed`** (not a
clean HTTP error — the connection is dropped). Symptoms hit `scenario`, `keywords`,
`split`; `compose` (single sentence, ~40s) stays under the cap. The production
`.env` routes the slow tasks to fast models to fit under 100s (see `.env.example`):

- `scenario` → **Gemini Flash** (`LLM_SCENARIO_PROVIDER=gemini`, `LLM_SCENARIO_MODEL=gemini-2.5-flash`).
  haiku is fast but **flakes** (returns prose, not JSON); sonnet is reliable but ~160s → 524. Gemini Flash is fast *and* reliable, and `GEMINI_API_KEY` is already set (TTS). Note: this key's project has `gemini-2.5-flash`, **not** `2.0-flash` (404). The gemini LLM adapter is the OpenAI-compat endpoint and **does not stream** → scenario loses its live progress count, but finishes in ~28s.
- `keywords` / `split` → **haiku** (`LLM_KEYWORDS_MODEL=haiku`, `LLM_SPLIT_MODEL=haiku`) — small JSON, ~25s, reliable enough.
- `compose` (想说) keeps the **strong** model (content quality; single sentence is fast).

Sturdier long-term options if the tunnel stays: DeepSeek for the batch tasks, or
send SSE keep-alive bytes so a sonnet stream survives past 100s. `.env` is
git-ignored, so this routing lives only in the running env — a real deploy
(systemd `EnvironmentFile`) must replicate it.

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

- Hono app in `index.ts`. `/health` is public; everything under `/v1` is rate-limited + token-gated (`/v1/ping`, `/compose`, `/gloss`, `/scenario`, `/scenario/stream`, `/tts`).
- Port from `PORT` env (default `8787`). It has its own `package.json` / `tsconfig.json` — run it from inside `server/`.
