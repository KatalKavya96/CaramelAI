import { fireEvent, render, screen } from "@testing-library/react";
import { Navbar } from "../src/navigation/Navbar";

beforeEach(() => {
  window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

describe("Card navigation", () => {
  it("opens the cards and closes after choosing a link", () => {
    render(<Navbar theme="dark" toggleTheme={() => {}} />);
    expect(screen.queryByRole("link", { name: "Product preview" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Product preview" })).toHaveAttribute("href", "#product");
    fireEvent.click(screen.getByRole("link", { name: "How it works" }));
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
  });
  it("dismisses with Escape and returns focus to the menu", () => {
    render(<Navbar theme="light" toggleTheme={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Menu" })).toHaveFocus();
    expect(screen.queryByRole("link", { name: "Documentation" })).not.toBeInTheDocument();
  });
  it("dismisses on an outside pointer press", () => {
    render(<Navbar theme="dark" toggleTheme={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
  });
});
