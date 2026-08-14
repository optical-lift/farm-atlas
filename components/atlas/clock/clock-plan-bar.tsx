"use client";

import type { AtlasClockDraftSummary } from "@/lib/atlas/clock-plan-draft";
import styles from "./clock-surface-v2.module.css";

export default function ClockPlanBar(props: {
  open: boolean;
  summary: AtlasClockDraftSummary | null;
  committing: boolean;
  onOpen: () => void;
  onAcceptAll: () => void;
  onReset: () => void;
  onCancel: () => void;
  onCommit: () => void;
}) {
  return <section className={`${styles.taskShell} ${styles.ownerPlanBar}`} data-clock-owner-proposal-gate="true">
    <div>
      <small className={styles.ownerPlanKicker}>OWNER PLAN</small>
      <strong>{props.open ? "Clock draft" : "Let Atlas arrange the Clock"}</strong>
      <span>{props.open && props.summary
        ? `${props.summary.acceptedProposalCount} proposed selected · ${props.summary.changedCommittedCount} white edits${props.summary.warningCount ? ` · ${props.summary.warningCount} warnings` : ""}. Nothing here changes Anna's Clock until Commit plan.`
        : "Use the committed Day, exact constraints, durations, and existing Clock blocks to sketch a plausible time plan."}</span>
    </div>
    {!props.open ? <button type="button" onClick={props.onOpen}>Plan this Clock</button> : <div className={styles.ownerPlanActions}>
      <button type="button" onClick={props.onAcceptAll}>Use whole plan</button>
      <button type="button" onClick={props.onReset}>Reset</button>
      <button type="button" onClick={props.onCancel}>Cancel</button>
      <button type="button" className={styles.planPrimary} disabled={props.committing || !props.summary?.changeCount || Boolean(props.summary?.unresolvedWarningCount)} onClick={props.onCommit}>{props.committing ? "Committing…" : "Commit plan"}</button>
    </div>}
  </section>;
}
