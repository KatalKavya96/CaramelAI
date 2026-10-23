import { expect, test } from "bun:test";
import { parseDurration } from "../src";

test("parses single and compound durations", () => {
  expect(parseDurration("250ms")).toBe(250);
  expect(parseDurration("1.5s")).toBe(1500);
  expect(parseDurration("1h30m")).toBe(5_400_000);
});

test("rejects things that are not durations", () => {
  expect(() => parseDurration("soon")).toThrow(RangeError);
  expect(() => parseDurration("10")).toThrow(RangeError);
});
