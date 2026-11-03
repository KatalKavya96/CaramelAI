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
one universal app (Apple Silicon and Intel), signs it and the backend with your Developer ID, notarizes
it, and drafts a GitHub release with the `.dmg` and `latest.json`. Installed apps check `latest.json`
on launch and offer to update once you publish the draft.

One-time setup:

1. Join the Apple Developer Program. In Keychain Access, create a **Developer ID Application**
   certificate, export it as `.p12`, and save `base64 -i cert.p12 | pbcopy` as the repository secret
   `APPLE_CERTIFICATE`, with its password as `APPLE_CERTIFICATE_PASSWORD`. `APPLE_SIGNING_IDENTITY` is
   the certificate's full name, e.g. `Developer ID Application: Your Name (TEAMID)`.
2. For notarization, add `APPLE_ID`, `APPLE_TEAM_ID`, and an app-specific password from
   account.apple.com as `APPLE_PASSWORD`.
3. Run `bun run tauri signer generate -w ~/.tauri/caramel.key`. Put the **public** key in
   `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` and commit it. Save the private key file's
   contents as `TAURI_SIGNING_PRIVATE_KEY` and its password as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
   Back the private key up: lose it and installed apps can never update again.

Each release: raise `version` in `src-tauri/tauri.conf.json` (the updater only installs a higher
version), tag that commit `v<version>`, push the tag, download the draft's `.dmg` and open it on a Mac,
then publish the release.

The backend's entitlements (`src-tauri/Entitlements.plist`) let Bun's JIT run under the hardened runtime
that notarization requires. Users need `git` (macOS offers to install the command line tools the first
time it runs). Docker is not needed on macOS: commands run in the built-in `sandbox-exec` sandbox.
