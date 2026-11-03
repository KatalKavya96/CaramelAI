import { describe, expect, test } from "bun:test";
import { appendWithinLimit, isInside } from "../src/tools/file-helpers";

describe("file helpers", () => {
  test("isInside accepts the root and its children, and rejects escapes", () => {
    expect(isInside("/repo", "/repo")).toBeTrue();
    expect(isInside("/repo", "/repo/src/a.ts")).toBeTrue();
    expect(isInside("/repo", "/repo-other/a.ts")).toBeFalse();
    expect(isInside("/repo", "/etc/passwd")).toBeFalse();
  });

  test("appendWithinLimit counts bytes, not characters, and reports truncation", () => {
    expect(appendWithinLimit("ab", "cd", 10)).toEqual(["abcd", false]);
    expect(appendWithinLimit("ab", "cdef", 4)).toEqual(["abcd", true]);
    expect(appendWithinLimit("abcd", "e", 4)).toEqual(["abcd", true]);
    // "é" is two bytes in UTF-8, so only one fits after three ASCII bytes in a limit of 5.
    expect(appendWithinLimit("abc", "éé", 5)).toEqual(["abcé", true]);
  });
});
