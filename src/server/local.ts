import { homedir } from "node:os";
import { resolve } from "node:path";
import { detectNativeSandbox } from "../execution";
import { KeychainKeyStore, LOCAL_APP_POLICY, RunService, testProviderKey, type SecretBackend } from "../service";
import { createApp, type AppOptions, type Capabilities } from "./app";
import { LocalAuth } from "./local-auth";
import { OPENROUTER_CALLBACK_PATH, OpenRouterConnect } from "./openrouter-connect";
import { createProviderModel } from "./providers";

export interface LocalServerOptions {
  /** Runs and the key index. Defaults to ~/.caramel. */
  dataDir?: string;
  /** 0 picks a free port. */
  port?: number;
  webDist?: string;
  secrets?: SecretBackend;
  token?: string;
  runService?: Partial<Parameters<typeof RunService.open>[0]>;
  testKey?: AppOptions["testKey"];
  /** Replaces fetch for the OpenRouter sign-in exchange (tests). */
  fetcher?: typeof fetch;
}

export interface LocalServer {
  /** Open this once to sign in; it carries the launch token. */
  launchUrl: string;
  origin: string;
  token: string;
  capabilities: Capabilities;
  stop(): Promise<void>;
}

/**
 * The desktop app's backend: the same API as the hosted server, for one person on their own
 * machine. Loopback only, a per-launch token instead of GitHub sign-in, local folders allowed,
 * keys in the OS keychain, and commands in the OS sandbox (Docker when there is none).
 */
export async function startLocalServer(options: LocalServerOptions = {}): Promise<LocalServer> {
  const dataDir = resolve(options.dataDir ?? resolve(homedir(), ".caramel"));
  const runsRoot = resolve(dataDir, "runs");
  const keys = await KeychainKeyStore.open({
    root: dataDir,
    ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
  });
  const auth = new LocalAuth(options.token === undefined ? {} : { token: options.token });
  const native = await detectNativeSandbox();
  const service = await RunService.open({
    runsRoot,
    policy: LOCAL_APP_POLICY,
    maxConcurrentRuns: 2,
    maxActiveRunsPerUser: 2,
    resolveKey: (ownerId, provider) => keys.reveal(ownerId, provider),
    createModel: createProviderModel,
    ...options.runService,
  });
  const capabilities: Capabilities = {
    mode: "local",
    sandbox: native ?? "docker",
    network: { default: "none", choices: ["none", "full"] },
    repoKinds: ["local", "git"],
    canApply: true,
    homeDir: homedir(),
  };

  let app: ((request: Request) => Promise<Response>) | undefined;
  let connect: OpenRouterConnect | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    idleTimeout: 0,
    fetch: (request) => {
      // OpenRouter only redirects to "localhost", which the Host check below would refuse. The
      // callback needs no cookie (its one-time state proves the flow), so it is let through here.
      const url = new URL(request.url);
      const host = request.headers.get("host");
      if (url.pathname === OPENROUTER_CALLBACK_PATH && request.method === "GET" &&
          (host === `localhost:${server.port}` || host === `127.0.0.1:${server.port}`)) {
        return connect!.callback(request);
      }
      return app!(request);
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const testKey = options.testKey ?? ((provider, key) => testProviderKey(provider, key));
  connect = new OpenRouterConnect({
    callbackOrigin: `http://localhost:${server.port}`,
    keys,
    userId: "local",
    testKey: (key) => testKey("openrouter", key),
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
  });
  app = createApp({
    service,
    keys,
    auth,
    runsRoot,
    publicOrigin: origin,
    capabilities,
    // Only the exact host the launch URL uses; "localhost" would be a second origin with its own cookie.
    allowedHosts: [`127.0.0.1:${server.port}`],
    staticDir: resolve(options.webDist ?? resolve(import.meta.dir, "../../web/dist")),
    extraRoutes: (request) => auth.exchange(request),
    testKey,
    connectProvider: (provider) => (provider === "openrouter" ? connect!.start() : null),
  });
  return {
    launchUrl: `${origin}/?token=${auth.token}`,
    origin,
    token: auth.token,
    capabilities,
    async stop() {
      await server.stop(true);
      await service.close();
    },
  };
}
