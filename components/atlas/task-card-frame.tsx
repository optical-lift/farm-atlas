import type { ReactNode } from "react";

import styles from "./task-card-frame.module.css";

type AtlasTaskCardFrameBaseProps = {
  family: string;
  title: string;
  subtitle?: string;
  familyDetail?: string;
  timing?: string;
  children: ReactNode;
  className?: string;
};

type InteractiveCompletionProps = {
  completion?: never;
  completionPreview?: never;
  onDone: () => void;
  onUnfinished: () => void;
  completionDisabled?: boolean;
};

type CustomCompletionProps = {
  completion: Exclude<ReactNode, undefined>;
  completionPreview?: never;
  onDone?: never;
  onUnfinished?: never;
  completionDisabled?: never;
};

type PreviewCompletionProps = {
  completion?: never;
  completionPreview: true;
  onDone?: never;
  onUnfinished?: never;
  completionDisabled?: never;
};

export type AtlasTaskCardFrameProps = AtlasTaskCardFrameBaseProps & (
  | InteractiveCompletionProps
  | CustomCompletionProps
  | PreviewCompletionProps
);

export default function AtlasTaskCardFrame(props: AtlasTaskCardFrameProps) {
  const {
    family,
    title,
    subtitle,
    familyDetail,
    timing,
    children,
    className,
  } = props;
  const cardClassName = className ? `${styles.card} ${className}` : styles.card;
  const previewCompletion = props.completionPreview === true;

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

      {previewCompletion ? (
        <footer className={styles.finish} data-atlas-completion-preview="true">
          <button type="button" className={styles.primaryFinish} disabled>Done</button>
          <button type="button" className={styles.secondaryFinish} disabled>Unfinished</button>
        </footer>
      ) : props.completion === false ? null : props.completion !== undefined ? (
        <footer className={styles.customFinish}>{props.completion}</footer>
      ) : (
        <footer className={styles.finish}>
          <button type="button" className={styles.primaryFinish} disabled={props.completionDisabled} onClick={props.onDone}>Done</button>
          <button type="button" className={styles.secondaryFinish} disabled={props.completionDisabled} onClick={props.onUnfinished}>Unfinished</button>
        </footer>
      )}
    </article>
  );
}
