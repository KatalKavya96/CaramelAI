import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const html = readFileSync("index.html", "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error("The before-paint theme script is missing.");
function openPage(type: string, saved: string | null, blocked = false) {
  const document = { documentElement: { dataset: { theme: "light" } } };
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
  it("starts fresh openings light even if the previous tab was dark", () => {
    expect(openPage("navigate", null)).toBe("light");
    expect(openPage("navigate", "dark")).toBe("light");
    expect(openPage("back_forward", "dark")).toBe("light");
  });
  it("preserves the current tab choice on refresh", () => {
    expect(openPage("reload", "light")).toBe("light");
    expect(openPage("reload", "dark")).toBe("dark");
  });
  it("stays light when storage is blocked or has no choice", () => {
    expect(openPage("reload", null)).toBe("light");
    expect(openPage("reload", "dark", true)).toBe("light");
  });
});
