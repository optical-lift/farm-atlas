import type { ReactNode } from "react";

import styles from "./dominion-card-frame.module.css";

type DominionCardFrameProps = {
  family: string;
  title: string;
  subtitle?: string;
  familyDetail?: string;
  timing?: string;
  children: ReactNode;
  className?: string;
};

export default function DominionCardFrame({
  family,
  title,
  subtitle,
  familyDetail,
  timing,
  children,
  className,
}: DominionCardFrameProps) {
  const cardClassName = className ? `${styles.card} ${className}` : styles.card;

  return (
    <article className={cardClassName}>
      <header className={styles.header}>
        <div className={styles.familyRow}>
          <span>{family}</span>
          {familyDetail ? <small>{familyDetail}</small> : null}
        </div>
        <h2>{title}</h2>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        {timing ? <div className={styles.timing}>{timing}</div> : null}
      </header>

      {children}

      <footer className={styles.finish}>
        <button type="button" className={styles.primaryFinish}>Done</button>
        <button type="button" className={styles.secondaryFinish}>Unfinished</button>
      </footer>
    </article>
  );
}
