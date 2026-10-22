import type { ReactNode } from "react";
import { LogoMark } from "../ui";
import styles from "./Hero.module.css";

/** Centred mark, headline and subtitle from the home mockup. */
export function Hero({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.hero}>
      <LogoMark size={66} />
      <h1 className={styles.title}>{title}</h1>
      {subtitle === undefined ? null : <p className={styles.subtitle}>{subtitle}</p>}
      {children}
    </div>
  );
}
