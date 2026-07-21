import Link from "next/link";

import type { TaskScheduleProjection } from "@/lib/atlas-data/task-schedule";
import { prettyFarmDate } from "@/lib/atlas/date";
import type { AtlasFarmRole } from "@/lib/atlas/session";
import {
  ATLAS_SCHEDULE_ROUTE_LABELS,
  atlasIsMaintenanceCollectionRoute,
  atlasScheduleRouteKey,
} from "@/lib/atlas/task-route-core.js";

type ScheduleTask = TaskScheduleProjection["days"][number]["tasks"][number];
type ScheduleMode = "day" | "week" | "month";

type CanonicalScheduleViewProps = {
  mode: ScheduleMode;
  title: string;
  subtitle: string;
  schedule: TaskScheduleProjection;
  role: AtlasFarmRole;
  routeFilter?: string | null;
};

const ROUTE_LABELS = ATLAS_SCHEDULE_ROUTE_LABELS as Record<string, string>;
const COLLECTION_LINKS: Record<string, string> = {
  weed: "/collections/weeding",
  mow: "/collections/mowing",
};

function routeKey(task: ScheduleTask) {
  return atlasScheduleRouteKey(task);
}

function taskLocation(task: ScheduleTask) {
  return task.object.label || task.zone.label || "Elm Farm";
}

function taskHref(task: ScheduleTask, role: AtlasFarmRole) {
  const taskId = task.taskId;
  if (!taskId) return null;
  if (role === "owner" && task.visibilityScope === "owner") {
    return `/owner/tasks/${encodeURIComponent(taskId)}`;
  }
  return `/task-focus/${encodeURIComponent(taskId)}`;
}

function taskKey(task: ScheduleTask) {
  return task.taskId ?? `${task.title}-${task.dueDate ?? "undated"}-${taskLocation(task)}`;
}

function TaskCard({ task, role }: { task: ScheduleTask; role: AtlasFarmRole }) {
  const detail = task.blocker || task.instruction;
  const content = (
    <>
      <div>
        <strong>{task.title}</strong>
        <span>{ROUTE_LABELS[routeKey(task)]} · {taskLocation(task)}</span>
      </div>
      <em>{task.status === "done" ? "complete" : prettyFarmDate(task.dueDate)}</em>
      {detail ? <p>{detail}</p> : null}
    </>
  );
  const href = taskHref(task, role);
  if (!href) return <article className="atlas-overview-task-card">{content}</article>;
  return <Link className="atlas-overview-task-card" href={href}>{content}</Link>;
}

