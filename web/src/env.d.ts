// The core's sources are type-checked with Bun's globals, which conflict with vite/client's
// ImportMetaEnv. The UI needs only these two declarations from it.
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
declare module "*.css";
declare module "*.svg" {
  const url: string;
  export default url;
}

/** Exposed by the desktop shell's preload script, when Caramel runs inside it. */
interface CaramelShell {
  pickFolder?: () => Promise<string | null>;
}

interface Window {
  caramelShell?: CaramelShell;
}
