# `src/lib/` — Data and algorithm layer

Pure TypeScript modules. **No React, no JSX, no Next.js imports.** Everything here either runs in the browser (`db`, `tts`, `player`, `audioCache`, `speech`) or is pure logic (`sr`, `cards`, `types`). This layer is the only thing components touch — for IndexedDB, SpeechSynthesis, **and the backend**.

## Module map

- `db.ts` / `seedLoader.ts` / `sr.ts` / `tts.ts` / `player.ts` — see contracts below.
- `api/` — thin client for the backend (`server/`). See "API client" below.
- `inbox.ts` — capture + process queue for AI features (想说/想懂/场景). See "Inbox" below.
- `cards.ts` — turn inbox results into learning cards/islands. User-created islands use `order` 9000+ so they sort after seed islands; the per-language "picked-up words" island has a fixed, build-time-known id (`${lang}.u.picked`) so its `shadow/[islandId]/` route is statically generated.
- `audioCache.ts` — client-side IndexedDB audio cache. Realises the TTS "never generate the same clip twice" guarantee: `speak()` checks the cache before calling the server. Rate buckets: `slow` (re-synthesised at 0.7) vs `normal`.
- `settings.ts` — user settings in `localStorage`: the API `apiToken` and optional API base override. `DEFAULT_API_BASE` is inlined at build time from `NEXT_PUBLIC_API_URL`. **The frontend never holds vendor keys — only the one token the server checks.**
- `speech.ts` — browser speech-to-text via the Web Speech API. Feature-detected; callers hide the mic when unsupported.
- `types.ts` — shared types, incl. `InboxItem` / `AudioCacheEntry` (Dexie v2 stores).

## Contracts (treat as stable, don't break callers)

### `db.ts` — Dexie instance
- Schema v1: `islands`, `sentences`, `reviews`.
- `reviews` is keyed by `sentenceId` and indexed on `due` and `[language+due]` — never wipe it when re-seeding.
- Export query helpers (`listIslands(language)`, `listSentencesByIsland(islandId)`, `dueReviews(language, now)`) so components never construct Dexie queries themselves.

### `seedLoader.ts` — One-time JSON → IndexedDB
- Must be **idempotent**. Key = `${language} + version`. If that key is already in a `meta` row, skip; otherwise insert.
- The source `echo_seed_de.json` does NOT have sentence ids — synthesize as `${language}.${islandOrder}.${sentenceIndex}`. Island id: `${language}.${islandOrder}`.
- Add `audio: null` to each sentence; the field is reserved for future pre-generated MP3.

### `sr.ts` — Simplified SM-2 (Again / Good)
- Pure function: `schedule(state: ReviewState, grade: "again" | "good", now: Date): ReviewState`.
- `Again`: `ease = max(1.3, ease - 0.2)`, `repetitions = 0`, `interval = 0`, `due = now`.
- `Good`: `repetitions += 1`; `interval = repetitions === 1 ? 1 : repetitions === 2 ? 3 : prev_interval * ease` (days); `due = now + interval days`.
- Interface is frozen so we can swap to FSRS later without changing call sites.

### `tts.ts` — SpeechSynthesis wrapper
- Single async export: `speak(text: string, opts: { lang: string; rate?: number; voice?: string }): Promise<void>` — resolves on `end` or `error`.
- Handles iOS late voice loading (`voiceschanged` event).
- Components must not touch `window.speechSynthesis` directly. This indirection is the swap point for future pre-recorded MP3 playback.

### `player.ts` — Shadowing player state machine
- States: `idle | speakingNative | pause | speakingTarget | gap`.
- Inputs: play / pause / next / prev / setLoop / setMode / setRate / setPauseSec.
- Pure-ish: holds state + emits commands; the React component runs the side effects (calling `speak()`).

### `api/` — thin client for `server/` (the backend middle layer)
- `client.ts` — no React. Reads the Bearer token + base URL from `settings.ts` (`getApiToken()`, `resolveApiBase()`). **Never embeds a vendor key** — only the shared `ECHO_API_TOKEN`. Exports:
  - `apiFetchJson<T>(path, body)` — POST JSON → JSON.
  - `apiFetchBlob(path, body)` — POST JSON → binary (e.g. `/v1/tts` audio).
  - `apiFetchSSE<T>(path, body, onProgress)` — POST JSON, consume an SSE stream; `onProgress` fires per `progress` event, resolves on `done`. Used for long generations (scenario) to show live progress.
  - `checkHealth()` (unauthenticated) / `checkAuth()` (token round-trip) / `ApiClientError`.
- `contracts.ts` — wire types (`ComposeRequest`/`Result`, `GlossRequest`/`Result`, `ScenarioRequest`/`Result`, `TtsRequest`, `ApiError`, `TargetLanguage`). **This is a MIRROR of `server/src/contracts.ts` — change one, change the other.** The frontend keeps its own copy so the static build has no dependency on the backend package.

### `inbox.ts` — AI capture + process queue
- `addToInbox(input)` — drop a raw item in, returns immediately (no network). `listInbox` / `getInboxItem` / `updateInboxItem` / `deleteInboxItem` are Dexie CRUD.
- `processInboxItem(id, hooks)` — calls the backend to fill the result. Status machine: `captured → processing → ready | error` (then `added` once turned into a card by `cards.ts`).
- Kinds → endpoints: `say` (想说) → `/v1/compose`; `understand` (想懂) → `/v1/gloss`; `scenario` (场景) → `/v1/scenario/stream` (SSE, with live sentence-count progress).
