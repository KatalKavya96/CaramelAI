import { fireEvent, render, screen, within } from "@testing-library/react";
import { Landing } from "../src/Landing";
import { ProductPreview } from "../src/ProductPreview";

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  document.documentElement.dataset.theme = "light";
  window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

afterEach(() => vi.unstubAllGlobals());

describe("Landing interactions", () => {
  it("persists a theme change and restores the toggle label", () => {
    render(<Landing />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(sessionStorage.getItem("caramel-site-theme")).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(sessionStorage.getItem("caramel-site-theme")).toBe("light");
  });

  it("switches preview panels with pointer and keyboard navigation", () => {
    render(<ProductPreview />);
    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    expect(within(screen.getByRole("tabpanel")).getByText("Exit code 0", { exact: false })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Terminal" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Checks 12" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tabpanel")).getByText("Checks on the final patch")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Checks 12" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "Diff" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Diff" })).toHaveAttribute("aria-selected", "true");
  });

  it("downloads an actual illustrative patch rather than linking to a missing release", () => {
    render(<ProductPreview />);
    const link = screen.getByRole("link", { name: "Download example patch" });
    expect(link).toHaveAttribute("download", "caramel-example.patch");
    const href = link.getAttribute("href") ?? "";
    expect(decodeURIComponent(href)).toContain("+export const DEFAULT_SESSION_TIMEOUT = 30 * 60 * 1000;");
  });
});
