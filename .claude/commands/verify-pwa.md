---
description: Verify Echo's PWA setup end-to-end (manifest, service worker, offline, Lighthouse score) using the chrome-devtools MCP tools.
---

Run a full PWA verification pass on the local Echo build.

## Prerequisites

Make sure the production output is being served. If the user hasn't started something on a port, run `pnpm build` then serve `out/` over a static server (e.g., `npx serve out -p 4173`) or `pnpm dev` — Serwist is disabled in dev, so a few checks must use a built `out/`.

Ask the user once: "Are we testing against `pnpm dev` (port 3000) or a built `out/` (port 4173)?" Then proceed.

## Steps

For each check, use chrome-devtools MCP tools, not Bash. Stop and report the failure if a step fails — do not retry blindly.

### 1. Load the home page
- `mcp__chrome-devtools__navigate_page` → `http://localhost:<port>/`
- `mcp__chrome-devtools__list_console_messages` → confirm no errors
- Confirm `/` redirects to `/zh/` or `/en/`

### 2. Manifest
- `mcp__chrome-devtools__evaluate_script` → fetch `/manifest.json`, parse JSON, verify: `name === "Echo"`, `display === "standalone"`, at least one icon with `purpose: any` at 192 or 512, `start_url` matches `/zh/` or `/en/`.

### 3. Service worker (only meaningful against `out/`, not `dev`)
- `mcp__chrome-devtools__evaluate_script` → `await navigator.serviceWorker.getRegistration()` — should be defined and active.
- Reload, then check `navigator.serviceWorker.controller` is non-null on second load.

### 4. Seed cached for offline
- After SW activates, `fetch("/seed/echo_seed_de.json")` via `evaluate_script` should succeed.
- `caches.keys()` should return at least one cache entry.

### 5. Lighthouse PWA audit
- `mcp__chrome-devtools__lighthouse_audit` with category `pwa` (and optionally `performance`).
- Report the installability and PWA-optimized checks. Don't expect 100; focus on green for installability.

### 6. Mobile viewport sanity
- `mcp__chrome-devtools__emulate` viewport `390x844x3,mobile,touch`.
- Navigate to `/zh/shadow/de.1/` and `/zh/review/`.
- `evaluate_script` to verify `document.documentElement.scrollWidth <= window.innerWidth` (no horizontal scroll).

## Report

Summarize as a short table:
- Manifest: pass/fail
- Service worker: pass/fail (or N/A in dev)
- Offline seed: pass/fail
- Lighthouse installability: pass/fail
- Mobile no-overflow: pass/fail

Flag any failures with the exact symptom and which file is the likely culprit. Do **not** try to fix issues automatically — that's a separate task.
