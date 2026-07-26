import styles from "./day-trail-summary.module.css";

type DayTrailSummaryProps = {
  completed: number;
  total: number;
  blocked: number;
  loading?: boolean;
};

function progressPercent(completed: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

export default function DayTrailSummary({ completed, total, blocked, loading = false }: DayTrailSummaryProps) {
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.max(0, Math.min(completed, safeTotal));
  const remaining = Math.max(0, safeTotal - safeCompleted);
  const percent = progressPercent(safeCompleted, safeTotal);
  const valueText = loading
    ? "Loading day progress"
    : safeTotal
      ? `${safeCompleted} of ${safeTotal} finished`
      : "No work planned";

  return (
    <section className={styles.card} aria-label="Today’s Trail">
      <header>
        <span>Today’s Trail</span>
        <strong>{valueText}</strong>
      </header>

      <div
        className={styles.rail}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeTotal || 1}
        aria-valuenow={safeCompleted}
        aria-valuetext={valueText}
      >
        <span className={styles.fill} style={{ width: `${percent}%` }} />
      </div>

      <footer>
        <span>{loading ? "Reading exact-date work" : safeTotal ? `${remaining} remaining` : "The day is clear"}</span>
        {!loading && blocked > 0 ? (
          <span className={styles.blocked}><i aria-hidden="true" />{blocked} blocked</span>
        ) : !loading && safeTotal > 0 ? (
          <span>Path clear</span>
        ) : null}
      </footer>
    </section>
  );
}
