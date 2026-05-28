# `src/lib/` — Data and algorithm layer

Pure TypeScript modules. **No React, no JSX, no Next.js imports.** Everything here either runs in the browser (`db`, `tts`, `player`) or is pure logic (`sr`, `types`).

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
