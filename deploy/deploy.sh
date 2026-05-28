#!/usr/bin/env bash
# Echo deploy script — runs on the production server.
# Pulls the latest code, installs deps, builds the static export.
# Run from /var/www/echo: ./deploy.sh

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "→ deploy starting at $(date '+%Y-%m-%d %H:%M:%S')"
echo "→ working dir: $APP_DIR"
echo

# 1. Sync source
echo "→ git fetch + pull"
git fetch --quiet origin
git reset --hard "@{u}"
echo "  HEAD: $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"
echo

# 2. Install deps (frozen lockfile = reproducible)
echo "→ pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile
echo

# 3. Build static export → ./out/
echo "→ pnpm build"
pnpm build
echo

echo "✓ deploy done at $(date '+%Y-%m-%d %H:%M:%S')"
echo "  nginx serves /var/www/echo/out/ — no reload needed unless nginx config changed."
