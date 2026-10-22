import { useEffect, useState } from "react";
export interface Appearance { motion: boolean; transparency: boolean; contrast: boolean }
const defaults: Appearance = { motion:false, transparency:false, contrast:false };
export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem("caramel-site-appearance") ?? "{}");
      return { motion:value.motion === true, transparency:value.transparency === true, contrast:value.contrast === true };
    } catch { return defaults; }
  });
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.motion = appearance.motion ? "reduced" : "full";
    root.dataset.transparency = appearance.transparency ? "reduced" : "full";
    root.dataset.contrast = appearance.contrast ? "more" : "normal";
    try { sessionStorage.setItem("caramel-site-appearance", JSON.stringify(appearance)); } catch { /* Visit-local fallback. */ }
  }, [appearance]);
  const toggleAppearance = (key: keyof Appearance) => setAppearance(value => ({...value,[key]:!value[key]}));
  return { appearance, toggleAppearance };
}
