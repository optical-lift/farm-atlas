import styles from "./atlas-product-reset.module.css";

export default function AtlasProductReset() {
  return (
    <main className={styles.page} data-atlas-product-reset="true">
      <section className={styles.sheet}>
        <p className={styles.mark}>ATLAS</p>
        <h1>Start here.</h1>
        <p className={styles.statement}>
          The previous product surface has been decommissioned. Existing Atlas data and system history remain preserved underneath.
        </p>
        <p className={styles.note}>
          No navigation model is being assumed. The product will be rebuilt from first principles.
        </p>
      </section>
    </main>
  );
}
