# Caramel desktop (Tauri)

A thin native window around the local backend. The shell does four things:

1. Starts the backend (`src/server/local-main.ts`, compiled to one file by `bun build --compile`) as a
   Tauri sidecar with `--no-open --watch-stdin`.
2. Waits for its `CARAMEL_READY {...}` line and opens a window at the one-time launch URL. The backend
   swaps the token for an HttpOnly cookie, exactly as in the browser.
3. Gives the page `window.caramelShell.pickFolder()`, which opens the OS folder picker. Only pages from
   `http://127.0.0.1:*` may call it (`capabilities/main.json`), and links to any other site open in the
   user's browser instead of inside the window.
4. Stops the backend on quit. If the shell crashes, the backend sees its stdin close and stops itself.

Everything else (runs, sandbox, keys in the Keychain) is the same backend as `bun run app`.

## Build

Needs Rust (`rustup`), Bun, and on Linux the WebKitGTK dev packages
(`libwebkit2gtk-4.1-dev librsvg2-dev`). On macOS the Xcode command line tools are enough.

```sh
cd desktop
bun install
bun run dev      # compiles the backend, then opens the app with hot Rust rebuilds
bun run build    # builds web/, the backend and an installer (.dmg/.app on macOS)
```

`web/dist` must exist before `dev` (run `bun run web` once); the window serves it from the app's
resources, not from Vite.

Builds from `bun run build` are unsigned and only for your own Mac: Gatekeeper blocks them elsewhere,
and the Keychain asks again for saved keys after every rebuild, because it trusts a binary by its
signature. Releases for other people come from CI, below.

## Release (macOS)

Pushing a tag such as `v0.1.0` runs `.github/workflows/desktop-release.yml` on a macOS runner. It builds
one universal app (Apple Silicon and Intel) and drafts a GitHub release with the `.dmg`, the app archive
and `latest.json`. Installed apps check `latest.json` on launch and offer to update once you publish the
draft. Updates download inside the app, so they never hit Gatekeeper.

Users install it one of two ways, both described in the release notes:

- **Terminal:** `curl -fsSL https://raw.githubusercontent.com/KatalKavya96/CaramelAI/main/scripts/install-desktop.sh | sh`.
  Files curl downloads are not quarantined, so the app opens without a prompt.
- **.dmg:** without notarization, macOS blocks the first launch. The user tries to open it, then clicks
  **Open Anyway** in System Settings → Privacy & Security. (Right-click → Open no longer works on macOS 15.)

### One-time setup

Run `bun run tauri signer generate -w ~/.tauri/caramel.key`. Put the **public** key in
`plugins.updater.pubkey` in `src-tauri/tauri.conf.json` and commit it. In the repository's Actions secrets,
save the private key file's contents as `TAURI_SIGNING_PRIVATE_KEY` and its password as
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Back the private key up: lose it and installed apps can never update
again. This key is free and has nothing to do with Apple.

### Signing: ad-hoc now, Developer ID later

With no Apple secrets, the workflow signs the app ad-hoc (`codesign -s -`). That is not trust, only a seal
over the bundle's files: an unsigned bundle shows "Caramel is damaged" on Apple Silicon, which no setting
gets past. Two costs remain: the `.dmg` needs Open Anyway once, and the Keychain asks again for saved API
keys after each update, because an ad-hoc signature changes with every build.

To remove both later, join the Apple Developer Program and add these secrets; the workflow then signs with
your Developer ID and notarizes, and the release notes' Open Anyway paragraph can go:

1. `APPLE_CERTIFICATE`: a **Developer ID Application** certificate exported from Keychain Access as `.p12`,
   then `base64 -i cert.p12 | pbcopy`. `APPLE_CERTIFICATE_PASSWORD`: its export password.
   `APPLE_SIGNING_IDENTITY`: its full name, from `security find-identity -v -p codesigning`.
2. `APPLE_ID`, `APPLE_TEAM_ID`, and an app-specific password from account.apple.com as `APPLE_PASSWORD`.

### Each release

Raise `version` in `src-tauri/tauri.conf.json` (the updater only installs a higher version), tag that
commit `v<version>`, push the tag, download the draft's `.dmg` and open it on a Mac, then publish the
release. The install script and in-app updates only see published releases.

The backend's entitlements (`src-tauri/Entitlements.plist`) let Bun's JIT run under the hardened runtime.
Users need `git` (macOS offers to install the command line tools the first time it runs). Docker is not
needed on macOS: commands run in the built-in `sandbox-exec` sandbox.
