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
  completion?: ReactNode | false;
};

export default function DominionCardFrame({
  family,
  title,
  subtitle,
  familyDetail,
  timing,
  children,
  className,
  completion,
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

      {completion === false ? null : completion !== undefined ? (
        <footer className={styles.customFinish}>{completion}</footer>
      ) : (
        <footer className={styles.finish}>
          <button type="button" className={styles.primaryFinish}>Done</button>
          <button type="button" className={styles.secondaryFinish}>Unfinished</button>
        </footer>
      )}
    </article>
  );
}
