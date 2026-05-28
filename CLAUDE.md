@AGENTS.md

# Echo — German learning PWA (MVP)

Personal language-learning PWA. First locale: German (`de`). Pure client-side: IndexedDB only, no backend, no cloud sync.

Method: 句子岛 + 影子跟读 + 间隔重复.

## Directory map

- `src/app/` — App Router pages. **All routes live under `[locale]/`.** No `app/layout.tsx`; `[locale]/layout.tsx` IS the root.
- `src/lib/` — Data + algorithm layer: Dexie schema, seed loader, TTS wrapper, SM-2 spaced repetition, player state machine. **No React here.**
- `src/components/` — Client UI. Every component starts with `"use client"`.
- `src/i18n/` — next-intl routing, request config, locale messages (`zh.json` / `en.json`).
- `public/seed/echo_seed_de.json` — German sentence data, read once on first launch into IndexedDB.
- `public/index.html` — Root `/` static redirect to `/zh/` (static export has no proxy/middleware).

## Hard constraints — read before touching code

- **Static export.** `next.config.ts` has `output: 'export'`. Do **not** use Proxy (formerly middleware), Server Actions, dynamic Route Handlers, `cookies()`, `redirects` config, `rewrites` config, `headers` config, or Image Optimization with default loader. They will fail at build.
- **iOS Safari + iOS PWA: SpeechSynthesis stops when screen locks or app backgrounds.** This is a WebKit limitation (bug 198277), not something to "fix" in code. Documented for users in settings/about.
- **All UI text goes through `useTranslations()` / `getTranslations()`.** No hardcoded strings in components or pages. Add new keys to both `zh.json` and `en.json`.
- **TTS access only via `src/lib/tts.ts`.** Components must not touch `window.speechSynthesis` directly — this is the one indirection that lets us swap to pre-recorded MP3 later without rewriting the UI.
- **IndexedDB access only via `src/lib/db.ts`** (Dexie). No direct `indexedDB.open` in components.

## Next.js 16 / next-intl 4 quick reference

- Middleware → renamed to **Proxy** (file `proxy.ts`). We don't use either.
- Layout/Page props: `params` is now a `Promise` — always `await params`. Use the global `PageProps<"/[locale]">` / `LayoutProps<"/[locale]">` helpers.
- next-intl v4 server: `setRequestLocale`, `getTranslations`, `getRequestConfig` from `next-intl/server`. `hasLocale` and `NextIntlClientProvider` from `next-intl`.
- Sentence `id` is **not** in the seed JSON — `seedLoader.ts` synthesizes stable ids as `${language}.${islandOrder}.${index}`.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Local dev at `http://localhost:3000` |
| `pnpm build` | Static export → `out/` |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Standalone TS check (see scripts) |

## Out of scope for the current MVP

In-app sentence editing, AI variant generation, paid TTS, multi-device cloud sync, video-subtitle prep. Don't propose work in these areas unless explicitly asked.
