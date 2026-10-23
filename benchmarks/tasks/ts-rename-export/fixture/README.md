# waitkit

Timeouts and retries configured with human durations.

```ts
import { parseDurration, withTimeout, retry } from "waitkit";

parseDurration("1h30m"); // 5400000
parseDurration("250ms"); // 250

await withTimeout(fetch(url), "10s");
await retry(() => flakyCall(), { attempts: 3, delay: "500ms" });
```

From the shell:

```sh
bun run src/cli.ts 1h30m   # prints 5400000
```

## API

- `parseDurration(text)`: milliseconds for a duration such as `"2m"`, `"1h30m"`, `"1.5s"` or `"250ms"`.
  Throws a `RangeError` for anything else.
- `withTimeout(promise, duration)`: rejects with `TimeoutError` if the promise takes longer.
- `retry(fn, { attempts, delay })`: calls `fn` until it resolves, waiting `delay` between attempts.
