import type { MowingCardViewModel } from "@/lib/atlas/mowing-card-view-model";

import styles from "./mowing-task-card-body.module.css";

function dateLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function MowingTaskCardBody({ card }: { card: MowingCardViewModel }) {
  const last = dateLabel(card.recurrence.last);
  const current = dateLabel(card.recurrence.current);
  const next = dateLabel(card.recurrence.next);

  return (
    <>
      <div className={styles.trail} data-has-next={next ? "true" : "false"} aria-label={`${card.route} mowing recurrence`}>
        <span className={styles.done}><b>Mowed</b><small>{last || "Not recorded"}</small></span>
        <span className={styles.now}><b>Mow</b><small>{current || "Current"}</small></span>
        {next ? <span className={styles.next}><b>Next mow</b><small>{next}</small></span> : null}
      </div>

      <section className={styles.height}>
        <span>Mow height</span>
        <strong>{card.height.label}</strong>
      </section>

      {card.equipment.label ? (
        <section className={styles.tools}>
          <header><span>Equipment</span></header>
          <div className={styles.toolRow}><strong>{card.equipment.label}</strong></div>
        </section>
      ) : null}
    </>
  );
}
