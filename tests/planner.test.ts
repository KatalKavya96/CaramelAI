import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePlan, planRepositoryContext } from "../src/agent";
import {
  createOpenRouterModel,
  ModelError,
  StructuredModelAdapter,
  type ModelAdapter,
  type ModelRequest,
  type ModelTransport,
} from "../src/model";

const PLAN = {
  summary: "Add retry to the HTTP client.",
  questions: [{ question: "Where should retry live?", options: ["client.ts (recommended)", "a wrapper"], defaultIndex: 0 }],
};

class RecordingTransport implements ModelTransport {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly script: readonly (unknown | Error)[]) {}
  async send(request: ModelRequest): Promise<unknown> {
    this.requests.push(request);
    const step = this.script[this.requests.length - 1];
    if (step instanceof Error) throw step;
    return step;
  }
}

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("plan mode", () => {
  test("goes through the model adapter with the plan schema, not the action schema", async () => {
    const transport = new RecordingTransport([{ output: JSON.stringify(PLAN) }]);
    const plan = await generatePlan({ model: new StructuredModelAdapter(transport), task: "add retry", repositoryContext: {} });

    expect(plan.summary).toBe(PLAN.summary);
    expect(plan.questions[0]?.options[0]).toBe("client.ts (recommended)");
    expect(plan.skippedReason).toBeUndefined();
    const format = transport.requests[0]?.responseFormat;
    expect(format?.name).toBe("caramel_plan");
    expect(JSON.stringify(format?.schema)).toContain("questions");
  });

  test("retries a transient failure and reports why a plan was skipped", async () => {
    const flaky = new RecordingTransport([new Error("socket hang up"), { output: JSON.stringify(PLAN) }]);
    const adapter = new StructuredModelAdapter(flaky, { initialBackoffMs: 0 });
    expect((await generatePlan({ model: adapter, task: "t", repositoryContext: {} })).summary).toBe(PLAN.summary);
    expect(flaky.requests).toHaveLength(2);

    const denied: ModelAdapter = {
      complete: async () => { throw new Error("unused"); },
      completeText: async () => { throw new ModelError("authentication", "Invalid API key.", false, 1); },
    };
    const skipped = await generatePlan({ model: denied, task: "t", repositoryContext: {} });
    expect(skipped.questions).toEqual([]);
    expect(skipped.skippedReason).toBe("Invalid API key.");
  });

  test("the OpenRouter transport sends the plan schema when a request asks for it", async () => {
    let sent: any;
    const model = createOpenRouterModel({
      apiKey: "k",
      client: { chat: { async send(request) { sent = request; return { choices: [{ message: { content: JSON.stringify(PLAN) } }] }; } } },
    });
    await generatePlan({ model, task: "t", repositoryContext: {} });
    expect(sent.chatRequest.responseFormat.jsonSchema.name).toBe("caramel_plan");
  });

  test("gives the planner real repository context without leaking the local path", async () => {
    const repo = await mkdtemp(join(tmpdir(), "caramel-plan-"));
    cleanup.push(repo);
    await writeFile(join(repo, "package.json"), "{}");
    await writeFile(join(repo, "client.ts"), "export function fetchWithRetry() {}\n");
    const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: repo });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

    const context = await planRepositoryContext(repo, "add retry to client fetch") as Record<string, unknown>;
    expect(context.manifests).toEqual(["package.json"]);
    expect(JSON.stringify(context)).toContain("client.ts");
    expect(JSON.stringify(context)).not.toContain(repo);
  });
});
