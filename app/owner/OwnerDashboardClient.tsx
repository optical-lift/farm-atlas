import Link from "next/link";

import type {
  OwnerAction,
  OwnerBlocker,
  OwnerDashboardProjection,
  WorkerExecution,
} from "@/lib/atlas-data/owner-dashboard";

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "No date";
  const date = new Date(`${dateIso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

function taskDetail(task: OwnerAction) {
  if (task.totalSteps) return `${task.completedSteps}/${task.totalSteps} steps done`;
  if (task.blocker) return task.blocker;
  return task.detail;
}

function OwnerTaskCard({ task }: { task: OwnerAction }) {
  const detail = taskDetail(task);
  const content = (
    <>
      <div>
        <strong>{task.title}</strong>
        <span>{task.taskType.replaceAll("_", " ")} · {task.location}</span>
      </div>
      <em>{prettyDate(task.dueDate)}</em>
      {detail ? <p>{detail}</p> : null}
    </>
  );

  if (!task.id) return <article className="atlas-overview-task-card atlas-owner-task-card">{content}</article>;
  return (
    <Link
      className="atlas-overview-task-card atlas-owner-task-card"
      href={`/owner/tasks/${encodeURIComponent(task.id)}`}
    >
      {content}
    </Link>
  );
}

function OwnerSection({
  title,
  tasks,
  empty,
  open = false,
}: {
  title: string;
  tasks: OwnerAction[];
  empty: string;
  open?: boolean;
}) {
  return (
    <details className="atlas-overview-zone-card atlas-owner-section" open={open}>
      <summary>
        <div>
          <strong>{title}</strong>
          <span>{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span>
        </div>
        <b>Owner</b>
      </summary>
      <div className="atlas-overview-task-list">
        {tasks.length ? tasks.map((task) => (
          <OwnerTaskCard key={task.id ?? `${task.title}-${task.dueDate ?? "none"}`} task={task} />
        )) : <p className="atlas-task-page-muted">{empty}</p>}
      </div>
    </details>
  );
}

function BlockerCard({ blocker }: { blocker: OwnerBlocker }) {
  const content = (
    <>
      <div>
        <strong>{blocker.title}</strong>
        <span>{blocker.location}</span>
      </div>
      <em>{prettyDate(blocker.dueDate)}</em>
      <p>{blocker.blocker}</p>
    </>
  );
  if (!blocker.id) return <article className="atlas-overview-task-card">{content}</article>;
  return <Link className="atlas-overview-task-card" href={`/task-focus/${encodeURIComponent(blocker.id)}`}>{content}</Link>;
}

function WorkerCard({ worker }: { worker: WorkerExecution }) {
  return (
    <article className="atlas-overview-task-card atlas-owner-worker-card">
      <div>
        <strong>{worker.displayName}</strong>
        <span>{worker.open} open · {worker.blocked} blocked · {worker.done} done</span>
      </div>
      <em>{worker.nextTask ? prettyDate(worker.nextTask.dueDate) : "clear"}</em>
      <p>{worker.nextTask ? `Next: ${worker.nextTask.title} · ${worker.nextTask.location}` : "No assigned work in the current horizon."}</p>
    </article>
  );
}

export default function OwnerDashboardClient({
  dashboard,
}: {
  dashboard: OwnerDashboardProjection;
}) {
  const { counts, ownerActions } = dashboard;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-owner-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">{dashboard.farm.name}</span>
            <span className="atlas-phone-title">Owner</span>
          </Link>
          <span className="atlas-weather-line">{counts.open} owner actions · {counts.maintenanceDue} maintenance due</span>
          <Link href="/owner/members" className="atlas-note-plus atlas-overview-top-dot" aria-label="People and access">People</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-owner-body">
          <section className="atlas-overview-hero atlas-owner-hero">
            <div>
              <strong>Farm Command</strong>
              <span>{prettyDate(dashboard.generatedForDate)}–{prettyDate(dashboard.weekEndDate)}</span>
            </div>
            <p>{counts.farmObjects} objects · {counts.croppedObjects} cropped · {dashboard.farmBlockers.length} blockers</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Farm state stats">
            <article><strong>{counts.criticalObjects}</strong><span>critical</span></article>
            <article><strong>{counts.highRiskObjects}</strong><span>high risk</span></article>
            <article><strong>{counts.decisionRequired}</strong><span>decisions</span></article>
            <article><strong>{counts.maintenanceDue}</strong><span>maintenance due</span></article>
          </section>

          <section className="atlas-overview-zone-list atlas-owner-list" aria-label="Owner command center">
            {dashboard.farmBlockers.length ? (
              <details className="atlas-overview-zone-card atlas-owner-section" open>
                <summary><div><strong>Farm Blockers</strong><span>{dashboard.farmBlockers.length} active</span></div><b>Attention</b></summary>
                <div className="atlas-overview-task-list">
                  {dashboard.farmBlockers.map((blocker) => <BlockerCard key={`${blocker.id ?? blocker.title}-${blocker.blocker}`} blocker={blocker} />)}
                </div>
              </details>
            ) : null}

            <OwnerSection title="Overdue" tasks={ownerActions.overdue} empty="No overdue owner tasks." open />
            <OwnerSection title="Today" tasks={ownerActions.today} empty="No owner tasks due today." open />
            <OwnerSection title="This Week" tasks={ownerActions.thisWeek} empty="No owner tasks later this week." />
            <OwnerSection title="Later" tasks={ownerActions.later} empty="No later owner tasks." />

            <details className="atlas-overview-zone-card atlas-owner-section" open>
              <summary><div><strong>Worker Execution</strong><span>{dashboard.workerExecution.length} active workers</span></div><b>Team</b></summary>
              <div className="atlas-overview-task-list">
                {dashboard.workerExecution.length
                  ? dashboard.workerExecution.map((worker) => <WorkerCard key={worker.membershipId} worker={worker} />)
                  : <p className="atlas-task-page-muted">No assigned worker schedule in the current horizon.</p>}
              </div>
            </details>

            <details className="atlas-overview-zone-card atlas-owner-section">
              <summary><div><strong>Upcoming Deadlines</strong><span>{dashboard.upcomingDeadlines.length} this week</span></div><b>Farm</b></summary>
              <div className="atlas-overview-task-list">
                {dashboard.upcomingDeadlines.length
                  ? dashboard.upcomingDeadlines.map((task) => <OwnerTaskCard key={task.id ?? task.title} task={task} />)
                  : <p className="atlas-task-page-muted">No scheduled deadlines this week.</p>}
              </div>
            </details>

            {ownerActions.recentlyDone.length ? (
              <OwnerSection title="Recently Done" tasks={ownerActions.recentlyDone} empty="No owner tasks completed yet." />
            ) : null}
          </section>
        </div>
      </section>
    </main>
  );
}
