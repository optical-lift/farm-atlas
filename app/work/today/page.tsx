import Link from "next/link";

import type { WorkerHandTask } from "@/lib/atlas-data/worker-hand";
import { getWorkerHand } from "@/lib/atlas-data/worker-hand";
import { requireAtlasRole } from "@/lib/atlas/role-access";
import WorkerTaskActions from "./WorkerTaskActions";
import styles from "./work.module.css";

export const dynamic = "force-dynamic";

function prettyDate(dateIso: string | null) {
  if (!dateIso) return "No due date";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function WorkerTaskCard({ task }: { task: WorkerHandTask }) {
  return (
    <article className={`${styles.task} ${task.lane === "blocked" ? styles.blocked : ""}`}>
      <div className={styles.taskTop}>
        <h3>{task.title}</h3>
        <span className={styles.date}>{prettyDate(task.dueDate)}</span>
      </div>
      {task.zoneLabel || task.zoneKey ? (
        <p className={styles.location}>{task.zoneLabel ?? task.zoneKey}</p>
      ) : null}
      {task.instruction ? <p className={styles.instruction}>{task.instruction}</p> : null}
      {task.blocker ? <p className={styles.instruction}>Blocked: {task.blocker}</p> : null}
      {task.totalSteps ? (
        <p className={styles.progress}>
          {task.completedSteps}/{task.totalSteps} checklist steps complete
        </p>
      ) : null}
      {task.canAct && task.taskId ? <WorkerTaskActions taskId={task.taskId} /> : null}
    </article>
  );
}

function WorkerSection({
  title,
  tasks,
  empty,
}: {
  title: string;
  tasks: WorkerHandTask[];
  empty: string;
}) {
  if (!tasks.length) return null;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>{title}</h2>
        <span>{tasks.length}</span>
      </div>
      <div className={styles.list}>
        {tasks.map((task) => (
          <WorkerTaskCard
            key={task.taskId ?? `${task.title}-${task.dueDate ?? "undated"}`}
            task={task}
          />
        ))}
        {!tasks.length ? <p className={styles.empty}>{empty}</p> : null}
      </div>
    </section>
  );
}

export default async function WorkerTodayPage() {
  const access = await requireAtlasRole(["owner", "manager", "farm_hand"]);
  const hand = await getWorkerHand(access);

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="worker-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{hand.farm.name} · Today</p>
            <h1 id="worker-title">{hand.worker?.displayName ?? "Farm work"}</h1>
            <p className={styles.identity}>{access.session.displayName}</p>
          </div>
          <Link className={styles.back} href="/">
            Farms
          </Link>
        </header>

        {!hand.worker ? (
          <section className={styles.emptyState}>
            <h2>No active Farm Hand membership yet</h2>
            <p>
              {hand.unassignedWorkerTaskCount
                ? `${hand.unassignedWorkerTaskCount} open worker tasks are waiting for a real farm membership before they can be shown or acted on.`
                : "There is no Farm Hand membership available for this farm."}
            </p>
            {access.membership.role === "owner" ? (
              <Link href="/owner/members">Open People &amp; Access</Link>
            ) : null}
          </section>
        ) : (
          <>
            {!hand.canAct ? (
              <p className={styles.inspect}>
                Read-only worker view. Task actions remain available only to the assigned Farm Hand.
              </p>
            ) : null}

            <section className={styles.summary} aria-label="Today work summary">
              <article><strong>{hand.counts.blocked}</strong><span>blocked</span></article>
              <article><strong>{hand.counts.overdue}</strong><span>overdue</span></article>
              <article><strong>{hand.counts.today}</strong><span>today</span></article>
              <article><strong>{hand.counts.undated}</strong><span>next</span></article>
            </section>

            {hand.counts.total ? (
              <>
                <WorkerSection title="Blocked" tasks={hand.lanes.blocked} empty="No blocked work." />
                <WorkerSection title="Overdue" tasks={hand.lanes.overdue} empty="No overdue work." />
                <WorkerSection title="Today" tasks={hand.lanes.today} empty="No work due today." />
                <WorkerSection title="Next Useful Actions" tasks={hand.lanes.undated} empty="No undated work." />
              </>
            ) : (
              <section className={styles.emptyState}>
                <h2>No work is ready</h2>
                <p>There are no assigned or farm-shared tasks due for this worker today.</p>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
