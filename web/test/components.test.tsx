import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BudgetMeters, OutcomeCard, ProviderKeyForm, StepTimeline } from "../src/domain";
import { INITIAL_LIVE_RUN, reduceLiveRun } from "../src/data/live-run";
import { VERIFIED_RUN } from "./fixtures/events";

describe("StepTimeline", () => {
  it("renders recorded steps with outcomes and command output on demand", async () => {
    const state = VERIFIED_RUN.reduce(reduceLiveRun, INITIAL_LIVE_RUN);
    render(<StepTimeline steps={state.run.steps} outputs={state.stepOutputs} rejections={state.run.rejections} live={false} />);
    const list = screen.getByRole("list", { name: "Steps" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getAllByRole("img", { name: "Succeeded" })).toHaveLength(4);
    const toggle = screen.getByRole("button", { name: /Output · exit 0/ });
    expect(screen.queryByText(/12 pass/)).toBeNull();
    await userEvent.click(toggle);
    expect(screen.getByText(/12 pass/)).toBeInTheDocument();
    expect(screen.getByText(/1 action the harness rejected/)).toBeInTheDocument();
  });

  it("shows an unfinished step as running while live and as interrupted after", () => {
    const state = VERIFIED_RUN.slice(0, 13).reduce(reduceLiveRun, INITIAL_LIVE_RUN);
    const { rerender } = render(<StepTimeline steps={state.run.steps} live now={Date.parse("2026-10-22T10:00:20Z")} startedAt={state.stepStartedAt} />);
    expect(screen.getByRole("img", { name: "Running" })).toBeInTheDocument();
    expect(screen.getByText("00:08")).toBeInTheDocument();
    rerender(<StepTimeline steps={state.run.steps} live={false} />);
    expect(screen.getByRole("img", { name: "Did not finish" })).toBeInTheDocument();
  });
});

describe("OutcomeCard", () => {
  it("explains a partial run and its reason", () => {
    render(<OutcomeCard status="partial" summary="Fixed parser" terminationReason="Tests failed on the final code." changedFileCount={1} />);
    expect(screen.getByRole("heading", { name: "Partial" })).toBeInTheDocument();
    expect(screen.getByText("Tests failed on the final code.")).toBeInTheDocument();
    expect(screen.getByText("1 file changed")).toBeInTheDocument();
  });
});

describe("BudgetMeters", () => {
  it("shows each budget as used / max", () => {
    render(<BudgetMeters use={{ steps: 12, maxSteps: 80, elapsedMs: 90_000, maxMinutes: 20, modelCalls: 40, maxModelCalls: 50 }} />);
    expect(screen.getByText("12 / 80")).toBeInTheDocument();
    expect(screen.getByText("1m 30s / 20m")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Model calls used" })).toHaveAttribute("aria-valuenow", "40");
  });
});

describe("ProviderKeyForm", () => {
  const view = { provider: "openrouter" as const, last4: "9f2c", verified: true, defaultModel: "anthropic/claude", updatedAt: null };
  it("never shows the saved key, only its last four", () => {
    render(<ProviderKeyForm view={view} busy={null} onSave={vi.fn()} onTest={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("9f2c")).toBeInTheDocument();
    expect(screen.getByLabelText("Replace key")).toHaveValue("");
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });
  it("saves a pasted key and explains a failed test", async () => {
    const onSave = vi.fn();
    render(<ProviderKeyForm view={{ ...view, last4: null, verified: false }} busy={null} lastTest={{ ok: false, error: "no_credit", message: "" }} onSave={onSave} onTest={vi.fn()} onDelete={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("API key"), "  sk-or-123  ");
    await userEvent.click(screen.getByRole("button", { name: "Save and test" }));
    expect(onSave).toHaveBeenCalledWith("sk-or-123");
    expect(screen.getByRole("status")).toHaveTextContent(/no credit/);
  });
});
