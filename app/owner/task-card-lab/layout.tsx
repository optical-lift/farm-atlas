import type { ReactNode } from "react";

import RecoveredTaskPatterns from "./RecoveredTaskPatterns";
import styles from "./task-card-lab-layout.module.css";

export default function TaskCardLabLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <div className={styles.archiveWrap}>
        <RecoveredTaskPatterns />
      </div>
    </>
  );
}
