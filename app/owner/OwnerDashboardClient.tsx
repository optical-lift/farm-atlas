import Link from "next/link";

import type {
  OwnerAction,
  OwnerDashboardProjection,
} from "@/lib/atlas-data/owner-dashboard";

type OwnerSectionProps = {
  title: string;
  tasks: OwnerAction[];
  empty: string;
  returnTo?: string;
};

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "No date";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function taskDetail(task: OwnerAction) {
  if (task.totalSteps) {
    return `${task.completedSteps}/${task.totalSteps} steps done`;
  }
  if (task.blocker) return task.blocker;
  return task.detail;
}

function OwnerTaskCard({ task, returnTo = "/owner" }: { task: OwnerAction; returnTo?: string }) {
  const detail = taskDetail(task);
  const content = (
    <>
      <div>
        <strong>{task.title}</strong>
        <span>{task.taskType.replaceAll("_", " ")}</span>
      </div>
      <em>{prettyDate(task.dueDate)}</em>
      {detail ? <p>{detail}</p> : null}
    </>
  );

  if (!task.id) {
    return <article className="atlas-overview-task-card atlas-owner-task-card">{content}</article>;
  }

  return (
    <Link
      className="atlas-overview-task-card atlas-owner-task-card"
      href={`/task-focus/${encodeURIComponent(task.id)}?returnTo=${encodeURIComponent(returnTo)}`}
    >
      {content}
    </Link>
  );
}

function OwnerSection({ title, tasks, empty, returnTo }: OwnerSectionProps) {
  return (
    <section className="atlas-overview-zone-card atlas-owner-section">
      <summary>
        <div>
          <strong>{title}</strong>
          <span>{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span>
        </div>
        <b>Owner</b>
      </summary>
      <div className="atlas-overview-task-list">
        {tasks.length ? (
          tasks.map((task) => (
            <OwnerTaskCard
              key={task.id ?? `${task.title}-${task.dueDate ?? "none"}`}
              task={task}
              returnTo={returnTo}
            />
          ))
        ) : (
          <p className="atlas-task-page-muted">{empty}</p>
        )}
      </div>
    </section>
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
          <span className="atlas-weather-line">{counts.open} open actions</span>
          <Link href="/" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to farms">
            ↩
          </Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-owner-body">
          <section className="atlas-overview-hero atlas-owner-hero">
            <div>
              <strong>Owner Work</strong>
              <span>{prettyDate(dashboard.generatedForDate)}–{prettyDate(dashboard.weekEndDate)}</span>
            </div>
            <p>{counts.open} open owner tasks · {counts.blocked} blocked</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Owner task stats">
            <article><strong>{counts.overdue}</strong><span>overdue</span></article>
            <article><strong>{counts.today}</strong><span>today</span></article>
            <article><strong>{counts.thisWeek}</strong><span>this week</span></article>
            <article><strong>{counts.later}</strong><span>later</span></article>
          </section>

          <section className="atlas-overview-zone-list atlas-owner-list" aria-label="Owner task list">
            <OwnerSection title="Overdue" tasks={ownerActions.overdue} empty="No overdue owner tasks." />
            <OwnerSection title="Today" tasks={ownerActions.today} empty="No owner tasks due today." />
            <OwnerSection title="This Week" tasks={ownerActions.thisWeek} empty="No owner tasks later this week." />
            <OwnerSection title="Later" tasks={ownerActions.later} empty="No later owner tasks." />
            {ownerActions.recentlyDone.length ? (
              <OwnerSection
                title="Recently Done"
                tasks={ownerActions.recentlyDone}
                empty="No owner tasks completed yet."
              />
            ) : null}
          </section>
        </div>
      </section>
    </main>
  );
}
