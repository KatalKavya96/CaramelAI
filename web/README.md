# Caramel web

The browser UI for Caramel. It talks only to Caramel's own server (`bun run server` in the repo
root); users sign in with GitHub and bring their own model key.

## Run it locally

```sh
# terminal 1, repo root
CARAMEL_PUBLIC_ORIGIN=http://localhost:5173 bun run server

# terminal 2
cd web
npm install
npm run dev          # http://localhost:5173, proxies /api and /auth to :8787
```

`npm run build` writes `web/dist`, which the server serves itself in production.
`npm run check` runs the typecheck, the tests and the build.

## Layers

Imports only point down. `test/layers.test.ts` fails the build if one points up.

| Layer | Folder | Knows about |
|---|---|---|
| 0 | `src/tokens` | Colours, type, spacing, radii for light and dark. The only place with raw colours. |
| 0 | `src/lib` | The core's types (`contract.ts`), status copy, formatting, diff parsing. |
| 1 | `src/ui` | Primitives: button, pill, menu, dialog, field, icons, logo. |
| 2 | `src/patterns` | Sidebar, composer, palette, settings modal, page layout. No runs, no API. |
| 3 | `src/domain` | Run pieces: steps, outcome, checks, diff, budgets, key form, run composer. Props only. |
| 4 | `src/data` | The only layer that talks to the server: API client, live event stream, queries. |
| 5 | `src/screens`, `src/app` | Pages and routing. |

Live runs are folded with the core's own `reduceRunState`, so the browser and the server can
never disagree about what a run's events mean.

## Changes from the mockups

Colours, components and the logo follow the mockups. Four light-theme colours are a little darker
so text passes WCAG AA contrast; `src/tokens/tokens.css` lists each one with the old ratio.
