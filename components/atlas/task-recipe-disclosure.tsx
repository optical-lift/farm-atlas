import type { ReactNode } from "react";

import styles from "./task-recipe-disclosure.module.css";

export default function TaskRecipeDisclosure({ children, label = "Recipe" }: { children: ReactNode; label?: string }) {
  return (
    <details className={styles.recipe}>
      <summary>{label}</summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}
