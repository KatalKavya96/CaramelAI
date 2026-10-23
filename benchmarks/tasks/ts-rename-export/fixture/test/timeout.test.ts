import { expect, test } from "bun:test";
import { retry, TimeoutError, withTimeout } from "../src";

test("withTimeout rejects slow promises", async () => {
  await expect(withTimeout(new Promise(() => {}), "20ms")).rejects.toBeInstanceOf(TimeoutError);
});

test("retry tries again after a failure", async () => {
  let calls = 0;
  const value = await retry(async () => {
    calls += 1;
    if (calls < 2) throw new Error("flaky");
    return "ok";
  }, { attempts: 3, delay: "1ms" });
  expect(value).toBe("ok");
  expect(calls).toBe(2);
});
