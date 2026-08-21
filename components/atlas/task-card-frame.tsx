import type { ReactNode } from "react";

import styles from "./task-card-frame.module.css";

export type AtlasTaskCardFrameProps = {
  family: string;
  title: string;
  subtitle?: string;
  familyDetail?: string;
  timing?: string;
  children: ReactNode;
  className?: string;
  completion?: ReactNode | false;
};

export default function AtlasTaskCardFrame({
  family,
  title,
  subtitle,
  familyDetail,
  timing,
  children,
  className,
  completion,
}: AtlasTaskCardFrameProps) {
  const cardClassName = className ? `${styles.card} ${className}` : styles.card;

  return (
    <article className={cardClassName} data-atlas-task-card-frame="true">
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
