import Link from "next/link";
import { notFound } from "next/navigation";

import { getOwnerTaskDetail } from "@/lib/atlas-data/owner-task-detail";
import { requireAtlasRole } from "@/lib/atlas/role-access";
import OwnerTaskActions from "./OwnerTaskActions";
import styles from "./task.module.css";

export const dynamic = "force-dynamic";

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "No due date";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export default async function OwnerTaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const access = await requireAtlasRole(["owner"]);
  const detail = await getOwnerTaskDetail(access, taskId);
  if (!detail) notFound();

  const { task, children } = detail;
  const taskText = task.note || task.unlock_text;

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="owner-task-title">
        <header className={styles.top}>
          <Link className={styles.back} href="/owner">
            ← Owner work
          </Link>
          <span className={styles.role}>Owner</span>
        </header>

        <section className={styles.hero}>
          <p className={styles.eyebrow}>{task.task_type.replaceAll("_", " ")}</p>
          <h1 id="owner-task-title">{task.title}</h1>
          <div className={styles.meta}>
            <span>{statusLabel(task.status)}</span>
            <span>{task.priority} priority</span>
            <span>{prettyDate(task.due_date)}</span>
          </div>
        </section>

        {taskText ? (
          <section className={styles.card}>
            <h2>Task details</h2>
            <p>{taskText}</p>
          </section>
        ) : null}

        {task.blocker_text ? (
          <section className={`${styles.card} ${styles.blocker}`}>
            <h2>Current blocker</h2>
            <p>{task.blocker_text}</p>
          </section>
        ) : null}

        {children.length ? (
          <section className={styles.card}>
            <h2>Checklist</h2>
            <ul className={styles.steps}>
              {children.map((child) => (
                <li key={child.id}>
                  <b>{child.status === "done" ? "✓" : "○"}</b>
                  <span>{child.title}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <OwnerTaskActions taskId={task.id} status={task.status} />
      </section>
    </main>
  );
}
