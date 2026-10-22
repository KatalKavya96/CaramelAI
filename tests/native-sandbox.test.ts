import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NativeCommandRunner,
  bubblewrapArguments,
  detectNativeSandbox,
  nativeEnvironmentBase,
  seatbeltArguments,
  seatbeltProfile,
} from "../src/execution";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(path);
  return path;
}

describe("native sandbox arguments", () => {
  test("Seatbelt gets paths as parameters, never spliced into the profile", () => {
    const args = seatbeltArguments({
      workspacePath: '/work/a "quoted" path',
      homePath: "/runs/home",
      denyRead: ["/Users/me/.ssh"],
      network: "none",
      command: "bun test",
    });
    const profile = args[args.indexOf("-p") + 1]!;
    expect(profile).not.toContain("quoted");
    expect(profile).not.toContain(".ssh");
    expect(args).toContain('WORKSPACE=/work/a "quoted" path');
    expect(args).toContain("DENY_0=/Users/me/.ssh");
    expect(args.slice(-3)).toEqual(["/bin/sh", "-c", "bun test"]);
  });

  test("Seatbelt allows only loopback without network and DNS with it", () => {
    const offline = seatbeltProfile({ denyCount: 0, network: "none" });
    expect(offline).toContain("(deny network*)");
    expect(offline).toContain('(allow network-outbound (remote ip "localhost:*"))');
    const online = seatbeltProfile({ denyCount: 2, network: "bridge" });
    expect(online).not.toContain("(deny network*)");
    expect(online).toContain("mDNSResponder");
    expect(online).toContain('(subpath (param "DENY_1")))');
  });

  test("bubblewrap hides denied paths and binds the workspace last", () => {
    const args = bubblewrapArguments({
      workspacePath: "/runs/1/repo",
      homePath: "/runs/1/home",
      cwd: "/runs/1/repo/src",
      deniedDirectories: ["/home/me/.ssh", "/runs"],
      deniedFiles: ["/home/me/.netrc"],
      network: "none",
      command: "make test",
    });
    expect(args).toContain("--unshare-net");
    expect(args.join(" ")).toContain("--tmpfs /runs ");
    expect(args.join(" ")).toContain("--ro-bind /dev/null /home/me/.netrc");
    expect(args.lastIndexOf("--bind")).toBeGreaterThan(args.indexOf("/runs"));
    expect(bubblewrapArguments({ ...{ workspacePath: "/w", homePath: "/h", cwd: "/w", deniedDirectories: [], deniedFiles: [], command: "x" }, network: "bridge" }))
      .not.toContain("--unshare-net");
  });

  test("commands do not inherit the host environment", () => {
    const base = nativeEnvironmentBase(
      { PATH: "/usr/bin", OPENROUTER_API_KEY: "sk-secret", LANG: "en_US.UTF-8", NVM_DIR: "/opt/nvm" },
      "/home/me",
      "/runs/1/home",
      new Set(["CARGO_HOME"]),
    );
    expect(base).toEqual({
      PATH: "/usr/bin",
      HOME: "/runs/1/home",
      TMPDIR: "/runs/1/home/tmp",
      LANG: "en_US.UTF-8",
      NVM_DIR: "/opt/nvm",
      CARGO_HOME: "/home/me/.cargo",
    });
  });
});

const available = await detectNativeSandbox();

describe.skipIf(available === null)(`native sandbox on this machine (${available ?? "none"})`, () => {
  async function setup(network: "none" | "bridge" = "none") {
    const root = await temporaryDirectory("caramel-native-");
    const workspace = join(root, "repo");
    const fakeHome = join(root, "user-home");
    const outside = join(root, "outside");
    await mkdir(join(workspace, "src"), { recursive: true });
    await mkdir(join(fakeHome, ".ssh"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(fakeHome, ".ssh", "id_ed25519"), "PRIVATE KEY");
    await writeFile(join(outside, "notes.txt"), "outside");
    const runner = await NativeCommandRunner.create(
      { workspacePath: workspace, logsPath: join(root, "logs"), network, defaultTimeoutMs: 10_000 },
      {
        hostHome: fakeHome,
        hostEnvironment: { PATH: process.env.PATH, OPENROUTER_API_KEY: "sk-or-v1-secret" },
      },
    );
    return { runner, workspace, fakeHome, outside };
  }

  test("runs in the workspace and writes there", async () => {
    const { runner, workspace } = await setup();
    const result = await runner.run({ command: "pwd && echo hi > made.txt", purpose: "agent", cwd: "src" });
    expect(result.status).toBe("completed");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.preview.trim().endsWith("/repo/src")).toBeTrue();
    expect(result.image).toBe(`native:${available}`);
    expect(await readFile(join(workspace, "src", "made.txt"), "utf8")).toBe("hi\n");
  });

  test("cannot write outside the workspace or read credentials", async () => {
    const { runner, fakeHome, outside } = await setup();
    const write = await runner.run({ command: `echo changed > ${outside}/notes.txt`, purpose: "agent" });
    expect(write.exitCode).not.toBe(0);
    expect(await readFile(join(outside, "notes.txt"), "utf8")).toBe("outside");
    const read = await runner.run({ command: `cat ${fakeHome}/.ssh/id_ed25519`, purpose: "agent" });
    expect(read.stdout.preview).not.toContain("PRIVATE KEY");
  });

  test("does not pass the host's API keys into commands", async () => {
    const { runner } = await setup();
    const result = await runner.run({ command: "env", purpose: "agent" });
    expect(result.stdout.preview).not.toContain("sk-or-v1-secret");
    expect(result.stdout.preview).toContain("CI=1");
  });

  test("has no network when the run is offline", async () => {
    const { runner } = await setup("none");
    const result = await runner.run({
      command: `bun -e "await fetch('https://example.com', { signal: AbortSignal.timeout(3000) })"`,
      purpose: "agent",
    });
    expect(result.exitCode).not.toBe(0);
  });

  test("reaches host services only when the run has network", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("host service") });
    try {
      const command = `bun -e "console.log(await (await fetch('http://127.0.0.1:${server.port}', { signal: AbortSignal.timeout(3000) })).text())"`;
      const online = await (await setup("bridge")).runner.run({ command, purpose: "agent" });
      expect(online.stdout.preview).toContain("host service");
      // bubblewrap gives offline runs their own loopback; Seatbelt allows localhost so local test servers work.
      if (available === "bubblewrap") {
        const offline = await (await setup("none")).runner.run({ command, purpose: "agent" });
        expect(offline.exitCode).not.toBe(0);
      }
    } finally {
      server.stop(true);
    }
  });

  test("kills background children on timeout", async () => {
    const { runner, workspace } = await setup();
    const result = await runner.run({
      command: "(sleep 1; echo late > late.txt) & sleep 30",
      purpose: "agent",
      timeoutMs: 200,
    });
    expect(result.status).toBe("timed_out");
    await Bun.sleep(1_500);
    expect(existsSync(join(workspace, "late.txt"))).toBeFalse();
  });
});
