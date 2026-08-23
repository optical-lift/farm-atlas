import Link from "next/link";

import type { OwnerMyWorkItem, OwnerMyWorkProjection } from "@/lib/atlas-data/owner-my-work";
import type { OwnerFinishProjectSummary } from "@/lib/atlas-data/owner-finish-project";

type OwnerSectionProps = {
  title: string;
  items: OwnerMyWorkItem[];
  empty: string;
  badge?: string;
};

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "No date";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function sourceLabel(item: OwnerMyWorkItem) {
  if (item.source === "principal") {
    return item.sourceType === "owner_obligation"
      ? "owner obligation"
      : item.sourceType.replaceAll("_", " ");
  }
  return item.sourceType.replaceAll("_", " ");
}

function timingLabel(item: OwnerMyWorkItem) {
  if (item.isOverdue && item.timingDate) return `Overdue since ${prettyDate(item.timingDate)}`;
  if (!item.timingDate) return item.source === "principal" ? "Principal" : "No date";
  if (item.timingKind === "fixed") return `Fixed ${prettyDate(item.timingDate)}`;
  if (item.timingKind === "available") return `Available ${prettyDate(item.timingDate)}`;
  if (item.timingKind === "begin_by") return `Begin by ${prettyDate(item.timingDate)}`;
  if (item.timingKind === "finish_by") return `Finish by ${prettyDate(item.timingDate)}`;
  if (item.timingKind === "window_end") return `Window ends ${prettyDate(item.timingDate)}`;
  return `Due ${prettyDate(item.timingDate)}`;
}

function OwnerWorkCard({ item }: { item: OwnerMyWorkItem }) {
  const content = (
    <>
      <div>
        <strong>{item.title}</strong>
        <span>{sourceLabel(item)}</span>
      </div>
      <em>{timingLabel(item)}</em>
      {item.detail ? <p>{item.detail}</p> : null}
    </>
  );
  const classes = `atlas-overview-task-card atlas-owner-task-card${item.isOverdue ? " atlas-owner-overdue-card" : ""}`;

  return <Link className={classes} href={item.href}>{content}</Link>;
}

function OwnerSection({ title, items, empty, badge = "My work" }: OwnerSectionProps) {
  return (
    <section className="atlas-overview-zone-card atlas-owner-section">
      <summary>
        <div><strong>{title}</strong><span>{items.length} {items.length === 1 ? "item" : "items"}</span></div>
        <b>{badge}</b>
      </summary>
      <div className="atlas-overview-task-list">
        {items.length
          ? items.map((item) => <OwnerWorkCard key={item.key} item={item} />)
          : <p className="atlas-task-page-muted">{empty}</p>}
      </div>
    </section>
  );
}

