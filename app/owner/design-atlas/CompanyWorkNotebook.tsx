import type {
  CompanyWorkManagementPosition,
  CompanyWorkRow,
  CompanyWorkSummary,
} from "@/lib/atlas/company-work";

import styles from "./company-work-notebook.module.css";

type CompanyWorkNotebookProps = {
  organizationName: string;
  rows: CompanyWorkRow[];
  summary: CompanyWorkSummary;
  membershipLabels?: Record<string, string>;
  fixtureLabel?: string;
};

type PositionSpec = {
  key: CompanyWorkManagementPosition;
  label: string;
  mark: string;
  explanation: string;
};

const POSITIONS: PositionSpec[] = [
  {
    key: "planning_conflict",
    label: "Needs reconciliation",
    mark: "!",
    explanation: "The obligation is real, but Atlas cannot currently reconcile it with the available plan.",
  },
  {
    key: "unassigned",
    label: "Unassigned",
    mark: "?",
    explanation: "The company owns this work. No responsible custody has been allocated yet.",
  },
  {
    key: "waiting_dependency",
    label: "Waiting",
    mark: ">",
    explanation: "Responsibility exists, but another open piece of work must become true first.",
  },
  {
    key: "allocated",
    label: "Allocated",
    mark: "○",
    explanation: "A person or institutional seat currently holds responsibility for this open work.",
  },
];

function humanDuration(minutes: number | null) {
  if (minutes === null) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function humanBoundary(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  }).format(date);
}

function rowMeta(row: CompanyWorkRow, membershipLabels?: Record<string, string>) {
  const bits: string[] = [];
  const assignee = row.assignee_membership_id
    ? membershipLabels?.[row.assignee_membership_id] ?? "allocated"
    : null;
  if (assignee) bits.push(assignee);

  const duration = humanDuration(row.expected_duration_minutes);
  if (duration) bits.push(duration);

  const boundary = humanBoundary(row.hard_finish_at);
  if (boundary) bits.push(`hard edge ${boundary}`);

  if (row.unresolved_dependency_count > 0) {
    bits.push(`${row.unresolved_dependency_count} unresolved ${row.unresolved_dependency_count === 1 ? "dependency" : "dependencies"}`);
  }

  return bits;
}

function WorkLine({
  row,
  membershipLabels,
  mark,
}: {
  row: CompanyWorkRow;
  membershipLabels?: Record<string, string>;
  mark: string;
}) {
  const meta = rowMeta(row, membershipLabels);

  return (
    <article className={styles.workLine} data-position={row.management_position}>
      <span className={styles.mark} aria-hidden="true">{mark}</span>
      <div className={styles.claim}>
        <strong>{row.title}</strong>
        {row.instructions ? <p>{row.instructions}</p> : null}
        {meta.length ? <small>{meta.join(" · ")}</small> : null}
        {row.open_planning_conflict_reason ? (
          <small className={styles.conflictReason}>{row.open_planning_conflict_reason}</small>
        ) : null}
      </div>
    </article>
  );
}

export default function CompanyWorkNotebook({
  organizationName,
  rows,
  summary,
  membershipLabels,
  fixtureLabel,
}: CompanyWorkNotebookProps) {
  const openRows = rows.filter((row) => row.work_state === "open");

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>COMPANY WORK</span>
          <h1>{organizationName}</h1>
          <p>What this company currently needs done.</p>
        </div>
        <div className={styles.total} aria-label={`${summary.totalOpen} open work items`}>
          <strong>{summary.totalOpen}</strong>
          <span>open</span>
        </div>
      </header>

      {fixtureLabel ? <p className={styles.fixture}>{fixtureLabel}</p> : null}

      <section className={styles.accounting} aria-label="Company Work accounting">
        <span><b>{summary.planningConflict}</b> conflict</span>
        <span><b>{summary.unassigned}</b> unassigned</span>
        <span><b>{summary.waitingDependency}</b> waiting</span>
        <span><b>{summary.allocated}</b> allocated</span>
      </section>

      <div className={styles.rule} />

      {POSITIONS.map((position) => {
        const positionRows = openRows.filter((row) => row.management_position === position.key);
        if (!positionRows.length) return null;

        return (
          <section className={styles.section} key={position.key}>
            <header className={styles.sectionHeader}>
              <div>
                <span>{position.mark}</span>
                <h2>{position.label}</h2>
              </div>
              <strong>{positionRows.length}</strong>
            </header>
            <p className={styles.explanation}>{position.explanation}</p>
            <div className={styles.lines}>
              {positionRows.map((row) => (
                <WorkLine
                  key={row.work_item_id}
                  row={row}
                  mark={position.mark}
                  membershipLabels={membershipLabels}
                />
              ))}
            </div>
          </section>
        );
      })}

      {!openRows.length ? (
        <section className={styles.empty}>
          <span>○</span>
          <p>No open company work is represented.</p>
        </section>
      ) : null}

      <footer className={styles.footer}>
        <p><strong>Company Work proves existence.</strong> Allocation, readiness, Day, Clock, and attention may change what a person sees next; they may not erase this ledger.</p>
      </footer>
    </main>
  );
}
