# `src/app/` — App Router pages

## Static-export rules (non-negotiable)

- Every dynamic segment needs `generateStaticParams()` enumerating all values at build time. We have `[locale]` (and later `[islandId]`).
- Every layout/page **must** call `setRequestLocale(locale)` from `next-intl/server` before any `getTranslations()` / `useTranslations()` call. Skipping this forces dynamic rendering and breaks `next build`.
- `params` is a `Promise` in Next.js 16+. Always `await params`.
- No Proxy (`proxy.ts`). No Server Actions. No `redirect()` from `next/navigation` (won't work in export). No `cookies()`. No dynamic Route Handlers.

## Layout structure

- `src/app/layout.tsx` is the **real root layout** — owns `<html lang="zh">` and `<body>` plus the font CSS variables. `<html lang>` defaults to the default locale; `HtmlLangSync` (a client component mounted in `[locale]/layout.tsx`) updates it after hydration to match the active locale.
- `src/app/[locale]/layout.tsx` is the **locale segment layout** — calls `setRequestLocale`, wraps children in `NextIntlClientProvider`, mounts `HtmlLangSync`. Does NOT render `<html>` (only one html ancestor allowed).
- `src/app/page.tsx` handles **root `/`** with a tiny client-side redirect to `/{detectedLocale}/` based on `navigator.language`, falling back to `routing.defaultLocale`. After `next build`, this becomes a static `out/index.html`.

## Browser-API pages

Pages that need IndexedDB / SpeechSynthesis / wakeLock should:
1. Be a thin server component that calls `setRequestLocale` and renders a Client Component.
2. Put the actual browser logic in a `"use client"` component under `src/components/`.

Do not import from `src/lib/db.ts`, `src/lib/tts.ts`, etc. directly in a server component — they touch browser APIs.

## Routes (current + planned)

- `/[locale]/` — home: pick language → pick island
- `/[locale]/shadow/[islandId]/` — shadowing player (Phase 2)
- `/[locale]/review/` — spaced-repetition review (Phase 3)
- `/[locale]/settings/` — speed / pause / voice / UI lang (Phase 4)
