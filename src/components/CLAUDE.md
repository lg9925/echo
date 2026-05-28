# `src/components/` — Client UI

## Rules

- **Every file in this directory starts with `"use client"`.** No exceptions — we're a fully client-side PWA with IndexedDB and SpeechSynthesis.
- **No hardcoded UI strings.** All visible text goes through `useTranslations()` from `next-intl`. Add new keys to `src/i18n/messages/zh.json` AND `en.json`.
- **No direct DB access.** Components import query helpers from `@/lib/db`, not Dexie itself.
- **No direct TTS access.** Components import `speak()` from `@/lib/tts`, not `window.speechSynthesis`.
- **No business logic in JSX.** Algorithms (scheduling, state machines) live in `src/lib/`. Components dispatch and render.

## Naming

- PascalCase file = PascalCase default export: `ShadowPlayer.tsx` exports `ShadowPlayer`.
- One component per file. Helpers used by only one component stay in that file; cross-component helpers move to `src/lib/`.
