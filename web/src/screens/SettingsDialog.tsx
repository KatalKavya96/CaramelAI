import { useLogout, useSession } from "../data";
import { TabbedDialog } from "../patterns";
import { Avatar, Button, KeyIcon, MonitorIcon, MoonIcon, SegmentedControl, SlidersIcon, SunIcon, SwitchRow, UserIcon } from "../ui";
import { useTheme, type ThemePreference } from "../app/theme";
import { useUiState, type SettingsTab } from "../app/ui-state";
import { ProviderKeys } from "./ProviderKeys";
import styles from "./screens.module.css";

/** The settings modal from the mockups, with the tabs Caramel needs: General, Model providers, Account. */
export function SettingsDialog({ login }: { login: string }) {
  const ui = useUiState();
  const theme = useTheme();
  const logout = useLogout();
  const session = useSession();
  const local = session.data?.capabilities?.mode === "local";
  return (
    <TabbedDialog
      open={ui.settingsTab !== null}
      onOpenChange={(open) => !open && ui.closeSettings()}
      title="Settings"
      active={ui.settingsTab ?? "general"}
      onActiveChange={(id) => ui.openSettings(id as SettingsTab)}
      tabs={[
        {
          id: "general",
          label: "General",
          icon: <SlidersIcon size={20} />,
          content: (
            <div className={styles.stack}>
              <div className={styles.settingRow}>
                <div>
                  <h3 className={styles.settingTitle}>Appearance</h3>
                  <p className={styles.settingHint}>System follows your device.</p>
                </div>
                <SegmentedControl<ThemePreference>
                  label="Appearance"
                  value={theme.preference}
                  onChange={theme.setPreference}
                  segments={[
                    { value: "light", label: "Light", icon: <SunIcon size={18} /> },
                    { value: "dark", label: "Dark", icon: <MoonIcon size={18} /> },
                    { value: "system", label: "System", icon: <MonitorIcon size={18} /> },
                  ]}
                />
              </div>
              <SwitchRow label="Reduce motion" description="Stops spinners and transitions from animating." checked={theme.reducedMotion} onCheckedChange={theme.setReducedMotion} />
            </div>
          ),
        },
        { id: "providers", label: "Providers", icon: <KeyIcon size={20} />, content: <ProviderKeys /> },
        {
          id: "account",
          label: "Account",
          icon: <UserIcon size={20} />,
          content: (
            <div className={styles.stack}>
              <div className={styles.account}>
                <Avatar name={login} size={48} />
                <div>
                  <strong>{login}</strong>
                  <p className={styles.settingHint}>{local ? "Caramel is running on this computer. Your keys are in the system keychain." : "Signed in with GitHub"}</p>
                </div>
              </div>
              {local ? null : (
                <div>
                  <Button variant="danger-outline" onClick={() => logout.mutate(undefined, { onSuccess: ui.closeSettings })}>Sign out</Button>
                </div>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}
