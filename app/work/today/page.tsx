import Link from "next/link";
import { redirect } from "next/navigation";

import WorkerDayModeCheckIn from "@/components/atlas/work/WorkerDayModeCheckIn";
import { buildAdaptiveDayPlan, type AdaptiveDayTask } from "@/lib/atlas/adaptive-day-overview";
import { getWorkerDayRoutingState } from "@/lib/atlas-data/worker-day-routing";
import { getWorkerHand } from "@/lib/atlas-data/worker-hand";
import { getWorkerOperationalRouteStopsForFarm, type WorkerOperationalRouteStop } from "@/lib/atlas-data/worker-operational-routes";
import { readWorkerWeekProjection } from "@/lib/atlas-data/worker-week-projection";
import { requireAtlasRole } from "@/lib/atlas/role-access";
import WorkerFlowerLogging from "./WorkerFlowerLogging";
import WorkerRouteStopActions from "./WorkerRouteStopActions";
import WorkerTaskActions from "./WorkerTaskActions";
import styles from "./work.module.css";

export const dynamic = "force-dynamic";

type WorkerTodayPageProps = { searchParams: Promise<{ inspect?: string; date?: string }> };

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

function prettyWindow(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

function validDateIso(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function taskFocusHref(taskId: string) {
  return `/task-focus/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent("/work/today")}`;
}

function WorkerTaskCard({ task, emphasis = false }: { task: AdaptiveDayTask; emphasis?: boolean }) {
  return (
    <article className={`${styles.task} ${task.lane === "blocked" ? styles.blocked : ""}`} data-adaptive-now={emphasis ? "true" : undefined}>
      <div className={styles.taskTop}>
        <h3>{task.taskId ? <Link href={taskFocusHref(task.taskId)}>{task.title}</Link> : task.title}</h3>
        <span className={styles.date}>{prettyDate(task.dueDate)}</span>
      </div>
      <p className={styles.progress} style={{ marginTop: 6, fontWeight: 700 }}>{task.reason}</p>
      {task.zoneLabel || task.zoneKey ? <p className={styles.location}>{task.zoneLabel ?? task.zoneKey}</p> : null}
      {task.instruction ? <p className={styles.instruction}>{task.instruction}</p> : null}
      {task.blocker ? <p className={styles.instruction}>Blocked: {task.blocker}</p> : null}
      {task.totalSteps ? <p className={styles.progress}>{task.completedSteps}/{task.totalSteps} checklist steps complete</p> : null}
      {task.taskId ? <Link href={taskFocusHref(task.taskId)} className={styles.openTask}>Open task</Link> : null}
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

function WorkerRouteSection({ stops, canAct }: { stops: WorkerOperationalRouteStop[]; canAct: boolean }) {
  if (!stops.length) return null;
  return (
    <section className={styles.section} data-worker-operational-routes="assigned-only">
      <div className={styles.sectionHeader}><h2>Stops for you</h2><span>{stops.length}</span></div>
      <div className={styles.list}>
        {stops.map((stop) => {
          const start = prettyWindow(stop.serviceWindowStart);
          const end = prettyWindow(stop.serviceWindowEnd);
          const window = start && end && start !== end ? `${start}–${end}` : start ?? end;
          return (
            <article className={styles.task} key={stop.stopId} data-route-stop-kind={stop.stopKind}>
              <div className={styles.taskTop}>
                <h3>{stop.destinationLabel}</h3>
                <span className={styles.date}>{window ?? prettyDate(stop.routeDate)}</span>
              </div>
              {stop.addressText ? <p className={styles.location}>{stop.addressText}</p> : null}
              {stop.contactName ? <p className={styles.progress} style={{ fontWeight: 800 }}>Ask for {stop.contactName}</p> : null}
              {stop.obligations.length ? (
                <div>
                  {stop.obligations.map((obligation) => <p className={styles.progress} key={obligation.bindingId}>{obligation.description}</p>)}
                </div>
              ) : null}
              {stop.workerInstruction ? <p className={styles.instruction}>{stop.workerInstruction}</p> : null}
              {canAct ? <WorkerRouteStopActions stopId={stop.stopId} stopKind={stop.stopKind} /> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default async function WorkerTodayPage({ searchParams }: WorkerTodayPageProps) {
  const access = await requireAtlasRole(["owner", "manager", "farm_hand"]);
  const params = await searchParams;
  const inspectMode = access.membership.role !== "farm_hand" && params.inspect === "1";
  if (access.membership.role !== "farm_hand" && !inspectMode) redirect(`/day?date=${encodeURIComponent(centralTodayIso())}&view=work_order`);

  const today = centralTodayIso();
  const requestedDate = inspectMode ? (validDateIso(params.date) ?? today) : today;
  const [hand, routingState, routeStops] = await Promise.all([
    getWorkerHand(access, null, requestedDate),
    access.membership.role === "farm_hand" ? getWorkerDayRoutingState(access).catch(() => null) : Promise.resolve(null),
    access.membership.role === "farm_hand" ? getWorkerOperationalRouteStopsForFarm(access.membership.farmId, requestedDate).catch(() => []) : Promise.resolve([]),
  ]);
  const allTasks = [...hand.lanes.blocked, ...hand.lanes.overdue, ...hand.lanes.today, ...hand.lanes.undated];
  const taskIds = new Set(allTasks.flatMap((task) => task.taskId ? [task.taskId] : []));
  const routeOnlyStops = routeStops.filter((stop) => !stop.executionTaskId || !taskIds.has(stop.executionTaskId));
  const plan = buildAdaptiveDayPlan(allTasks, routingState);
  const futureInspection = inspectMode && requestedDate > today;
  const projection = futureInspection && hand.worker
    ? await readWorkerWeekProjection(access.membership.farmId, hand.worker.membershipId, requestedDate, 1).catch(() => null)
    : null;
  const projectedItems = projection?.days[0]?.items ?? [];

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="worker-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>{hand.farm.name} · {inspectMode ? prettyDate(requestedDate) : "Today's order"}</p>
            <h1 id="worker-title">{hand.worker?.displayName ?? "Farm work"}</h1>
            <p className={styles.identity}>{futureInspection ? "Owner preview of the work Atlas expects for this day." : "Atlas is holding the order. Work the list from the top."}</p>
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

            {inspectMode ? (
              <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }} aria-label="Inspect Anna by date">
                {Array.from({ length: 7 }, (_, index) => {
                  const date = addDays(today, index);
                  return <Link key={date} href={`/work/today?inspect=1&date=${encodeURIComponent(date)}`} style={{ fontWeight: date === requestedDate ? 800 : 600 }}>{prettyDate(date)}</Link>;
                })}
              </nav>
            ) : null}

            {futureInspection ? (
              <section className={styles.section} data-owner-future-plan="true">
                <div className={styles.sectionHeader}><h2>Planned for this day</h2><span>{projectedItems.length}</span></div>
                <div className={styles.list}>
                  {projectedItems.length ? projectedItems.map((item) => (
                    <article className={styles.task} key={item.id}>
                      <div className={styles.taskTop}><h3>{item.title}</h3><span className={styles.date}>{item.planState}</span></div>
                      <p className={styles.progress} style={{ marginTop: 6, fontWeight: 700 }}>{item.reason ?? "Atlas weekly projection"}</p>
                      <p className={styles.location}>{item.expectedActiveMinutes ? `${item.expectedActiveMinutes} min · ` : ""}{item.environment ? item.environment : "farm work"}</p>
                      <p className={styles.instruction}>Preview only. Atlas has not released this card into Anna's hand yet.</p>
                    </article>
                  )) : <p className={styles.progress}>No projected work is currently assigned to this day.</p>}
                </div>
              </section>
            ) : (
              <>
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

                <WorkerRouteSection stops={routeOnlyStops} canAct={hand.canAct} />

                {hand.counts.total ? (
                  <>
                    <AdaptiveSection title="Now" tasks={plan.now} emphasis />
                    <AdaptiveSection title="Coming up" tasks={plan.comingUp} />
                    <AdaptiveSection title="Later" tasks={plan.later} />
                    <AdaptiveSection title="Waiting" tasks={plan.waiting} />
                  </>
                ) : !routeOnlyStops.length ? (
                  <section className={styles.emptyState}><h2>No work is ready</h2><p>There are no assigned tasks or route stops for this worker today.</p></section>
                ) : null}

                {access.membership.role === "farm_hand" ? <WorkerFlowerLogging /> : null}
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
