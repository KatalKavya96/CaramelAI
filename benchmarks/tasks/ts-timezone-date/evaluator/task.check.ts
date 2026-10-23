// Sends the same reminders from machines in different time zones, like the team in the README.
// A calendar date must print the same day everywhere.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.env.DINNER_WORKSPACE!;
const tasks = join(mkdtempSync(join(tmpdir(), "duebot-")), "tasks.json");
writeFileSync(tasks, JSON.stringify([
  { title: "File VAT return", due: "2025-03-03" },
  { title: "Renew domain", due: "2024-12-31" },
  { title: "Book venue", due: "2025-01-01" },
]));
const expected = [
  'Reminder: "File VAT return" is due Mon 3 Mar',
  'Reminder: "Renew domain" is due Tue 31 Dec',
  'Reminder: "Book venue" is due Wed 1 Jan',
].join("\n");

const ZONES = ["UTC", "America/Los_Angeles", "America/Sao_Paulo", "Asia/Kolkata", "Pacific/Auckland", "Pacific/Kiritimati"];

for (const zone of ZONES) {
  test(`reminders read the same in ${zone}`, () => {
    const run = Bun.spawnSync(["bun", "run", "src/cli.ts", tasks], { cwd: workspace, env: { ...process.env, TZ: zone } });
    expect(run.stdout.toString().trim()).toBe(expected);
  });
}

test("the project's own tests pass on a laptop in California, not only in CI", () => {
  const run = Bun.spawnSync(["bun", "test", "./test"], { cwd: workspace, env: { ...process.env, TZ: "America/Los_Angeles" } });
  expect(run.exitCode).toBe(0);
});
