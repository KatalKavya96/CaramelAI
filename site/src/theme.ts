import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "caramel-site-theme";

function current(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** A fresh page opening is light; only refreshes retain this tab's selected theme. */
export function useThemeToggle(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(current);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    try {
      sessionStorage.setItem(KEY, next);
    } catch {
      // Storage can be blocked in private windows; the choice then lasts for this visit.
    }
    setTheme(next);
  };
  return [theme, toggle];
}
