#!/usr/bin/env bash
# Deploy the latest main: pull, install, rebuild the web UI and runner image, restart. Run as root.
# Restarting marks runs in progress as failed, so pick a quiet moment.
set -euo pipefail

APP_DIR="/opt/caramel"
as_caramel() { runuser -u caramel -- "$@"; }

cd "$APP_DIR"
if [ "${1:-}" != "--no-pull" ]; then as_caramel git pull --ff-only --quiet; fi

echo "==> Dependencies"
as_caramel env HOME=/home/caramel bun install --frozen-lockfile

echo "==> Web UI"
# Built in a Node container so the host needs no Node install. The typecheck reads the root
# node_modules installed above, which is why the whole repository is mounted.
docker run --rm --user "$(id -u caramel):$(id -g caramel)" -e HOME=/tmp -e npm_config_cache=/tmp/npm \
  -v "$APP_DIR:/src" -w /src/web node:22-bookworm-slim sh -c "npm ci --include=dev --no-audit --no-fund && npm run build"

echo "==> Runner image"
docker build --quiet --file docker/runner.Dockerfile --tag dinner-runner:0.1.0 . >/dev/null

if grep -q '^GITHUB_CLIENT_ID=$' /etc/caramel/env; then
  echo "GitHub OAuth credentials are not set yet; not starting the server."
  exit 0
fi
systemctl restart caramel
sleep 2
systemctl is-active --quiet caramel && echo "Caramel restarted." || { journalctl -u caramel -n 30 --no-pager; exit 1; }
