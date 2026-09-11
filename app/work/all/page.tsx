import Link from "next/link";

import { getMyCompanyWorkResponsibilities, type CompanyWorkResponsibility } from "@/lib/atlas-data/company-work-self";
import { requireAtlasRole } from "@/lib/atlas/role-access";
import styles from "../today/work.module.css";

export const dynamic = "force-dynamic";

function taskFocusHref(taskId: string) {
  return `/task-focus/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent("/work/all")}`;
}

function prettyTarget(value: string | null, fallbackDate: string | null) {
  const source = value ?? (fallbackDate ? `${fallbackDate}T12:00:00` : null);
  if (!source) return "No target date";
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return fallbackDate ?? "Target recorded";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}

function stateLabel(item: CompanyWorkResponsibility) {
  if (item.attentionLeaseId) {
    if (item.attentionLeaseState === "interrupted") return "In your hand · interrupted";
    return "In your hand";
  }
  if (item.executionState === "ready") return "Ready";
  if (item.executionState === "waiting") return "Waiting";
  if (item.executionState === "needs_resolution") return "Needs resolution";
  return "Company work";
}

function ResponsibilityCard({ item }: { item: CompanyWorkResponsibility }) {
  return (
    <article className={styles.task} data-responsibility-state={item.executionState} data-focused={item.attentionLeaseId ? "true" : undefined}>
      <div className={styles.taskTop}>
        <h3>{item.legacyTaskId ? <Link href={taskFocusHref(item.legacyTaskId)}>{item.title}</Link> : item.title}</h3>
        <span className={styles.date}>{prettyTarget(item.nextTargetAt, item.legacyTaskDueDate)}</span>
      </div>
      <p className={styles.progress} style={{ marginTop: 6, fontWeight: 700 }}>{stateLabel(item)}</p>
      <p className={styles.location}>{item.organizationName}{item.organizationUnitName ? ` · ${item.organizationUnitName}` : ""}</p>
      {item.instructions ? <p className={styles.instruction}>{item.instructions}</p> : null}
      {item.executionReason ? <p className={styles.instruction}>{item.executionReason.replaceAll("_", " ")}</p> : null}
      {item.legacyTaskId ? <Link href={taskFocusHref(item.legacyTaskId)} className={styles.openTask}>Open task</Link> : null}
    </article>
  );
}

function ResponsibilitySection({ title, items }: { title: string; items: CompanyWorkResponsibility[] }) {
  if (!items.length) return null;
  return (
    <section className={styles.section} data-responsibility-section={title.toLowerCase().replaceAll(" ", "-")}>
      <div className={styles.sectionHeader}><h2>{title}</h2><span>{items.length}</span></div>
      <div className={styles.list}>{items.map((item) => <ResponsibilityCard key={item.workItemId} item={item} />)}</div>
    </section>
  );
}

export default async function AllWorkPage() {
  await requireAtlasRole(["owner", "manager", "farm_hand"]);
  const responsibilities = await getMyCompanyWorkResponsibilities();

  const focused = responsibilities.filter((item) => Boolean(item.attentionLeaseId));
  const ready = responsibilities.filter((item) => !item.attentionLeaseId && item.executionState === "ready");
  const waiting = responsibilities.filter((item) => !item.attentionLeaseId && item.executionState === "waiting");
  const needsResolution = responsibilities.filter((item) => !item.attentionLeaseId && item.executionState === "needs_resolution");
  const institutional = responsibilities.filter((item) => !item.attentionLeaseId && !["ready", "waiting", "needs_resolution"].includes(item.executionState));

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="all-work-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>My work · complete responsibility register</p>
            <h1 id="all-work-title">Everything I’m responsible for</h1>
            <p className={styles.identity}>Atlas can change what it puts in your hand. It cannot make unfinished responsibility disappear from this register.</p>
          </div>
          <Link className={styles.back} href="/work/today">Today</Link>
        </header>

        <section className={styles.summary} aria-label="Responsibility summary">
          <article><strong>{responsibilities.length}</strong><span>open</span></article>
          <article><strong>{focused.length}</strong><span>in your hand</span></article>
          <article><strong>{ready.length}</strong><span>ready</span></article>
          <article><strong>{waiting.length + needsResolution.length}</strong><span>need something</span></article>
        </section>

        {responsibilities.length ? (
          <>
            <ResponsibilitySection title="In your hand" items={focused} />
            <ResponsibilitySection title="Ready next" items={ready} />
            <ResponsibilitySection title="Waiting" items={waiting} />
            <ResponsibilitySection title="Needs resolution" items={needsResolution} />
            <ResponsibilitySection title="Other company work" items={institutional} />
          </>
        ) : (
          <section className={styles.emptyState}>
            <h2>No open responsibilities</h2>
            <p>Atlas has no active Company Work allocation assigned to you.</p>
          </section>
        )}
      </section>
    </main>
  );
}
