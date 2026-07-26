# `src/app/` — App Router pages

## Static-export rules (non-negotiable)

- Every dynamic segment needs `generateStaticParams()` enumerating all values at build time. We have `[locale]`, `[lang]`, and `[islandId]`.
- Every layout/page **must** call `setRequestLocale(locale)` from `next-intl/server` before any `getTranslations()` / `useTranslations()` call. Skipping this forces dynamic rendering and breaks `next build`.
- `params` is a `Promise` in Next.js 16+. Always `await params`. Use the global `PageProps<"/[locale]/[lang]">` / `LayoutProps<"/[locale]">` helpers for typing.
- No Proxy (`proxy.ts`). No Server Actions. No `redirect()` from `next/navigation` (won't work in export). No `cookies()`. No dynamic Route Handlers. (Full disabled-features list: root `CLAUDE.md`.)

## Two language dimensions: `[locale]` vs `[lang]`

These are **different things** — don't conflate them:

- **`[locale]`** = UI / interface language. Values: `zh` | `en` (from `src/i18n/routing.ts`). Drives next-intl translations.
- **`[lang]`** = the target language being learned. Values: `de` | `en` (from `contracts.ts` `TargetLanguage`). Drives which islands/seed/reviews are shown.

So `/zh/de/inbox/` = a Chinese UI, learning German. See `[locale]/[lang]/page.tsx`.

## Layout structure

- `src/app/layout.tsx` is the **real root layout** — owns `<html lang="zh">` and `<body>` plus the font CSS variables. `<html lang>` defaults to the default locale; `HtmlLangSync` (a client component mounted in `[locale]/layout.tsx`) updates it after hydration to match the active locale.
- `src/app/[locale]/layout.tsx` is the **locale segment layout** — calls `setRequestLocale`, wraps children in `NextIntlClientProvider`, mounts `HtmlLangSync`. Does NOT render `<html>` (only one html ancestor allowed).
- `src/app/page.tsx` handles **root `/`** — a tiny inline client script that redirects to `/{detectedLocale}/` based on `navigator.language` (falling back to `routing.defaultLocale`), via `window.location.replace`. After `next build` this is a static `out/index.html`. There is **no** `public/index.html`.

## Browser-API pages

Pages that need IndexedDB / SpeechSynthesis / wakeLock should:
1. Be a thin server component that calls `setRequestLocale` and renders a Client Component.
2. Put the actual browser logic in a `"use client"` component under `src/components/`.

Do not import from `src/lib/db.ts`, `src/lib/tts.ts`, etc. directly in a server component — they touch browser APIs.

## next-intl v4 quick reference

- Server: `setRequestLocale`, `getTranslations`, `getRequestConfig` from `next-intl/server`.
- Client / shared: `hasLocale`, `NextIntlClientProvider` from `next-intl`.

## Current routes

| Route | Purpose |
|---|---|
| `/` (`page.tsx`) | Root redirect → `/{locale}/` (client-side) |
| `/[locale]/` | Home — pick a target language |
| `/[locale]/[lang]/` | Language hub — pick an island, enter inbox (`generateStaticParams` enumerates `["de","en"]`) |
| `/[locale]/[lang]/inbox/` | Inbox capture — 想说 / 想懂 / 场景 |
| `/[locale]/island/` | Island view |
| `/[locale]/shadow/[islandId]/` | Shadowing player |
| `/[locale]/review/` | Spaced-repetition review |
| `/[locale]/settings/` | Speed / pause / voice / UI lang / API token |
| `/[locale]/a1/` | A1 course home — 今天的下一个动作 + cumulative stats (de-only module, like einbuergerung) |
| `/[locale]/a1/cards/` | A1 interleaved card session (word/cloze/dictation cards) |
| `/[locale]/a1/diktat/` | 听写 (Diktat) — sentences with length ladder + number sub-modes |
