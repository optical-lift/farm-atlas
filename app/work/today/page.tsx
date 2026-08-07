import Link from "next/link";
import { redirect } from "next/navigation";

import WorkerDayModeCheckIn from "@/components/atlas/work/WorkerDayModeCheckIn";
import { buildAdaptiveDayPlan, type AdaptiveDayTask } from "@/lib/atlas/adaptive-day-overview";
import { getWorkerDayRoutingState } from "@/lib/atlas-data/worker-day-routing";
import { getWorkerHand } from "@/lib/atlas-data/worker-hand";
import { requireAtlasRole } from "@/lib/atlas/role-access";
import WorkerTaskActions from "./WorkerTaskActions";
import styles from "./work.module.css";

export const dynamic = "force-dynamic";

type WorkerTodayPageProps = { searchParams: Promise<{ inspect?: string }> };

function centralTodayIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function prettyDate(dateIso: string | null) {
  if (!dateIso) return "No due date";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function WorkerTaskCard({ task, emphasis = false }: { task: AdaptiveDayTask; emphasis?: boolean }) {
  return (
    <article className={`${styles.task} ${task.lane === "blocked" ? styles.blocked : ""}`} data-adaptive-now={emphasis ? "true" : undefined}>
      <div className={styles.taskTop}>
        <h3>{task.title}</h3>
        <span className={styles.date}>{prettyDate(task.dueDate)}</span>
      </div>
      <p className={styles.progress} style={{ marginTop: 6, fontWeight: 700 }}>{task.reason}</p>
      {task.zoneLabel || task.zoneKey ? <p className={styles.location}>{task.zoneLabel ?? task.zoneKey}</p> : null}
      {task.instruction ? <p className={styles.instruction}>{task.instruction}</p> : null}
      {task.blocker ? <p className={styles.instruction}>Blocked: {task.blocker}</p> : null}
      {task.totalSteps ? <p className={styles.progress}>{task.completedSteps}/{task.totalSteps} checklist steps complete</p> : null}
      {task.canAct && task.taskId ? <WorkerTaskActions taskId={task.taskId} /> : null}
    </article>
  );
}

function AdaptiveSection({ title, tasks, emphasis = false }: { title: string; tasks: AdaptiveDayTask[]; emphasis?: boolean }) {
  if (!tasks.length) return null;
  return (
    <section className={styles.section} data-adaptive-section={title.toLowerCase().replaceAll(" ", "-")}>
      <div className={styles.sectionHeader}><h2>{title}</h2><span>{tasks.length}</span></div>
      <div className={styles.list}>
        {tasks.map((task) => <WorkerTaskCard key={task.taskId ?? `${task.title}-${task.dueDate ?? "undated"}`} task={task} emphasis={emphasis} />)}
      </div>
    </section>
  );
}

export default async function WorkerTodayPage({ searchParams }: WorkerTodayPageProps) {
  const access = await requireAtlasRole(["owner", "manager", "farm_hand"]);
  const params = await searchParams;
  if (access.membership.role !== "farm_hand" && params.inspect !== "1") redirect(`/day?date=${encodeURIComponent(centralTodayIso())}&view=work_order`);

  const [hand, routingState] = await Promise.all([
    getWorkerHand(access),
    access.membership.role === "farm_hand" ? getWorkerDayRoutingState(access).catch(() => null) : Promise.resolve(null),
  ]);
  const allTasks = [...hand.lanes.blocked, ...hand.lanes.overdue, ...hand.lanes.today, ...hand.lanes.undated];
  const plan = buildAdaptiveDayPlan(allTasks, routingState);

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="worker-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{hand.farm.name} · Today's order</p>
            <h1 id="worker-title">{hand.worker?.displayName ?? "Farm work"}</h1>
            <p className={styles.identity}>Atlas is holding the order. Work the list from the top.</p>
          </div>
          <Link className={styles.back} href="/">Home</Link>
        </header>

        {!hand.worker ? (
          <section className={styles.emptyState}>
            <h2>No active Farm Hand membership yet</h2>
            <p>{hand.unassignedWorkerTaskCount ? `${hand.unassignedWorkerTaskCount} open worker tasks are waiting for a real farm membership before they can be shown or acted on.` : "There is no Farm Hand membership available for this farm."}</p>
            {access.membership.role === "owner" ? <Link href="/owner/members">Open People &amp; Access</Link> : null}
          </section>
        ) : (
          <>
            {!hand.canAct ? <p className={styles.inspect}>Read-only worker view. Task actions remain available only to the assigned Farm Hand.</p> : null}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              <div>
                <strong style={{ display: "block" }}>Today's plan can change as the day changes.</strong>
                <span style={{ opacity: .68 }}>Weather, timing, farm needs, and what you tell Atlas can reorder it.</span>
              </div>
              <WorkerDayModeCheckIn state={routingState} canAct={hand.canAct} />
            </div>

            <section className={styles.summary} aria-label="Today work summary">
              <article><strong>{plan.now.length}</strong><span>now</span></article>
              <article><strong>{plan.comingUp.length}</strong><span>coming up</span></article>
              <article><strong>{plan.later.length}</strong><span>later</span></article>
              <article><strong>{plan.waiting.length}</strong><span>waiting</span></article>
            </section>

            {hand.counts.total ? (
              <>
                <AdaptiveSection title="Now" tasks={plan.now} emphasis />
                <AdaptiveSection title="Coming up" tasks={plan.comingUp} />
                <AdaptiveSection title="Later" tasks={plan.later} />
                <AdaptiveSection title="Waiting" tasks={plan.waiting} />
              </>
            ) : (
              <section className={styles.emptyState}><h2>No work is ready</h2><p>There are no assigned or farm-shared tasks due for this worker today.</p></section>
            )}
          </>
        )}
      </section>
    </main>
  );
}
