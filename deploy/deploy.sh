#!/usr/bin/env bash
# Echo deploy script — runs on the production server.
# Pulls the latest code, installs deps, (re)builds the backend + static export.
# Run from /var/www/echo: ./deploy.sh

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

# Where the static frontend should reach the backend. Inlined into the build
# (NEXT_PUBLIC_*). Override by exporting before running this script.
: "${NEXT_PUBLIC_API_URL:=https://api.echo.helloworldhub.xyz}"
export NEXT_PUBLIC_API_URL

echo "→ deploy starting at $(date '+%Y-%m-%d %H:%M:%S')"
echo "→ working dir: $APP_DIR"
echo

# 1. Sync source
echo "→ git fetch + pull"
git fetch --quiet origin
git reset --hard "@{u}"
echo "  HEAD: $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"
echo

# 2. Install deps. --frozen-lockfile = reproducible; --trust-lockfile
# disables pnpm 11's minimumReleaseAge supply-chain check because we own
# the lockfile via Git and have already vetted it locally.
echo "→ pnpm install --frozen-lockfile --trust-lockfile"
pnpm install --frozen-lockfile --trust-lockfile
echo

# 3. Build the backend (echo-server) → server/dist/, then restart it IF the
#    systemd unit is installed. Frontend-first deploys (before the §B backend
#    setup) skip the restart gracefully instead of aborting.
echo "→ pnpm --filter echo-server build"
pnpm --filter echo-server build
echo
if [ -f /etc/systemd/system/echo-server.service ]; then
  echo "→ restart echo-server (systemd)"
  # Needs a sudoers entry so 'ops' can restart without a password — see deploy/README.md §B5.
  sudo systemctl restart echo-server
  echo "  echo-server: $(systemctl is-active echo-server)"
else
  echo "→ echo-server systemd unit not installed — skipping backend restart"
  echo "  (inbox / scenario / neural TTS need the backend; see deploy/README.md §B)"
fi
echo

# 4. Build static export → ./out/  (NEXT_PUBLIC_API_URL inlined here)
echo "→ pnpm build  (NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL)"
pnpm build
echo

echo "✓ deploy done at $(date '+%Y-%m-%d %H:%M:%S')"
echo "  nginx serves /var/www/echo/out/ — no reload needed unless nginx config changed."
echo "  backend on 127.0.0.1:8787 via api.echo.helloworldhub.xyz."
