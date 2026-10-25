#!/usr/bin/env bash
# One-time setup of the shared Caramel server on a fresh Ubuntu 24.04 VPS. Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/KatalKavya96/CaramelAI/main/deploy/setup.sh | sudo bash -s -- caramel.example.com
#
# With no domain argument it uses <public-ip>.sslip.io, which resolves to this machine, so Caddy can
# still get a real HTTPS certificate. The script is safe to re-run; it never overwrites /etc/caramel/env.
# CARAMEL_BRANCH picks the branch to deploy (default main).
set -euo pipefail

BUN_VERSION="1.3.14"
REPO_URL="https://github.com/KatalKavya96/CaramelAI.git"
BRANCH="${CARAMEL_BRANCH:-main}"
APP_DIR="/opt/caramel"
DATA_DIR="/var/lib/caramel"
ENV_FILE="/etc/caramel/env"

if [ "$(id -u)" -ne 0 ]; then echo "Run as root." >&2; exit 1; fi

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  DOMAIN="$(curl -fsS https://api.ipify.org).sslip.io"
  echo "No domain given; using $DOMAIN"
fi

echo "==> Packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git unzip debian-keyring debian-archive-keyring apt-transport-https docker.io >/dev/null
if ! command -v caddy >/dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
systemctl enable --now docker

# Oracle Cloud's Ubuntu images ship iptables rules that reject everything but SSH, on top of the
# VCN security list. Open HTTP (certificate challenge, redirect) and HTTPS, and keep them on reboot.
if command -v netfilter-persistent >/dev/null; then
  for port in 80 443; do
    iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null \
      || iptables -I INPUT 1 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
  done
  netfilter-persistent save >/dev/null
fi

echo "==> Bun $BUN_VERSION"
if [ "$(bun --version 2>/dev/null)" != "$BUN_VERSION" ]; then
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v$BUN_VERSION" >/dev/null
fi

echo "==> Service user"
# Membership in the docker group is root-equivalent on this host. The server needs it to start the
# sandbox containers; that is why nothing else should run on this machine.
id caramel >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/caramel --shell /usr/sbin/nologin caramel
usermod -aG docker caramel
install -d -o caramel -g caramel "$DATA_DIR"

echo "==> Code"
if [ ! -d "$APP_DIR/.git" ]; then git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"; fi
chown -R caramel:caramel "$APP_DIR"

echo "==> Secrets"
install -d -m 750 -o root -g caramel /etc/caramel
if [ ! -f "$ENV_FILE" ]; then
  umask 027
  cat > "$ENV_FILE" <<ENV
CARAMEL_PUBLIC_ORIGIN=https://$DOMAIN
CARAMEL_KEY_ENCRYPTION_KEY=$(openssl rand -base64 32)
# Create a GitHub OAuth app with callback https://$DOMAIN/auth/github/callback, then fill these in.
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
CARAMEL_DATA_DIR=$DATA_DIR
CARAMEL_WEB_DIST=$APP_DIR/web/dist
CARAMEL_MAX_CONCURRENT_RUNS=2
CARAMEL_MAX_ACTIVE_RUNS_PER_USER=1
HOST=127.0.0.1
PORT=8787
ENV
  chgrp caramel "$ENV_FILE"
fi

echo "==> systemd and Caddy"
install -m 644 "$APP_DIR/deploy/caramel.service" /etc/systemd/system/caramel.service
sed "s/{\$DOMAIN}/$DOMAIN/" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable caramel >/dev/null
systemctl reload-or-restart caddy

"$APP_DIR/deploy/update.sh" --no-pull

if grep -q '^GITHUB_CLIENT_ID=$' "$ENV_FILE"; then
  cat <<MSG

Almost done. Fill in GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in $ENV_FILE
(OAuth app callback: https://$DOMAIN/auth/github/callback), then run:

  systemctl restart caramel && journalctl -u caramel -f

MSG
else
  echo "Caramel is running at https://$DOMAIN"
fi
