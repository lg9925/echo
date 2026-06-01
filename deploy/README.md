# Deploying Echo

Target: **https://echo.helloworldhub.xyz/** on `ops@165.154.203.38`.

The cloud server already runs another service on `helloworldhub.xyz` (VLESS subscription panel). Echo lives on a **separate subdomain** so it doesn't touch the existing nginx vhost.

---

## First-time setup (one-shot)

### 1. DNS record

Add a DNS `A` record:

```
echo.helloworldhub.xyz   A   165.154.203.38
```

Wait for it to propagate. Verify locally:

```bash
dig +short echo.helloworldhub.xyz
# → 165.154.203.38
```

### 2. SSH into the server

```bash
ssh ops@165.154.203.38
```

### 3. Install Node 24 + pnpm (if not present)

```bash
# Check first — skip the install if already there
node --version  # need v24.x
pnpm --version

# If missing, install via fnm (no sudo needed for ops user):
curl -fsSL https://fnm.vercel.app/install | bash
exec bash
fnm install 24
fnm default 24

# Enable pnpm via corepack (ships with node):
corepack enable
corepack prepare pnpm@latest --activate
```

### 4. Clone the repo

The deploy user (`ops`) needs read access to the GitHub repo. Easiest: add an SSH deploy key to GitHub.

```bash
# On the server, as ops:
ssh-keygen -t ed25519 -C "ops@helloworldhub deploy" -f ~/.ssh/echo_deploy -N ""
cat ~/.ssh/echo_deploy.pub
# Copy the printed key, then on GitHub:
#   https://github.com/lg9925/echo/settings/keys/new
#   → paste, name it "ops@helloworldhub", check "Allow write access" only if you want server-side pushes (you don't), leave unchecked.

# Tell ssh which key to use for github.com:
cat >> ~/.ssh/config <<'EOF'

Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/echo_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

# Test:
ssh -T git@github.com
# → Hi lg9925/echo! You've successfully authenticated...
```

Now clone:

```bash
sudo mkdir -p /var/www/echo
sudo chown ops:ops /var/www/echo
git clone git@github.com:lg9925/echo.git /var/www/echo
cd /var/www/echo
```

### 5. First build

```bash
./deploy/deploy.sh
# pnpm install + pnpm build → ./out/
```

### 6. nginx vhost

```bash
sudo cp deploy/nginx/echo.helloworldhub.xyz.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/echo.helloworldhub.xyz.conf /etc/nginx/sites-enabled/

# Test config — this will FAIL because the SSL cert doesn't exist yet.
sudo nginx -t
```

Temporarily comment out the `ssl_certificate*` lines (or the whole `server { listen 443 ... }` block) so nginx starts on HTTP only, then certbot will fill the cert paths in.

```bash
sudo systemctl reload nginx
```

### 7. SSL via certbot

```bash
# Install certbot if missing:
sudo apt install certbot python3-certbot-nginx

# Sign + auto-edit nginx to use the new cert:
sudo certbot --nginx -d echo.helloworldhub.xyz \
  --non-interactive --agree-tos -m you@example.com --redirect

# Verify auto-renew timer is on:
systemctl status certbot.timer
```

