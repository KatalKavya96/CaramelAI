import styles from "./Footer.module.css";

/** The faint "—— Caramel ——" mark at the bottom of the home screen. */
export function BrandFooter() {
  return (
    <p className={styles.footer}>
      <span aria-hidden="true" className={styles.rule} />
      Caramel
      <span aria-hidden="true" className={styles.rule} />
    </p>
  );
}
