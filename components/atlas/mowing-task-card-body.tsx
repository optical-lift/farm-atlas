"use client";

import { useState } from "react";

import type { MowingCardViewModel } from "@/lib/atlas/mowing-card-view-model";

import styles from "./mowing-task-card-body.module.css";

function dateLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function resourceStateLabel(value: string | null | undefined) {
  const state = value?.trim().toLowerCase();
  if (!state) return null;
  if (state === "needs_repair") return "Needs repair";
  if (state === "available" || state === "ready") return "Ready";
  if (state === "needs_check" || state === "unknown") return "Needs a readiness check";
  return state.replaceAll("_", " ");
}

type Props = {
  card: MowingCardViewModel;
  resourceLabel?: string | null;
  resourceStatus?: string | null;
  issueChoices?: string[];
  issueDisabled?: boolean;
  showRecurrence?: boolean;
  onEquipmentIssue?: (issue: string, note: string) => void | Promise<void>;
};

export default function MowingTaskCardBody({
  card,
  resourceLabel = null,
  resourceStatus = null,
  issueChoices = [],
  issueDisabled = false,
  showRecurrence = true,
  onEquipmentIssue,
}: Props) {
  const [selectedIssue, setSelectedIssue] = useState("");
  const [issueNote, setIssueNote] = useState("");
  const last = dateLabel(card.recurrence.last);
  const current = dateLabel(card.recurrence.current);
  const next = dateLabel(card.recurrence.next);
  const resourceState = resourceStateLabel(resourceStatus);

  return (
    <>
      {showRecurrence ? (
        <div className={styles.trail} data-has-next={next ? "true" : "false"} aria-label={`${card.route} mowing recurrence`}>
          <span className={styles.done}><b>Mowed</b><small>{last || "Not recorded"}</small></span>
          <span className={styles.now}><b>Mow</b><small>{current || "Current"}</small></span>
          {next ? <span className={styles.next}><b>Next mow</b><small>{next}</small></span> : null}
        </div>
      ) : null}

      <section className={styles.height}>
        <span>Mow height</span>
        <strong>{card.height.label}</strong>
      </section>

      {card.equipment.label ? (
        <section className={styles.tools}>
          <div className={styles.equipmentSection}>
            <header className={styles.equipmentHeader}><h3>{card.equipment.label}</h3></header>
            {resourceLabel ? (
              <div className={styles.resourceRow}>
                <div><strong>{resourceLabel}</strong>{resourceState ? <small>{resourceState}</small> : null}</div>
              </div>
            ) : null}

            {issueChoices.length && onEquipmentIssue ? (
              <details className={styles.issueDrawer}>
                <summary aria-label={`Log an issue with ${card.equipment.label}`} title={`Log an issue with ${card.equipment.label}`}>
                  <span aria-hidden="true">+</span>
                </summary>
                <div className={styles.issuePanel}>
                  <div className={styles.issuePills}>
                    {issueChoices.map((issue) => (
                      <button
                        key={issue}
                        type="button"
                        disabled={issueDisabled}
                        data-active={selectedIssue === issue}
                        onClick={() => setSelectedIssue(issue)}
                      >
                        {issue}
                      </button>
                    ))}
                  </div>
                  <label><span>Note</span><input type="text" disabled={issueDisabled} value={issueNote} onChange={(event) => setIssueNote(event.target.value)} placeholder="What happened?" /></label>
                  <button
                    type="button"
                    className={styles.reportIssue}
                    disabled={issueDisabled || !selectedIssue}
                    onClick={() => void onEquipmentIssue(selectedIssue, issueNote.trim())}
                  >
                    Report problem
                  </button>
                </div>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
