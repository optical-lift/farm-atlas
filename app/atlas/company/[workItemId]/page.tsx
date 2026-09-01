import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { atlasFarmDateLabel } from "@/lib/atlas/farm-day";
import { readSelfCompanyResponsibilities } from "@/lib/atlas/person-atlas-server";
import { getAtlasSession } from "@/lib/atlas/session";

import styles from "../../person-atlas-form.module.css";

export const dynamic = "force-dynamic";

function displayState(value: string | null | undefined) {
  return value?.trim().replaceAll("_", " ") || "unassessed";
}

export default async function CompanyResponsibilityPage({ params }: { params: Promise<{ workItemId: string }> }) {
  const session = await getAtlasSession();
  if (!session) redirect("/login");

  const { workItemId } = await params;
  const responsibilities = await readSelfCompanyResponsibilities();
  const responsibility = responsibilities.find((candidate) => candidate.work_item_id === workItemId);
  if (!responsibility) notFound();

  const jurisdiction = responsibility.organization_unit_name
    ? `${responsibility.organization_name} · ${responsibility.organization_unit_name}`
    : responsibility.organization_name;
  const targetDate = responsibility.next_target_at ?? responsibility.legacy_task_due_date;
  const waitingReason = responsibility.execution_reason?.trim().replaceAll("_", " ") || null;

  return (
    <main className={styles.root}>
      <section className={styles.sheet}>
        <Link className={styles.back} href="/atlas">← Atlas overview</Link>
        <p className={styles.kicker}>Company responsibility · read only</p>
        <h1 className={styles.title}>{responsibility.title}</h1>
        {responsibility.instructions ? <p className={styles.intro}>{responsibility.instructions}</p> : null}
        <dl className={styles.factList}>
          <div><dt>Jurisdiction</dt><dd>{jurisdiction}</dd></div>
          <div><dt>Authority</dt><dd>Company Work responsibility allocation</dd></div>
          <div><dt>Responsibility</dt><dd>Allocated to you</dd></div>
          <div><dt>Work state</dt><dd>{displayState(responsibility.work_state)}</dd></div>
          <div><dt>Execution</dt><dd>{displayState(responsibility.execution_state)}</dd></div>
          {targetDate ? <div><dt>Next target</dt><dd>{atlasFarmDateLabel(targetDate.slice(0, 10), { month: "short", day: "numeric", year: "numeric" })}</dd></div> : null}
          {waitingReason ? <div><dt>Why waiting</dt><dd>{waitingReason}</dd></div> : null}
        </dl>
        <p className={styles.intro}>This page is awareness, not a work queue. Atlas decides when executable work is released into Today and your Day.</p>
        <div className={styles.actions}>
          <Link className={styles.secondaryButton} href="/atlas/today">See Today</Link>
          <Link className={styles.secondaryButton} href="/day">Open released work</Link>
        </div>
      </section>
    </main>
  );
}
