import Link from "next/link";

import type { TaskScheduleProjection } from "@/lib/atlas-data/task-schedule";
import { prettyFarmDate } from "@/lib/atlas/date";
import type { AtlasFarmRole } from "@/lib/atlas/session";
import { atlasScheduleRouteKey } from "@/lib/atlas/task-route-core.js";

type ScheduleTask = TaskScheduleProjection["days"][number]["tasks"][number];
type MaintenanceRoute = "weed" | "mow";

type Props = {
  route: MaintenanceRoute;
  title: string;
  subtitle: string;
  today: string;
  schedule: TaskScheduleProjection;
  role: AtlasFarmRole;
};

function taskLocation(task: ScheduleTask) {
  return task.object.label || task.zone.label || "Elm Farm";
}

function taskHref(task: ScheduleTask, role: AtlasFarmRole, returnTo: string) {
  if (!task.taskId) return null;
  if (role === "owner" && task.visibilityScope === "owner") {
    return `/owner/tasks/${encodeURIComponent(task.taskId)}`;
  }
  return `/task-focus/${encodeURIComponent(task.taskId)}?returnTo=${encodeURIComponent(returnTo)}`;
}

function uniqueTasks(tasks: ScheduleTask[]) {
  const byId = new Map<string, ScheduleTask>();
  for (const task of tasks) {
    if (task.taskId) byId.set(task.taskId, task);
  }
  return Array.from(byId.values()).sort((left, right) => {
    const leftDate = left.dueDate ?? "9999-12-31";
    const rightDate = right.dueDate ?? "9999-12-31";
    return leftDate === rightDate ? left.title.localeCompare(right.title) : leftDate.localeCompare(rightDate);
  });
}

function CollectionTaskCard({
  task,
  role,
  returnTo,
}: {
  task: ScheduleTask;
  role: AtlasFarmRole;
  returnTo: string;
}) {
  const content = (
    <>
      <div>
        <strong>{task.title}</strong>
        <span>{taskLocation(task)}</span>
      </div>
      <em>{task.status === "done" ? "complete" : task.status === "blocked" ? "blocked" : prettyFarmDate(task.dueDate)}</em>
      {task.blocker || task.instruction ? <p>{task.blocker || task.instruction}</p> : null}
    </>
  );
  const href = taskHref(task, role, returnTo);
  if (!href) return <article className="atlas-overview-task-card">{content}</article>;
  return <Link className="atlas-overview-task-card" href={href}>{content}</Link>;
}

function CollectionSection({
  title,
  tasks,
  role,
  returnTo,
  empty,
  open = false,
}: {
  title: string;
  tasks: ScheduleTask[];
  role: AtlasFarmRole;
  returnTo: string;
  empty: string;
  open?: boolean;
}) {
  return (
    <details className="atlas-overview-zone-card atlas-work-collection-section" open={open}>
      <summary>
        <div>
          <strong>{title}</strong>
          <span>{tasks.length} {tasks.length === 1 ? "area" : "areas"}</span>
        </div>
        <b>Collection</b>
      </summary>
      <div className="atlas-overview-task-list">
        {tasks.length
          ? tasks.map((task) => <CollectionTaskCard key={task.taskId} task={task} role={role} returnTo={returnTo} />)
          : <p className="atlas-task-page-muted">{empty}</p>}
      </div>
    </details>
  );
}

export default function CanonicalMaintenanceCollectionView({
  route,
  title,
  subtitle,
  today,
  schedule,
  role,
}: Props) {
  const allTasks = uniqueTasks([
    ...schedule.days.flatMap((day) => day.tasks),
    ...schedule.carryover.blocked,
    ...schedule.carryover.overdue,
    ...schedule.carryover.undated,
  ]).filter((task) => atlasScheduleRouteKey(task) === route);

  const dueNow = allTasks.filter((task) => task.status === "open" && (!task.dueDate || task.dueDate <= today));
  const blocked = allTasks.filter((task) => task.status === "blocked");
  const upcoming = allTasks.filter((task) => task.status === "open" && Boolean(task.dueDate && task.dueDate > today));
  const recentlyDone = allTasks.filter((task) => task.status === "done");
  const nextDue = upcoming.find((task) => task.dueDate)?.dueDate ?? null;
  const returnTo = route === "mow" ? "/collections/mowing" : "/collections/weeding";

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-work-collection-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href={role === "owner" ? "/owner" : role === "manager" ? "/manage" : "/work/today"} className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">{title}</span>
          </Link>
          <span className="atlas-weather-line">{subtitle}</span>
          <Link href={role === "farm_hand" ? "/work/today" : `/day?date=${encodeURIComponent(today)}`} className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to work overview">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-work-collection-body">
          <section className="atlas-overview-hero atlas-work-collection-hero">
            <div>
              <strong>{title} Collection</strong>
              <span>{prettyFarmDate(today)}</span>
            </div>
            <p>{dueNow.length} due · {blocked.length} blocked · {recentlyDone.length} recently done</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label={`${title} collection stats`}>
            <article><strong>{dueNow.length}</strong><span>due now</span></article>
            <article><strong>{blocked.length}</strong><span>blocked</span></article>
            <article><strong>{recentlyDone.length}</strong><span>done</span></article>
            <article><strong>{nextDue ? prettyFarmDate(nextDue) : "none"}</strong><span>next due</span></article>
          </section>

          <section className="atlas-overview-zone-list atlas-work-collection-list" aria-label={`${title} areas`}>
            <CollectionSection title="Due Now" tasks={dueNow} role={role} returnTo={returnTo} empty={`No ${title.toLowerCase()} areas are due now.`} open />
            <CollectionSection title="Blocked" tasks={blocked} role={role} returnTo={returnTo} empty={`No ${title.toLowerCase()} areas are blocked.`} open={blocked.length > 0} />
            <CollectionSection title="Upcoming (7 Days)" tasks={upcoming} role={role} returnTo={returnTo} empty={`No ${title.toLowerCase()} areas are scheduled in the next 7 days.`} />
            <CollectionSection title="Recently Done" tasks={recentlyDone} role={role} returnTo={returnTo} empty={`No ${title.toLowerCase()} areas were completed in the last 7 days.`} />
          </section>
        </div>
      </section>
    </main>
  );
}
