import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (value: ThemePreference) => void;
  reducedMotion: boolean;
  setReducedMotion: (value: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_KEY = "caramel-theme";
const MOTION_KEY = "caramel-reduce-motion";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage; the setting then lasts for this page only.
  }
}

/** Sets data-theme and data-motion on <html>; index.html applies the same theme before first paint. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const saved = read(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const [reducedMotion, setReducedMotion] = useState(() => read(MOTION_KEY) === "true");

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = preference === "dark" || (preference === "system" && query.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    write(THEME_KEY, preference);
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [preference]);

  useEffect(() => {
    if (reducedMotion) document.documentElement.dataset.motion = "reduced";
    else delete document.documentElement.dataset.motion;
    write(MOTION_KEY, String(reducedMotion));
  }, [reducedMotion]);

  const value = useMemo(() => ({ preference, setPreference, reducedMotion, setReducedMotion }), [preference, reducedMotion]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error("useTheme needs a ThemeProvider.");
  return value;
}
