# Vercel frontend builds

Import this repository as two Vercel projects:

| Project | Root Directory | Node.js | Build | Output |
| --- | --- | --- | --- | --- |
| Web UI | `web` | 22.x | `npm run build` | `dist` |
| Landing page | `site` | 22.x | `npm run build` | `dist` |

Enable **Include source files outside of the Root Directory in the Build Step** for both projects. Both use shared source from the repository. Their `vercel.json` files set the install command, build command, and output directory.

The install command first installs the repository's locked Bun dependencies, then the frontend's locked npm dependencies. The frontend TypeScript check follows type-only imports into the core, which needs Bun types and the core dependencies even though they are not shipped in the browser bundle. Installing only `web/` caused TS2688 on Vercel.

The web configuration rewrites the existing client routes to `index.html` for direct links and refreshes, leaving `/api` and `/auth` available for the backend.

These projects host the static frontends. The existing Bun API/task runner still needs a separate backend host and same-origin `/api` and `/auth` proxy routing. Vite's development proxy does not run in a static deployment. No backend migration or production backend URL is included in this build fix.

References: [Vercel monorepos](https://vercel.com/docs/monorepos/monorepo-faq), [Vite deployments](https://vercel.com/docs/frameworks/frontend/vite), [supported package managers](https://vercel.com/docs/package-managers).
