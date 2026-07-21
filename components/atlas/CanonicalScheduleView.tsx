import Link from "next/link";

import type { TaskScheduleProjection } from "@/lib/atlas-data/task-schedule";
import { prettyFarmDate } from "@/lib/atlas/date";
import type { AtlasFarmRole } from "@/lib/atlas/session";

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

const ROUTE_LABELS: Record<string, string> = {
  weed: "Weeding",
  mow: "Mowing",
  sow: "Sowing",
  plant: "Planting",
  harvest: "Harvest",
  water: "Watering",
  care: "Crop Care",
  maintain: "Venue + Maintenance",
  other: "Farm Work",
};

function routeKey(task: ScheduleTask) {
  const joined = `${task.taskType} ${task.title} ${task.instruction ?? ""}`.toLowerCase();
  if (joined.includes("weed") || joined.includes("hoe")) return "weed";
  if (joined.includes("mow")) return "mow";
  if (joined.includes("harvest") || joined.includes("cut flower")) return "harvest";
  if (joined.includes("water") || joined.includes("irrigat")) return "water";
  if (joined.includes("transplant") || joined.includes("plant ")) return "plant";
  if (joined.includes("sow") || joined.includes("seed")) return "sow";
  if (joined.includes("germin") || joined.includes("thin") || joined.includes("pinch")) return "care";
  if (
    joined.includes("maint") ||
    joined.includes("paint") ||
    joined.includes("trim") ||
    joined.includes("clean") ||
    joined.includes("repair")
  ) {
    return "maintain";
  }
  return "other";
}

function taskLocation(task: ScheduleTask) {
  return task.object.label || task.zone.label || "Elm Farm";
}

function taskHref(task: ScheduleTask, role: AtlasFarmRole) {
  if (role === "owner" && task.visibilityScope === "owner") {
    return `/owner/tasks/${encodeURIComponent(task.taskId)}`;
  }
  return `/task-focus/${encodeURIComponent(task.taskId)}`;
}

function TaskCard({ task, role }: { task: ScheduleTask; role: AtlasFarmRole }) {
  const detail = task.blocker || task.instruction;
  return (
    <Link className="atlas-overview-task-card" href={taskHref(task, role)}>
      <div>
        <strong>{task.title}</strong>
        <span>{ROUTE_LABELS[routeKey(task)]} · {taskLocation(task)}</span>
      </div>
      <em>{task.status === "done" ? "complete" : prettyFarmDate(task.dueDate)}</em>
      {detail ? <p>{detail}</p> : null}
    </Link>
  );
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
        {tasks.map((task) => <TaskCard key={task.taskId} task={task} role={role} />)}
      </div>
    </details>
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
  const filteredTasks = routeFilter
    ? scheduledTasks.filter((task) => routeKey(task) === routeFilter)
    : scheduledTasks;
  const groups = mode === "day" ? groupByRoute(filteredTasks) : groupByZone(filteredTasks);
  const carryover = [
    ...schedule.carryover.blocked,
    ...schedule.carryover.overdue,
    ...schedule.carryover.undated,
  ];
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
            <p>{schedule.counts.scheduled} scheduled · {carryover.length} carryover</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label={`${title} schedule stats`}>
            <article><strong>{schedule.progress.open}</strong><span>open</span></article>
            <article><strong>{schedule.progress.blocked}</strong><span>blocked</span></article>
            <article><strong>{doneCount}</strong><span>done</span></article>
            <article><strong>{groups.length}</strong><span>{mode === "day" ? "work lanes" : "zones"}</span></article>
          </section>

          {mode === "day" && !routeFilter ? (
            <section className="atlas-overview-route-chip-row" aria-label="Day work lanes">
              {groupByRoute(scheduledTasks).map(([key, tasks]) => (
                <Link key={key} href={`/day?date=${encodeURIComponent(schedule.startDate)}&route=${encodeURIComponent(key)}`}>
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
            <TaskSection title="Blocked carryover" tasks={schedule.carryover.blocked} role={role} badge="Blocked" open />
            <TaskSection title="Overdue carryover" tasks={schedule.carryover.overdue} role={role} badge="Overdue" open />
            <TaskSection title="Undated carryover" tasks={schedule.carryover.undated} role={role} badge="Open" />

            {groups.map(([key, tasks], index) => (
              <TaskSection
                key={key}
                title={mode === "day" ? ROUTE_LABELS[key] : key}
                tasks={tasks}
                role={role}
                badge={mode === "day" ? "Lane" : "Zone"}
                open={carryover.length === 0 && index === 0}
              />
            ))}

            {!carryover.length && !groups.length ? (
              <div className="atlas-task-page-empty">No work is scheduled in this window.</div>
            ) : null}
          </section>
        </div>
      </section>
    </main>
  );
}
