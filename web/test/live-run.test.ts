import { INITIAL_LIVE_RUN, reduceLiveRun } from "../src/data/live-run";
import { VERIFIED_RUN } from "./fixtures/events";

const replay = (events = VERIFIED_RUN) => events.reduce(reduceLiveRun, INITIAL_LIVE_RUN);

describe("reduceLiveRun", () => {
  it("folds a recorded run into the state the run page shows", () => {
    const state = replay();
    expect(state.run.status).toBe("verified");
    expect(state.run.steps).toHaveLength(4);
    expect(state.run.steps.every((step) => step.outcome?.ok === true)).toBe(true);
    expect(state.budgets).toEqual({ maxSteps: 80, maxMinutes: 20, maxModelCalls: 50 });
    expect(state.modelCalls).toBe(5);
    expect(state.run.modelErrors).toHaveLength(1);
    expect(state.finishedAt).not.toBeNull();
  });

  it("keeps command output from the step's tool_result", () => {
    expect(replay().stepOutputs[4]).toEqual({ exitCode: 0, durationMs: 7400, output: "12 pass\n0 fail", truncated: false });
  });

  it("records a tool_result with no open step as a rejection, not a step", () => {
    expect(replay().run.rejections).toEqual([{ action: "finish", error: "Run the final checks first." }]);
  });

  it("ignores events it has already applied, so a resumed stream can overlap safely", () => {
    const once = replay();
    const twice = [...VERIFIED_RUN, ...VERIFIED_RUN.slice(5)].reduce(reduceLiveRun, INITIAL_LIVE_RUN);
    expect(twice).toEqual(once);
  });

  it("shows a step as in progress until its result arrives", () => {
    const state = replay(VERIFIED_RUN.slice(0, 13));
    expect(state.run.steps.at(-1)?.step).toBe(4);
    expect(state.run.steps.at(-1)?.outcome).toBeUndefined();
    expect(state.stepStartedAt[4]).toBe(VERIFIED_RUN[12]?.timestamp);
  });
});
