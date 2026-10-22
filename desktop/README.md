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

Unsigned builds trigger Gatekeeper on other Macs. Signing and notarisation come before sharing it.
