import type { ComponentType, ReactNode } from "react";
export interface CardNavItem {
  label: string;
  description?: string;
  links: { label: string; href: string; ariaLabel?: string }[];
}
declare const CardNav: ComponentType<{
  ariaLabel?: string;
  className?: string;
  logo: ReactNode;
  logoAlt: string;
  logoHref: string;
  items: CardNavItem[];
  cta?: { label: string; href: string };
  theme: "light" | "dark";
  surface?: "glass" | "solid";
  openOn?: "click" | "hover";
  cardEffect?: "rise" | "unfold" | "fade";
  cardHeight?: number;
  maxWidth?: number;
  reducedMotion?: boolean;
  onLinkClick?: (link: CardNavItem["links"][number], item: CardNavItem, event: import("react").MouseEvent) => void;
}>;
export default CardNav;
