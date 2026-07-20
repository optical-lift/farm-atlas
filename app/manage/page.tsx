import Link from "next/link";

import type { ManagerAction } from "@/lib/atlas-data/manager-dashboard";
import { getManagerDashboard } from "@/lib/atlas-data/manager-dashboard";
import { requireAtlasRole } from "@/lib/atlas/role-access";
import styles from "./manage.module.css";

export const dynamic = "force-dynamic";

function prettyDate(dateIso: string | null) {
  if (!dateIso) return "No due date";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function QueueSection({
  title,
  tasks,
  empty,
  warning = false,
}: {
  title: string;
  tasks: ManagerAction[];
  empty: string;
  warning?: boolean;
}) {
  const visibleTasks = tasks.slice(0, 18);

  return (
    <section className={`${styles.section} ${warning ? styles.warning : ""}`}>
      <div className={styles.sectionHeader}>
        <h2>{title}</h2>
        <span>{tasks.length}</span>
      </div>
      <div className={styles.list}>
        {visibleTasks.length ? (
          visibleTasks.map((task) => (
            <article className={styles.card} key={task.id ?? `${task.title}-${task.dueDate ?? "none"}`}>
              <strong>{task.title}</strong>
              <time>{prettyDate(task.dueDate)}</time>
              <span>{task.taskType.replaceAll("_", " ")}</span>
              {task.blocker || task.detail ? <p>{task.blocker ?? task.detail}</p> : null}
            </article>
          ))
        ) : (
          <p className={styles.empty}>{empty}</p>
        )}
      </div>
    </section>
  );
}

export default async function ManagerHomePage() {
  const access = await requireAtlasRole(["owner", "manager"]);
  const dashboard = await getManagerDashboard(access);

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="manager-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Farm management</p>
            <h1 id="manager-title">{dashboard.farm.name}</h1>
            <p className={styles.identity}>{access.session.displayName}</p>
          </div>
          <Link className={styles.back} href="/">
            Farms
          </Link>
        </header>

        <section className={styles.stats} aria-label="Management queue summary">
          <article><strong>{dashboard.counts.open}</strong><span>open</span></article>
          <article><strong>{dashboard.counts.blocked}</strong><span>blocked</span></article>
          <article><strong>{dashboard.counts.today}</strong><span>due today</span></article>
          <article><strong>{dashboard.counts.unassignedWorker}</strong><span>need assignment</span></article>
        </section>

        <QueueSection
          title="Blocked Work"
          tasks={dashboard.blocked}
          empty="No blocked management or worker tasks."
          warning
        />
        <QueueSection
          title="Overdue"
          tasks={dashboard.overdue}
          empty="No overdue management or worker tasks."
        />
        <QueueSection
          title="Due Today"
          tasks={dashboard.today}
          empty="No management or worker tasks due today."
        />
        <QueueSection
          title="Worker Work Needing Assignment"
          tasks={dashboard.unassignedWorker}
          empty="No worker work is waiting for assignment."
        />
        <QueueSection
          title="Management Queue"
          tasks={dashboard.managementQueue}
          empty="No management tasks are open."
        />
      </section>
    </main>
  );
}
