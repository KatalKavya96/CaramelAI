import { describe, expect, test } from "bun:test";
import { box, createTuiEventRenderer, renderSelectMenu, renderSplash } from "../src/tui";

describe("terminal UI rendering", () => {
  test("renders splash and boxed panels", () => {
    expect(renderSplash({ color: false })).toContain("Caramel AI Coding Harness");
    expect(box("Setup", ["Provider: deepseek"], { color: false })).toContain("Provider: deepseek");
  });


  test("renders arrow-key selection menus", () => {
    const menu = renderSelectMenu("Repository", [
      { label: "/repo/one", value: "/repo/one" },
      { label: "/repo/two", value: "/repo/two", hint: "current repo" },
    ], 1, { color: false });

    expect(menu).toContain("Use ↑/↓ and Enter to select");
    expect(menu).toContain("› /repo/two  current repo");
  });

  test("renders live model decisions without raw payload dumps", () => {
    const output: string[] = [];
    const render = createTuiEventRenderer((message) => output.push(message), { color: false });
    render({
      schemaVersion: 1,
      sequence: 2,
      timestamp: new Date(0).toISOString(),
      type: "model_decision",
      payload: { intent: "Edit members filter", action: { type: "replace_text", path: "a.ts", search: "x", replacement: "y" } },
    });

    expect(output.join("\n")).toContain("thinking: Edit members filter");
    expect(output.join("\n")).toContain("action: replace_text");
  });
});
