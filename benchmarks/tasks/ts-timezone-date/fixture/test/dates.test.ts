import { expect, test } from "bun:test";
import { formatDueDate } from "../src/dates";
import { reminderLine } from "../src/reminder";

test("formats a due date", () => {
  expect(formatDueDate("2025-03-03")).toBe("Mon 3 Mar");
  expect(formatDueDate("2024-12-31")).toBe("Tue 31 Dec");
});

test("writes the reminder line", () => {
  expect(reminderLine({ title: "File VAT return", due: "2025-03-03" })).toBe('Reminder: "File VAT return" is due Mon 3 Mar');
});
