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
- `a1/` — the A1 课程 (Goethe A1) module: `loader.ts` (wordlist seed → card expansion, noun article/plural invariant enforced at load), `deck.ts` (due queue + daily new-card throttle by phase + tag-interleaved ordering), `cloze.ts` (deterministic cloze derivation from recalled island sentences), `charDiff.ts` (LCS char diff + accuracy + error classification), `diktat.ts` (听写 length ladder + sentence-pool pick), `numbers.ts` (phone/price/time generators), `errorCards.ts` (shared mistake→card pipeline, deterministic ids), `phase.ts` (derived curriculum phase — never stored), `nextAction.ts` (P0 next-action heuristic; replaced by the P1 composer).
- `studyLog.ts` — the ONLY instrumentation entry point: `logActivity()` (event + StudyDay rollup + MVD flag) and `logReview()` (append-only review log). Components never write these tables directly.
- `composer.ts` — M1 session composer, PURE (unit-tested): budget/deficit-weighted daily plan; TodayView assembles inputs and renders. The MVD head (srs→input→output) is fixed pedagogical order.
- `outputTask.ts` — M5 daily production task: local template bank (`src/data/output_tasks_de.json`, no LLM for generation), draft lifecycle draft→submitted→reviewed|error with persisted jobId (resumable), corrections → `a1/errorCards.ts`.
- `a1/hvpt.ts` — M6 HVPT perception drills over `src/data/hvpt_de.json` minimal pairs; 6 Edge voices (`HVPT_VOICES_DE` — always pass `HVPT_TTS_PROVIDER` ("edge") with them, the global TTS default may be another vendor). Perception errors never create SRS cards.
- `stats.ts` — M7 pure aggregators (hours by class, budget comparison + 15% exam ceiling, mature-card retention from reviewLog, adherence). Every dashboard number is reproducible from these.
- `streak.ts` — pure `computeStreak()` fold over StudyDay rows (2 grace days/month, retroactive freeze). No mutable streak state exists anywhere.

## Contracts (treat as stable, don't break callers)

### `db.ts` — Dexie instance
- Schema v1: `islands`, `sentences`, `reviews`. v6 adds the A1 tables: `cards`, `cardReviews`, `dictationAttempts`, `studyLog`, `studyDays`, `reviewLog`, `curriculum` — all in `backup.ts` (three places).
- `reviews` is keyed by `sentenceId` and indexed on `due` and `[language+due]` — never wipe it when re-seeding. `cardReviews` (keyed `cardId`) is the A1 deck's FSRS state — same by-absence "new card" convention, never wiped by the wordlist loader.
- Export query helpers (`listIslands(language)`, `listSentencesByIsland(islandId)`, `dueReviews(language, now)`) so components never construct Dexie queries themselves.

### `seedLoader.ts` — One-time JSON → IndexedDB
- Must be **idempotent**. Key = `${language} + version`. If that key is already in a `meta` row, skip; otherwise insert.
- The source `echo_seed_de.json` does NOT have sentence ids — synthesize as `${language}.${islandOrder}.${sentenceIndex}`. Island id: `${language}.${islandOrder}`.
- Add `audio: null` to each sentence; the field is reserved for future pre-generated MP3.

### `sr.ts` — FSRS scheduler (`ts-fsrs`, default weights)
- Pure function, generic over the FSRS field subset: `schedule<T extends SrFields>(state: T, grade: Grade, now: Date): T`, where `Grade = "again" | "hard" | "good" | "easy"`. One scheduler serves both `ReviewState` (sentences) and `CardReviewState` (A1 cards — enter via `freshCardState()`). Wraps `ts-fsrs` (`enable_short_term: false`, `request_retention: 0.9`, library default weights — no hand-tuned magic numbers; per-user optimizer tuning deferred). See `docs/srs-error-deck.md` §3.
- FSRS memory lives on `ReviewState` as optional fields (`stability`/`difficulty`/`lapses`/`fsrsState`); `due`/`interval`/`repetitions` are mirrored from the FSRS card so the `due` index + every `db.ts` query + the hub badges keep working unchanged. Legacy SM-2-only rows (no `stability`) are initialised lazily on their first FSRS review — no Dexie migration, `ease` is now vestigial.
- The UI only ever offers **again/good** (原则一: the system picks difficulty, never the user). `verdictToGrade(uiAction, verdict)` derives the FSRS grade: `again`→Again, `good`+`close`→Hard, `good`+correct/offline→Good; `easy` is reserved for 7.3.
- Interface (`schedule`/`freshState`) stays the swap point; call sites (`ReviewSession`) don't construct cards.

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
  - `submitJob(task, input)` / `pollJob(jobId, onProgress)` / `runJob(...)` — async job queue (`/v1/jobs`); how slow generations (scenario) run without hitting the tunnel's edge timeout. `onProgress` gets the live sentence count.
  - `checkHealth()` (unauthenticated) / `checkAuth()` (token round-trip) / `ApiClientError`.
- `contracts.ts` — wire types (`ComposeRequest`/`Result`, `GlossRequest`/`Result`, `ScenarioRequest`/`Result`, `TtsRequest`, `ApiError`, `TargetLanguage`). **This is a MIRROR of `server/src/contracts.ts` — change one, change the other.** The frontend keeps its own copy so the static build has no dependency on the backend package.

### `inbox.ts` — AI capture + process queue
- `addToInbox(input)` — drop a raw item in, returns immediately (no network). `listInbox` / `getInboxItem` / `updateInboxItem` / `deleteInboxItem` are Dexie CRUD.
- `processInboxItem(id, hooks)` — calls the backend to fill the result. Status machine: `captured → processing → ready | error` (then `added` once turned into a card by `cards.ts`).
- Kinds → endpoints: `say` (想说) → `/v1/compose`; `understand` (想懂) → `/v1/gloss`; `scenario` (场景) → async job queue (`submitJob("scenario") → pollJob`, with live sentence-count progress). All kinds now go through the queue (submit → poll) so a slow run survives the tunnel's ~100s edge timeout; the old synchronous `/v1/scenario/stream` route is retired (returns 410).
