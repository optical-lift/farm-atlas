import Link from "next/link";

import type { OwnerFinishProjectSummary } from "@/lib/atlas-data/owner-finish-project";
import type {
  OwnerAction,
  OwnerDashboardProjection,
} from "@/lib/atlas-data/owner-dashboard";

type OwnerSectionProps = {
  title: string;
  tasks: OwnerAction[];
  empty: string;
  referenceDate?: string;
  overdue?: boolean;
};

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "No date";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysBetween(startIso: string, endIso: string) {
  const start = new Date(`${startIso}T12:00:00Z`);
  const end = new Date(`${endIso}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

function taskDetail(task: OwnerAction) {
  if (task.totalSteps) return `${task.completedSteps}/${task.totalSteps} steps done`;
  if (task.blocker) return task.blocker;
  return task.detail;
}

function OwnerTaskCard({ task, referenceDate, overdue = false }: { task: OwnerAction; referenceDate?: string; overdue?: boolean }) {
  const detail = taskDetail(task);
  const daysLate = overdue && task.dueDate && referenceDate ? daysBetween(task.dueDate, referenceDate) : null;
  const dateLabel = overdue && task.dueDate
    ? `Overdue since ${prettyDate(task.dueDate)}${daysLate ? ` · ${daysLate}d` : ""}`
    : prettyDate(task.dueDate);
  const content = (
    <>
      <div><strong>{task.title}</strong><span>{task.taskType.replaceAll("_", " ")}</span></div>
      <em>{dateLabel}</em>
      {detail ? <p>{detail}</p> : null}
    </>
  );

  if (!task.id) return <article className={`atlas-overview-task-card atlas-owner-task-card${overdue ? " atlas-owner-overdue-card" : ""}`}>{content}</article>;
  return <Link className={`atlas-overview-task-card atlas-owner-task-card${overdue ? " atlas-owner-overdue-card" : ""}`} href={`/owner/tasks/${encodeURIComponent(task.id)}`}>{content}</Link>;
}

function OwnerSection({ title, tasks, empty, referenceDate, overdue = false }: OwnerSectionProps) {
  return (
    <section className={`atlas-overview-zone-card atlas-owner-section${overdue ? " atlas-owner-overdue-section" : ""}`}>
      <summary><div><strong>{title}</strong><span>{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span></div><b>{overdue ? "Needs attention" : "Owner"}</b></summary>
      <div className="atlas-overview-task-list">
        {tasks.length ? tasks.map((task) => <OwnerTaskCard key={task.id ?? `${task.title}-${task.dueDate ?? "none"}`} task={task} referenceDate={referenceDate} overdue={overdue} />) : <p className="atlas-task-page-muted">{empty}</p>}
      </div>
    </section>
  );
}

function FinishProjectStewardship({ project }: { project: OwnerFinishProjectSummary }) {
  const current = project.released[0] ?? null;
  const releaseLabel = current?.taskStatus === "done" ? "Completed today" : current ? "Released to Anna" : "No venue move released";
  return (
    <Link
      href={`/project/${encodeURIComponent(project.projectId)}`}
      className="atlas-overview-zone-card atlas-owner-section"
      style={{ display: "block", textDecoration: "none", color: "inherit", padding: 0, overflow: "hidden" }}
    >
      <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid rgba(0,0,0,.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <div>
            <small style={{ textTransform: "uppercase", letterSpacing: ".08em", opacity: .58 }}>Venue stewardship</small>
            <strong style={{ display: "block", marginTop: 4, fontSize: 19 }}>{project.projectTitle}</strong>
          </div>
          <b style={{ whiteSpace: "nowrap" }}>{project.totalRemaining} remaining</b>
        </div>
      </div>

      <div style={{ padding: "14px 18px" }}>
        <small style={{ opacity: .62 }}>{releaseLabel}</small>
        {current ? (
          <>
            <strong style={{ display: "block", marginTop: 4 }}>{current.title}</strong>
            <p style={{ margin: "5px 0 0", opacity: .72 }}>{current.minutes ? `${current.minutes} min · ` : ""}{current.taskStatus ? current.taskStatus.replaceAll("_", " ") : "in today's hand"}</p>
          </>
        ) : <p style={{ margin: "5px 0 0", opacity: .72 }}>Atlas has not materialized a Finish Project move into Anna's day.</p>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", borderTop: "1px solid rgba(0,0,0,.08)" }}>
        <div style={{ padding: "12px 8px", textAlign: "center" }}><strong style={{ display: "block", fontSize: 18 }}>{project.annaReadyCount}</strong><span style={{ fontSize: 11, opacity: .62 }}>Anna pool</span></div>
        <div style={{ padding: "12px 8px", textAlign: "center", borderLeft: "1px solid rgba(0,0,0,.06)" }}><strong style={{ display: "block", fontSize: 18 }}>{project.managementCount}</strong><span style={{ fontSize: 11, opacity: .62 }}>Owner / Marshall</span></div>
        <div style={{ padding: "12px 8px", textAlign: "center", borderLeft: "1px solid rgba(0,0,0,.06)" }}><strong style={{ display: "block", fontSize: 18 }}>{project.blockedCount}</strong><span style={{ fontSize: 11, opacity: .62 }}>blocked</span></div>
        <div style={{ padding: "12px 8px", textAlign: "center", borderLeft: "1px solid rgba(0,0,0,.06)" }}><strong style={{ display: "block", fontSize: 18 }}>{project.completedCount}</strong><span style={{ fontSize: 11, opacity: .62 }}>completed</span></div>
      </div>

      <div style={{ padding: "10px 18px 14px", borderTop: "1px solid rgba(0,0,0,.06)", fontSize: 13, fontWeight: 700 }}>Open project stewardship →</div>
    </Link>
  );
}

export default function OwnerDashboardClient({ dashboard, finishProject }: { dashboard: OwnerDashboardProjection; finishProject: OwnerFinishProjectSummary | null }) {
  const { counts, ownerActions } = dashboard;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-owner-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">{dashboard.farm.name}</span><span className="atlas-phone-title">Owner</span></Link>
          <span className="atlas-weather-line">{counts.overdue} overdue</span>
          <Link href="/owner/members" className="atlas-note-plus atlas-overview-top-dot" aria-label="People and access">People</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-owner-body">
          <section className="atlas-overview-hero atlas-owner-hero">
            <div><strong>Owner Work</strong><span>{prettyDate(dashboard.generatedForDate)}–{prettyDate(dashboard.weekEndDate)}</span></div>
            <p>{counts.overdue} overdue · {counts.today} due today · {counts.open} open total</p>
          </section>

          {finishProject ? <FinishProjectStewardship project={finishProject} /> : null}

          <OwnerSection title="Fallen Through the Cracks" tasks={ownerActions.overdue} empty="No overdue owner tasks." referenceDate={dashboard.generatedForDate} overdue />

          <section className="atlas-overview-stat-grid" aria-label="Owner task stats">
            <article><strong>{counts.overdue}</strong><span>overdue</span></article>
            <article><strong>{counts.today}</strong><span>today</span></article>
            <article><strong>{counts.thisWeek}</strong><span>this week</span></article>
            <article><strong>{counts.later}</strong><span>later</span></article>
          </section>

          <section className="atlas-overview-zone-list atlas-owner-list" aria-label="Owner task list">
            <OwnerSection title="Today" tasks={ownerActions.today} empty="No owner tasks due today." />
            <OwnerSection title="This Week" tasks={ownerActions.thisWeek} empty="No owner tasks later this week." />
            <OwnerSection title="Later" tasks={ownerActions.later} empty="No later owner tasks." />
            <Link className="atlas-overview-task-card atlas-owner-task-card" href="/owner/lineage"><div><strong>Trail Lineage Audit</strong><span>owner evidence review</span></div><em>Open</em><p>Confirm or reject proposed links between completed records and earlier Trail points.</p></Link>
            {ownerActions.recentlyDone.length ? <OwnerSection title="Recently Done" tasks={ownerActions.recentlyDone} empty="No owner tasks completed yet." /> : null}
          </section>
        </div>
      </section>
    </main>
  );
}