function FinishProjectStewardship({ project }: { project: OwnerFinishProjectSummary }) {
  const current = project.released[0] ?? null;
  const releaseLabel = current?.taskStatus === "done" ? "Completed today" : current ? "Released to Anna" : "No venue move released";
  return (
    <Link href={`/project/${encodeURIComponent(project.projectId)}`} className="atlas-overview-zone-card atlas-owner-section" style={{ display: "block", textDecoration: "none", color: "inherit", padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid rgba(0,0,0,.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
          <div><small style={{ textTransform: "uppercase", letterSpacing: ".08em", opacity: .58 }}>Venue stewardship</small><strong style={{ display: "block", marginTop: 4, fontSize: 19 }}>{project.projectTitle}</strong></div>
          <b style={{ whiteSpace: "nowrap" }}>{project.totalRemaining} remaining</b>
        </div>
      </div>
      <div style={{ padding: "14px 18px" }}>
        <small style={{ opacity: .62 }}>{releaseLabel}</small>
        {current ? <><strong style={{ display: "block", marginTop: 4 }}>{current.title}</strong><p style={{ margin: "5px 0 0", opacity: .72 }}>{current.minutes ? `${current.minutes} min · ` : ""}{current.taskStatus ? current.taskStatus.replaceAll("_", " ") : "in today's hand"}</p></> : <p style={{ margin: "5px 0 0", opacity: .72 }}>Atlas has not materialized a Finish Project move into Anna&apos;s day.</p>}
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

export default function OwnerDashboardClient({
  myWork,
  finishProject,
}: {
  myWork: OwnerMyWorkProjection;
  finishProject: OwnerFinishProjectSummary | null;
}) {
  const { counts, buckets } = myWork;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-owner-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">{myWork.farm.name}</span><span className="atlas-phone-title">Owner</span></Link>
          <span className="atlas-weather-line">{counts.all} mine · {counts.overdue} overdue</span>
          <Link href="/owner/members" className="atlas-note-plus atlas-overview-top-dot" aria-label="People and access">People</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-owner-body">
          <section className="atlas-overview-hero atlas-owner-hero">
            <div><strong>My Work</strong><span>{prettyDate(myWork.generatedForDate)}–{prettyDate(myWork.weekEndDate)}</span></div>
            <p>{counts.now} now · {counts.today} today · {counts.thisWeek} this week · {counts.waiting} waiting</p>
          </section>

          {myWork.principalSourceState === "unavailable" ? (
            <section className="atlas-overview-zone-card atlas-owner-section">
              <summary><div><strong>Principal work unavailable</strong><span>Farm tasks are still shown below</span></div><b>Source check</b></summary>
            </section>
          ) : null}

          <section className="atlas-overview-stat-grid" aria-label="My Work stats">
            <article><strong>{counts.all}</strong><span>mine</span></article>
            <article><strong>{counts.overdue}</strong><span>overdue</span></article>
            <article><strong>{counts.waiting}</strong><span>waiting</span></article>
            <article><strong>{counts.principalItems}</strong><span>Principal</span></article>
          </section>

          <section className="atlas-overview-zone-list atlas-owner-list" aria-label="My Work list">
            <OwnerSection title="Needs You Now" items={buckets.now} empty="Nothing from the Principal Clock needs you now." badge="Now" />
            <OwnerSection title="Today" items={buckets.today} empty="No work is due today." />
            <OwnerSection title="This Week" items={buckets.thisWeek} empty="No additional work is due this week." />
            <OwnerSection title="Waiting" items={buckets.waiting} empty="Nothing assigned to you is blocked." badge="Blocked" />
            <OwnerSection title="Backlog" items={buckets.backlog} empty="No open backlog." badge={counts.overdue ? `${counts.overdue} overdue` : "My work"} />
          </section>

          <section className="atlas-overview-zone-list atlas-owner-list" aria-label="Team and operations">
            <section className="atlas-overview-zone-card atlas-owner-section">
              <summary><div><strong>Team &amp; Operations</strong><span>Secondary to your own work</span></div><b>Manage</b></summary>
              <div className="atlas-overview-task-list">
                <Link className="atlas-overview-task-card atlas-owner-task-card" href="/owner/members"><div><strong>People &amp; access</strong><span>team</span></div><em>Open</em><p>Inspect people, roles and access without replacing your own work list.</p></Link>
                <Link className="atlas-overview-task-card atlas-owner-task-card" href="/principal"><div><strong>Principal office</strong><span>strategy and arbitration</span></div><em>Open</em><p>Capacity, portfolio, obligations and strategic context remain available without becoming the Owner task cockpit.</p></Link>
                <Link className="atlas-overview-task-card atlas-owner-task-card" href="/owner/lineage"><div><strong>Trail Lineage Audit</strong><span>owner evidence review</span></div><em>Open</em><p>Confirm or reject proposed links between completed records and earlier Trail points.</p></Link>
              </div>
            </section>
            {finishProject ? <FinishProjectStewardship project={finishProject} /> : null}
          </section>
        </div>
      </section>
    </main>
  );
}