function TaskSection({
  title,
  tasks,
  role,
  badge = "Open",
  open = false,
}: {
  title: string;
  tasks: ScheduleTask[];
  role: AtlasFarmRole;
  badge?: string;
  open?: boolean;
}) {
  if (!tasks.length) return null;
  return (
    <details className="atlas-overview-zone-card" open={open}>
      <summary>
        <div>
          <strong>{title}</strong>
          <span>{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span>
        </div>
        <b>{badge}</b>
      </summary>
      <div className="atlas-overview-task-list">
        {tasks.map((task) => <TaskCard key={taskKey(task)} task={task} role={role} />)}
      </div>
    </details>
  );
}

function CollectionCard({ route, tasks, mode }: { route: "weed" | "mow"; tasks: ScheduleTask[]; mode: ScheduleMode }) {
  if (!tasks.length) return null;
  const open = tasks.filter((task) => task.status === "open").length;
  const blocked = tasks.filter((task) => task.status === "blocked").length;
  const done = tasks.filter((task) => task.status === "done").length;
  const locations = Array.from(new Set(tasks.map(taskLocation))).slice(0, 3);
  const windowLabel = mode === "day" ? "today" : mode === "week" ? "this week" : "this month";

  return (
    <Link className="atlas-overview-zone-card atlas-work-collection-summary-card" href={COLLECTION_LINKS[route]}>
      <summary>
        <div>
          <strong>{ROUTE_LABELS[route]} Collection</strong>
          <span>{tasks.length} {tasks.length === 1 ? "area" : "areas"} in {windowLabel}</span>
        </div>
        <b>Collection</b>
      </summary>
      <div className="atlas-overview-task-list">
        <article className="atlas-overview-task-card">
          <div>
            <strong>{open} open · {blocked} blocked · {done} done</strong>
            <span>{locations.length ? locations.join(" · ") : "Elm Farm"}</span>
          </div>
          <em>Open collection</em>
        </article>
      </div>
    </Link>
  );
}

function groupByZone(tasks: ScheduleTask[]) {
  const groups = new Map<string, ScheduleTask[]>();
  for (const task of tasks) {
    const key = task.zone.label || task.object.label || "Elm Farm";
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return Array.from(groups.entries()).sort((left, right) => left[0].localeCompare(right[0]));
}

function groupByRoute(tasks: ScheduleTask[]) {
  const groups = new Map<string, ScheduleTask[]>();
  for (const task of tasks) {
    const key = routeKey(task);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return Array.from(groups.entries()).sort((left, right) => {
    const order = ["weed", "care", "sow", "plant", "water", "harvest", "maintain", "mow", "other"];
    return order.indexOf(left[0]) - order.indexOf(right[0]);
  });
}

function withoutMaintenanceCollections(tasks: ScheduleTask[]) {
  return tasks.filter((task) => !atlasIsMaintenanceCollectionRoute(routeKey(task)));
}

export default function CanonicalScheduleView({
  mode,
  title,
  subtitle,
  schedule,
  role,
  routeFilter = null,
}: CanonicalScheduleViewProps) {
  const homeHref = role === "owner" ? "/owner" : role === "manager" ? "/manage" : "/";
  const scheduledTasks = schedule.days.flatMap((day) => day.tasks);
  const rawCarryover = [
    ...schedule.carryover.blocked,
    ...schedule.carryover.overdue,
    ...schedule.carryover.undated,
  ];
  const allWindowTasks = [...scheduledTasks, ...rawCarryover];
  const collectionCards = (["weed", "mow"] as const)
    .map((route) => ({ route, tasks: allWindowTasks.filter((task) => routeKey(task) === route) }))
    .filter((collection) => collection.tasks.length > 0);

  const filteredTasks = routeFilter
    ? scheduledTasks.filter((task) => routeKey(task) === routeFilter)
    : withoutMaintenanceCollections(scheduledTasks);
  const groups = mode === "day" ? groupByRoute(filteredTasks) : groupByZone(filteredTasks);
  const visibleBlocked = routeFilter
    ? schedule.carryover.blocked.filter((task) => routeKey(task) === routeFilter)
    : withoutMaintenanceCollections(schedule.carryover.blocked);
  const visibleOverdue = routeFilter
    ? schedule.carryover.overdue.filter((task) => routeKey(task) === routeFilter)
    : withoutMaintenanceCollections(schedule.carryover.overdue);
  const visibleUndated = routeFilter
    ? schedule.carryover.undated.filter((task) => routeKey(task) === routeFilter)
    : withoutMaintenanceCollections(schedule.carryover.undated);
  const visibleCarryover = [...visibleBlocked, ...visibleOverdue, ...visibleUndated];
  const doneCount = scheduledTasks.filter((task) => task.status === "done").length;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href={homeHref} className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Elm Farm</span>
          </Link>
          <span className="atlas-weather-line">{schedule.progress.open} open · {doneCount} done</span>
          <Link href={homeHref} className="atlas-note-plus" aria-label="Back to farm home">+</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body">
          <section className="atlas-overview-hero">
            <div>
              <strong>{title}</strong>
              <span>{subtitle}</span>
            </div>
            <p>{schedule.counts.scheduled} scheduled · {rawCarryover.length} carryover</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label={`${title} schedule stats`}>
            <article><strong>{schedule.progress.open}</strong><span>open</span></article>
            <article><strong>{schedule.progress.blocked}</strong><span>blocked</span></article>
            <article><strong>{doneCount}</strong><span>done</span></article>
            <article><strong>{groups.length + collectionCards.length}</strong><span>{mode === "day" ? "work lanes" : "work groups"}</span></article>
          </section>

          {mode === "day" && !routeFilter ? (
            <section className="atlas-overview-route-chip-row" aria-label="Day work lanes">
              {groupByRoute(scheduledTasks).map(([key, tasks]) => (
                <Link
                  key={key}
                  href={COLLECTION_LINKS[key] ?? `/day?date=${encodeURIComponent(schedule.startDate)}&route=${encodeURIComponent(key)}`}
                >
                  {ROUTE_LABELS[key]} {tasks.length}
                </Link>
              ))}
            </section>
          ) : null}

          {routeFilter ? (
            <p className="atlas-overview-summary-line">
              <Link href={`/day?date=${encodeURIComponent(schedule.startDate)}`}>← All day work</Link>
            </p>
          ) : null}

          <section className="atlas-overview-zone-list" aria-label={`${title} work`}>
            {!routeFilter ? collectionCards.map((collection) => (
              <CollectionCard key={collection.route} route={collection.route} tasks={collection.tasks} mode={mode} />
            )) : null}

            <TaskSection title="Blocked carryover" tasks={visibleBlocked} role={role} badge="Blocked" open />
            <TaskSection title="Overdue carryover" tasks={visibleOverdue} role={role} badge="Overdue" open />
            <TaskSection title="Undated carryover" tasks={visibleUndated} role={role} badge="Open" />

            {groups.map(([key, tasks], index) => (
              <TaskSection
                key={key}
                title={mode === "day" ? ROUTE_LABELS[key] : key}
                tasks={tasks}
                role={role}
                badge={mode === "day" ? "Lane" : "Zone"}
                open={visibleCarryover.length === 0 && collectionCards.length === 0 && index === 0}
              />
            ))}

            {!visibleCarryover.length && !groups.length && !collectionCards.length ? (
              <div className="atlas-task-page-empty">No work is scheduled in this window.</div>
            ) : null}
          </section>
        </div>
      </section>
    </main>
  );
}
