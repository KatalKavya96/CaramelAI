import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type SettingsTab = "general" | "providers" | "account";

interface UiStateValue {
  settingsTab: SettingsTab | null;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
}

const UiStateContext = createContext<UiStateValue | null>(null);

/** App-wide overlays (settings, search) that any screen can open. */
export function UiStateProvider({ children }: { children: ReactNode }) {
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const value = useMemo(
    () => ({
      settingsTab,
      openSettings: (tab: SettingsTab = "general") => setSettingsTab(tab),
      closeSettings: () => setSettingsTab(null),
      searchOpen,
      setSearchOpen,
    }),
    [settingsTab, searchOpen],
  );
  return <UiStateContext.Provider value={value}>{children}</UiStateContext.Provider>;
}

export function useUiState(): UiStateValue {
  const value = useContext(UiStateContext);
  if (value === null) throw new Error("useUiState needs a UiStateProvider.");
  return value;
}
