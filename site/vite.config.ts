import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const web = fileURLToPath(new URL("../web/src", import.meta.url));
const core = fileURLToPath(new URL("../src", import.meta.url));

// The page renders the app's own components from web/src. Those files sit outside this folder, so
// their bare imports would otherwise resolve against web/node_modules and load a second React.
// dedupe pins every shared package to this folder's copy.
const shared = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-switch",
  "@radix-ui/react-tooltip",
  "@fontsource/inter",
  "@fontsource/figtree",
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@web": web, "@core": core },
    dedupe: shared,
  },
  server: {
    port: 5174,
    fs: { allow: [".."] },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
