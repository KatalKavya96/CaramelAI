import { expect, test } from "bun:test";
import { slugify } from "../src";

test("lowercases and joins words", () => expect(slugify("Hello, World!")).toBe("hello-world"));
test("strips accents", () => expect(slugify("Crème Brûlée")).toBe("creme-brulee"));
test("custom separator", () => expect(slugify("a b c", { separator: "_" })).toBe("a_b_c"));
test("maxLength keeps whole words", () => expect(slugify("one two three", { maxLength: 9 })).toBe("one-two"));
