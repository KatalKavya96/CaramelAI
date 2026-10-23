import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hashDirectory, loadBenchmarkManifest } from "../src/benchmark";

const tasksRoot = resolve(import.meta.dir, "../benchmarks/tasks");
const readReport = async (name: string) => JSON.parse(await readFile(resolve(import.meta.dir, "../benchmarks/reports", name), "utf8"));

describe("recorded benchmark reports", () => {
  test("the latest calibration pins every current task", async () => {
    const report = await readReport("calibration-2026-10-23.json");
    const taskIds = (await readdir(tasksRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const manifests = await Promise.all(taskIds.map((id) => loadBenchmarkManifest(resolve(tasksRoot, id))));
    expect(report.taskSetSha256).toBe(await hashDirectory(tasksRoot));
    expect(report.fixtureCalibration.tasks.map(({ id }: { id: string }) => id).sort()).toEqual(taskIds);
    expect(report.taskSet).toEqual({
      total: manifests.length,
      development: manifests.filter(({ split }) => split === "development").length,
      heldOut: manifests.filter(({ split }) => split === "held_out").length,
    });
    expect(report.fixtureCalibration).toMatchObject({ attemptedEvaluations: taskIds.length * 2, mismatches: 0 });
  });

  test("the 2026-09-26 baseline stays a record of the original 8 tasks, with no agent metrics", async () => {
    const report = await readReport("baseline-2026-09-26.json");
    expect(report.taskSet).toEqual({ total: 8, development: 6, heldOut: 2 });
    expect(report.autonomousRuns).toMatchObject({ attempted: 0, solveRate: null, usage: null });
    expect(report.fixtureCalibration).toMatchObject({ attemptedEvaluations: 16, mismatches: 0 });
  });
});
