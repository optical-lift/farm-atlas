"use client";

import type { ReactNode } from "react";

import styles from "@/components/atlas/inline-issue-drawer.module.css";

type Props = {
  triggerLabel: string;
  children: ReactNode;
};

export default function InlineIssueDrawer({ triggerLabel, children }: Props) {
  return (
    <details className={styles.drawer}>
      <summary className={styles.trigger} aria-label={triggerLabel}>
        <span aria-hidden="true">+</span>
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}