Restore the explicit `ssl_certificate*` paths in `echo.helloworldhub.xyz.conf` to match what certbot wrote (or let certbot's auto-edit stand — both work).

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 8. Test

```bash
curl -I https://echo.helloworldhub.xyz/
# → 200 OK on /zh/index.html (or 301 → /zh/ then 200)
```

Visit in a browser. PWA install prompt should appear in Chrome's address bar.

---

## Backend (API) — first-time setup

The Phase-2 features (想说 / 想懂 / neural TTS) call a small **Node/Hono** server
in `server/`. It runs as a systemd service on the same box and is reached at
**https://api.echo.helloworldhub.xyz/**. The frontend never holds vendor keys —
only the one shared token the server checks.

### B1. DNS

```
api.echo.helloworldhub.xyz   A   165.154.203.38
```

### B2. Server-side secrets (env vars)

Keys live in a root-only file loaded by systemd — **never** in the repo or the
frontend.

```bash
sudo mkdir -p /etc/echo
sudo install -m 600 /dev/null /etc/echo/echo-server.env

# Generate the shared token (this is what you paste into the app's Settings page):
openssl rand -hex 24

sudo tee /etc/echo/echo-server.env >/dev/null <<'EOF'
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=                 # optional
DEEPSEEK_API_KEY=               # optional
ECHO_API_TOKEN=<paste the openssl output here>
PORT=8787
EOF
sudo chmod 600 /etc/echo/echo-server.env
```

> Routing defaults (both 想说 and 想懂 → Claude) live in `server/src/config.ts`.
> To switch a task to a cheaper provider without editing code, add e.g.
> `LLM_GLOSS_PROVIDER=deepseek` / `LLM_GLOSS_MODEL=deepseek-chat` to this file.
> TTS defaults to Edge-TTS (free, no key).

### B3. Build the backend

`deploy.sh` (run once already in step 5) installs the workspace and builds
`server/dist/`. If you skipped it: `pnpm install --frozen-lockfile --trust-lockfile && pnpm --filter echo-server build`.

### B4. systemd service

```bash
# Find your node path FIRST (fnm/nvm node is NOT at /usr/bin/node):
which node    # e.g. /home/ops/.local/share/fnm/.../bin/node
# Edit deploy/echo-server.service → set ExecStart to that node path if needed.

sudo cp /var/www/echo/deploy/echo-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now echo-server
systemctl status echo-server          # should be active (running)
curl -s http://127.0.0.1:8787/health  # → {"ok":true,...}
```

### B5. Let `ops` restart it without a password (for deploy.sh)

```bash
echo 'ops ALL=(root) NOPASSWD: /bin/systemctl restart echo-server' | sudo tee /etc/sudoers.d/echo-server
sudo chmod 440 /etc/sudoers.d/echo-server
```

### B6. nginx vhost + SSL

```bash
sudo cp /var/www/echo/deploy/nginx/api.echo.helloworldhub.xyz.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/api.echo.helloworldhub.xyz.conf /etc/nginx/sites-enabled/
# Comment out the ssl_certificate* lines first so nginx starts on HTTP, then:
sudo certbot --nginx -d api.echo.helloworldhub.xyz \
  --non-interactive --agree-tos -m you@example.com --redirect
sudo nginx -t && sudo systemctl reload nginx

curl -s https://api.echo.helloworldhub.xyz/health   # → {"ok":true,...}
```

### B7. Point the app at the API

In the app, open **Settings** → paste the `ECHO_API_TOKEN` value → **Test connection**
should report success. (The API base defaults to `https://api.echo.helloworldhub.xyz`,
baked in at build time by `deploy.sh`; leave the Settings "API base" field blank.)

### Cost note

Edge-TTS is free. Claude calls (想说/想懂) are ~1.4k in + ~0.7k out tokens each —
on Sonnet roughly 1–2¢ per item. The frequent operation (TTS) costs nothing;
the LLM completions are the only spend.

---

## Each-time deploy

`deploy.sh` now also rebuilds the backend (`server/dist/`), restarts the
`echo-server` service, and bakes `NEXT_PUBLIC_API_URL` into the frontend build.

After changes are committed and pushed:

```bash
# Locally:
git push origin main

# On the server:
ssh ops@165.154.203.38
cd /var/www/echo
./deploy/deploy.sh
```

That's it. No nginx reload needed unless the nginx config itself changed.

> **Note (local SSH config):** on the maintainer's machine this host is
> reachable via the `panel` alias in `~/.ssh/config` (it maps
> `165.154.203.38` to the right `IdentityFile`). Plain `ssh ops@165.154.203.38`
> won't pick up that key and fails with `Permission denied (publickey)`.
> Use `ssh panel ...` from that machine.

### One-liner from your laptop

```bash
ssh ops@165.154.203.38 'cd /var/www/echo && ./deploy/deploy.sh'
# or, using the local ssh-config alias:
ssh panel 'cd /var/www/echo && ./deploy/deploy.sh'
```

---

## Updating nginx config

If you edit `deploy/nginx/echo.helloworldhub.xyz.conf`:

```bash
# On the server, after deploy.sh has pulled new code:
sudo cp /var/www/echo/deploy/nginx/echo.helloworldhub.xyz.conf /etc/nginx/sites-available/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Local on-device testing via Cloudflare Tunnel

To test on a phone (real iOS audio, PWA install, neural TTS) **without deploying**,
expose the local dev servers under `echo.helloworldhub.xyz` through a Cloudflare
Tunnel. The domain temporarily points at your laptop instead of the VPS — so the
production site is paused while this is active.

**How it routes:** one tunnel hostname, split by path. `/v1/*` and `/health` go to
the backend (`localhost:8787`); everything else goes to `next dev`
(`localhost:3000`). Because it's the *same origin*, no CORS, no second subdomain,
no `NEXT_PUBLIC_API_URL` rebuild — the phone just sets the API base in Settings.

This reuses the existing `cloudflared` tunnel (the one already serving
`console-dev.cz12.net`); `helloworldhub.xyz` must be in the **same Cloudflare
account** as that tunnel.

### Config (where it actually lives)

- **`cloudflared` runs as a Windows service** under LocalSystem, so it reads its
  config from the *system profile* — **not** your user home. Confirm the path:

  ```powershell
  (Get-CimInstance Win32_Service -Filter "Name='cloudflared'").PathName
  # → ... --config "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml" ... tunnel run
  ```

  That file holds the `console-dev` ingress; the echo rules must be added to **it**.
  Editing `C:\Users\<you>\.cloudflared\config.yml` has **no effect** — the service
  never reads that copy. The two rules go in above the `http_status:404` catch-all,
  leaving `console-dev` untouched:

  ```yaml
    - hostname: echo.helloworldhub.xyz
      path: ^/(v1|health)(/|$)
      service: http://localhost:8787
    - hostname: echo.helloworldhub.xyz
      service: http://localhost:3000
  ```

  The system-profile file needs admin to write. Keep a staging copy at
  `C:\Users\lg992\.cloudflared\service-config.yml` (the full desired config, with
  `credentials-file` pointing at the system-profile `.json`) and apply it with the
  one-liner in step 2.
- `next.config.ts` — `allowedDevOrigins: ["echo.helloworldhub.xyz"]` so `next dev`
  accepts requests proxied from the domain (dev-only; no effect on the export).

Validate ingress syntax after editing the staging file:

```powershell
cloudflared --config "C:\Users\lg992\.cloudflared\service-config.yml" tunnel ingress validate
```

### Turn it on

1. **Pause prod / repoint DNS** (Cloudflare dashboard → `helloworldhub.xyz` → DNS):
   delete the `echo` **A** record pointing to the VPS (`165.154.203.38`), then add a
   **CNAME** by hand:

   - Name `echo` → Target `e7689629-6e2d-4c20-9dec-fb1b885ae66e.cfargotunnel.com`
   - Proxy status **Proxied (orange)**

   > Don't use `cloudflared tunnel route dns …` for this: the local `cert.pem` is
   > authorized for the **cz12.net** zone only, so it mangles the name into
   > `echo.helloworldhub.xyz.cz12.net` (and litters that junk record in cz12.net).
   > The manual CNAME works because the tunnel is in the same account. `echo` is a
   > single-level subdomain, so Universal SSL covers it — no extra cert.

2. **Apply the echo rules to the service config + reload** (admin PowerShell, one
   line — backs up, overwrites from the staging file, restarts):

   ```powershell
   $c="C:\Windows\System32\config\systemprofile\.cloudflared\config.yml"; Copy-Item $c "$c.bak-echo" -Force; Copy-Item "C:\Users\lg992\.cloudflared\service-config.yml" $c -Force; Restart-Service cloudflared
   ```

   This blips `console-dev.cz12.net` for a few seconds; pick a safe moment.

3. **Run both local servers:** backend on `:8787` (`pnpm --filter echo-server dev`
   or however you run it) and `pnpm dev` for the frontend on `:3000`.

4. **On the device:** open `https://echo.helloworldhub.xyz`, go to **Settings**:
   - **API base** → `https://echo.helloworldhub.xyz`
   - **Token** → your local `ECHO_API_TOKEN` (e.g. `testtoken` from `server/.env`)
   - **Test connection** should pass.

   Desktop dev at `localhost:3000` is unaffected — it keeps using the default
   `localhost:8787` and needs no API-base override.

### Gotcha: stale production service worker

If a device (or browser) visited the **production** `echo.helloworldhub.xyz`
before, the prod build's Serwist service worker is still registered on that
origin. Dev mode ships no SW, so the stale prod SW keeps intercepting navigations
and serving cached prod HTML/chunks into the freshly compiled dev bundle — which
shows up as **React hydration mismatches** ("a tree hydrated but some attributes …
didn't match") and generally stale/broken pages.

Remediation: while the domain points at dev, `public/sw.js` is replaced with a
**kill-switch worker** (git-ignored; a real `pnpm build` regenerates the genuine
one). On its next update check the browser picks it up, wipes all Cache Storage,
unregisters itself, and reloads — so each client self-heals after **a reload or
two**. It does **not** touch IndexedDB, so the inbox / audio cache / Settings
survive. If a device is stubborn, clear that site's data once (Settings → website
data) — you'll just re-enter the token + API base.

> Don't merely `rm public/sw.js`: a 404 on the SW script does **not** unregister an
> already-installed worker, so the stale one keeps running. The kill-switch is what
> actually removes it.

### Gotcha: long LLM calls hit Cloudflare's ~100s edge timeout (524)

Cloudflare's edge has a fixed **~100s** response timeout (it returns **524** past
that) and it is **not configurable** off the Enterprise plan. Scenario generation
(15+ sentences) on `claude-cli` + sonnet takes ~160s, so over the tunnel it 524s
before finishing — even though it works fine on `localhost` and worked in prod
(nginx `proxy_read_timeout` was bumped to 180s there).

The SSE stream *does* keep the connection alive **as long as data keeps flowing**
(progress events reset the idle clock). The 524 hits when nothing reaches the edge
for 100s — e.g. sonnet spending >100s before its first token.

Dev fix: route scenario to a faster model in `server/.env`:

```
LLM_SCENARIO_MODEL=haiku   # ~50s, streams steadily, completes under the limit
```

`想说` (authoring) and `想懂` (gloss) are small/fast and stay on sonnet. Production
keeps sonnet (it doesn't go through Cloudflare). Restart the backend after editing.

### Turn it off / restore prod

In the Cloudflare dashboard, delete the `echo` CNAME and add the A record back:

```
echo.helloworldhub.xyz   A   165.154.203.38
```

Stopping `pnpm dev` also takes the local site offline (the tunnel ingress just
returns errors until DNS is restored). While the tunnel is up your `:3000`/`:8787`
are reachable from the internet, gated only by the `ECHO_API_TOKEN`.

---

## Troubleshooting

- **`pnpm: command not found`** during `deploy.sh`: corepack inactive or pnpm uninstalled. Re-run step 3.
- **Build fails on server** with OOM: small VPS. Add swap (`sudo fallocate -l 2G /swapfile; sudo mkswap /swapfile; sudo swapon /swapfile`) and retry.
- **PWA not installable**: confirm `https://echo.helloworldhub.xyz/sw.js` returns 200 and `/manifest.json` is valid JSON.
- **Service worker stuck on old version**: `Cache-Control: no-cache` on `/sw.js` is set in nginx; a hard reload (Ctrl+Shift+R) should force the swap. If not, `chrome://serviceworker-internals/` → unregister.
- **404 on every page**: check `try_files $uri $uri/ $uri.html /404.html;` is intact and `root /var/www/echo/out;` exists.
