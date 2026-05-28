# Deploying Echo

Target: **https://echo.hellowordhub.xyz/** on `ops@165.154.203.38`.

The cloud server already runs another service on `hellowordhub.xyz` (VLESS subscription panel). Echo lives on a **separate subdomain** so it doesn't touch the existing nginx vhost.

---

## First-time setup (one-shot)

### 1. DNS record

Add a DNS `A` record:

```
echo.hellowordhub.xyz   A   165.154.203.38
```

Wait for it to propagate. Verify locally:

```bash
dig +short echo.hellowordhub.xyz
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
ssh-keygen -t ed25519 -C "ops@hellowordhub deploy" -f ~/.ssh/echo_deploy -N ""
cat ~/.ssh/echo_deploy.pub
# Copy the printed key, then on GitHub:
#   https://github.com/lg9925/echo/settings/keys/new
#   → paste, name it "ops@hellowordhub", check "Allow write access" only if you want server-side pushes (you don't), leave unchecked.

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
sudo cp deploy/nginx/echo.hellowordhub.xyz.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/echo.hellowordhub.xyz.conf /etc/nginx/sites-enabled/

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
sudo certbot --nginx -d echo.hellowordhub.xyz \
  --non-interactive --agree-tos -m you@example.com --redirect

# Verify auto-renew timer is on:
systemctl status certbot.timer
```

Restore the explicit `ssl_certificate*` paths in `echo.hellowordhub.xyz.conf` to match what certbot wrote (or let certbot's auto-edit stand — both work).

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 8. Test

```bash
curl -I https://echo.hellowordhub.xyz/
# → 200 OK on /zh/index.html (or 301 → /zh/ then 200)
```

Visit in a browser. PWA install prompt should appear in Chrome's address bar.

---

## Each-time deploy

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

### One-liner from your laptop

```bash
ssh ops@165.154.203.38 'cd /var/www/echo && ./deploy/deploy.sh'
```

---

## Updating nginx config

If you edit `deploy/nginx/echo.hellowordhub.xyz.conf`:

```bash
# On the server, after deploy.sh has pulled new code:
sudo cp /var/www/echo/deploy/nginx/echo.hellowordhub.xyz.conf /etc/nginx/sites-available/
sudo nginx -t
sudo systemctl reload nginx
```

---

## Troubleshooting

- **`pnpm: command not found`** during `deploy.sh`: corepack inactive or pnpm uninstalled. Re-run step 3.
- **Build fails on server** with OOM: small VPS. Add swap (`sudo fallocate -l 2G /swapfile; sudo mkswap /swapfile; sudo swapon /swapfile`) and retry.
- **PWA not installable**: confirm `https://echo.hellowordhub.xyz/sw.js` returns 200 and `/manifest.json` is valid JSON.
- **Service worker stuck on old version**: `Cache-Control: no-cache` on `/sw.js` is set in nginx; a hard reload (Ctrl+Shift+R) should force the swap. If not, `chrome://serviceworker-internals/` → unregister.
- **404 on every page**: check `try_files $uri $uri/ $uri.html /404.html;` is intact and `root /var/www/echo/out;` exists.
