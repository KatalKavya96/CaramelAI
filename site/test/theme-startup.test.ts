import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const html = readFileSync("index.html", "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error("The before-paint theme script is missing.");
function openPage(type: string, saved: string | null, blocked = false) {
  const document = { documentElement: { dataset: { theme: "dark" } } };
  const storage = new Map(saved ? [["caramel-site-theme", saved]] : []);
  runInNewContext(script as string, {
    document,
    performance: { getEntriesByType: () => [{ type }] },
    sessionStorage: {
      getItem: (key: string) => { if (blocked) throw new Error("Blocked"); return storage.get(key) ?? null; },
      setItem: (key: string, value: string) => { if (blocked) throw new Error("Blocked"); storage.set(key, value); },
    },
  });
  return document.documentElement.dataset.theme;
}
describe("Landing page theme on opening", () => {
  it("starts fresh openings dark even if the previous tab was light", () => {
    expect(openPage("navigate", null)).toBe("dark");
    expect(openPage("navigate", "light")).toBe("dark");
    expect(openPage("back_forward", "light")).toBe("dark");
  });
  it("preserves the current tab choice on refresh", () => {
    expect(openPage("reload", "light")).toBe("light");
    expect(openPage("reload", "dark")).toBe("dark");
  });
  it("stays dark when storage is blocked or has no choice", () => {
    expect(openPage("reload", null)).toBe("dark");
    expect(openPage("reload", "light", true)).toBe("dark");
  });
});
