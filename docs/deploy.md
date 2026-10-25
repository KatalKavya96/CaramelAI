# Hosting the shared server

The landing page is static and lives on Vercel (see [vercel.md](vercel.md)). The app is different:
`bun run server` is a long-running process that clones repositories, streams run events over
Server-Sent Events, and starts a Docker container for every command the agent runs. It needs a
machine with a real Docker daemon, so it runs on a small VPS rather than on a serverless platform.

The server also serves the built web UI from `web/dist` on the same origin as the API. The session
cookie and the server's Origin check rely on that, so the VPS hosts both the UI and the API.

## What runs where

```
browser ──https──> Caddy (TLS, :443) ──> bun src/server/main.ts (127.0.0.1:8787)
                                            ├── serves web/dist
                                            ├── /api, /auth
                                            └── docker run dinner-runner:0.1.0 (one per command)
```

| Piece | Path on the VPS |
| --- | --- |
| Code | `/opt/caramel` (a clone of `main`) |
| Secrets and settings | `/etc/caramel/env` |
| Runs, encrypted keys, sessions | `/var/lib/caramel` |
| Service | `systemctl status caramel`, logs with `journalctl -u caramel -f` |

## First deploy

1. Create an Ubuntu 24.04 VPS with at least 2 vCPU and 2 GB of memory, and SSH in.

   On Oracle Cloud's free tier: create an instance with shape **VM.Standard.A1.Flex** (Ampere ARM,
   e.g. 2 OCPU / 12 GB) and image **Canonical Ubuntu 24.04**, then open ports 80 and 443 in the
   subnet's security list (Networking → Virtual cloud networks → your VCN → Security Lists →
   Default → Add Ingress Rules: source `0.0.0.0/0`, TCP, destination ports `80,443`). SSH in as
   `ubuntu`. The setup script opens the same ports in the instance's own iptables rules.
2. Run the setup script, with your domain if you have one (point its DNS A record at the VPS first):

   ```sh
   curl -fsSL https://raw.githubusercontent.com/KatalKavya96/CaramelAI/main/deploy/setup.sh | bash -s -- caramel.example.com
   ```

   Without a domain it uses `<public-ip>.sslip.io`, which still gets a real certificate.
3. Create a GitHub OAuth app (GitHub → Settings → Developer settings → OAuth Apps) with:
   - Homepage URL: `https://<domain>`
   - Authorization callback URL: `https://<domain>/auth/github/callback`
4. Put its client ID and a new client secret into `/etc/caramel/env`, then start the server:

   ```sh
   systemctl restart caramel && journalctl -u caramel -f
   ```

5. Open `https://<domain>`, sign in with GitHub, and add a provider key under **Model providers**.

## Updating

```sh
/opt/caramel/deploy/update.sh
```

It pulls `main`, installs dependencies, rebuilds the web UI and the runner image, and restarts the
service. A restart marks runs in progress as failed.

## Security notes

- The `caramel` service user is in the `docker` group, which is root-equivalent on this machine. Run
  nothing else on the VPS.
- Commands run in unprivileged, read-only-root containers with `--network none`; Docker reduces host
  exposure but is not claimed as a complete security boundary.
- `CARAMEL_KEY_ENCRYPTION_KEY` encrypts users' provider keys. Losing it makes stored keys unreadable;
  leaking it together with `/var/lib/caramel/keys` exposes them. Back it up somewhere private.
