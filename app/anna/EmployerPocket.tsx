"use client";

import { useState } from "react";

import styles from "./employee-surface.module.css";

export type EmployerPocketItem = {
  label: string;
  title: string;
  detail: string;
};

export default function EmployerPocket({ items }: { items: EmployerPocketItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`${styles.pocketViewport}${open ? ` ${styles.pocketViewportOpen}` : ""}`}>
      <section className={styles.pocketSheet} aria-label="From Elm">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="elm-employer-pocket"
          onClick={() => setOpen((current) => !current)}
          className={styles.pocketToggle}
        >
          <span className={styles.pocketHandle} aria-hidden="true" />
          <span className={styles.pocketHeading}>
            <span className={styles.pocketLabel}>From Elm</span>
            <span className={styles.pocketCount}>{items.length}</span>
          </span>
        </button>

        <div id="elm-employer-pocket" className={styles.pocketBody}>
          <div className={styles.pocketRows}>
            {items.map((item) => (
              <article key={`${item.label}-${item.title}`} className={styles.pocketRow}>
                <div className={styles.pocketRowLabel}>{item.label}</div>
                <div className={styles.pocketRowTitle}>{item.title}</div>
                <div className={styles.pocketRowDetail}>{item.detail}</div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
