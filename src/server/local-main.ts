import { startLocalServer } from "./local";

/**
 * `bun run app`: starts the desktop backend and opens it in the browser. The Tauri shell in
 * desktop/ starts this same process with --no-open --watch-stdin and reads the ready line instead.
 */
const noOpen = process.argv.includes("--no-open");
const watchStdin = process.argv.includes("--watch-stdin");
const server = await startLocalServer({
  ...(Bun.env.CARAMEL_DATA_DIR === undefined ? {} : { dataDir: Bun.env.CARAMEL_DATA_DIR }),
  ...(Bun.env.PORT === undefined ? {} : { port: Number(Bun.env.PORT) }),
  ...(Bun.env.CARAMEL_WEB_DIST === undefined ? {} : { webDist: Bun.env.CARAMEL_WEB_DIST }),
});

// One machine-readable line for a desktop shell, then the human one.
console.log(`CARAMEL_READY ${JSON.stringify({ url: server.launchUrl, capabilities: server.capabilities })}`);
console.log(`Caramel is running. Open ${server.launchUrl}`);
console.log(`Commands run in: ${server.capabilities.sandbox === "docker" ? "Docker" : `the ${server.capabilities.sandbox} sandbox`}`);

if (!noOpen) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  try {
    Bun.spawn([opener, server.launchUrl], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  } catch {
    // No browser launcher (e.g. a headless machine): the URL above is enough.
  }
}

let stopping = false;
function shutdown(): void {
  if (stopping) process.exit(130);
  stopping = true;
  void server.stop().finally(() => process.exit(0));
}
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, shutdown);

if (watchStdin) {
  // The shell holds our stdin open. If it crashes or is force-quit it cannot send a signal, but the
  // OS closes the pipe, so end-of-input means the window is gone and the backend must not linger.
  void (async () => {
    for await (const _ of Bun.stdin.stream()) {
      // Input is ignored; only the end of it matters.
    }
    shutdown();
  })();
}
