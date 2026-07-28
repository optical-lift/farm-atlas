"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  AtlasAppShell,
  AtlasCard,
  AtlasSectionHeading,
  AtlasStateBadge,
  AtlasTopBar,
} from "@/components/atlas/ui/AtlasPrimitives";
import type {
  AtlasLineageAudit,
  AtlasLineageEvidenceItem,
} from "@/lib/atlas/lineage-audit";

import styles from "./lineage-audit.module.css";

type LineageResponse = {
  ok: boolean;
  audit?: AtlasLineageAudit;
  queued?: number;
  error?: string;
};

function prettyDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function titleCase(value: string | null | undefined) {
  return (value || "Trail work")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function evidenceState(item: AtlasLineageEvidenceItem) {
  if (item.status === "accepted") return "complete" as const;
  if (item.status === "rejected") return "quiet" as const;
  return "review" as const;
}

function evidenceStateLabel(item: AtlasLineageEvidenceItem) {
  if (item.status === "accepted") return "Confirmed";
  if (item.status === "rejected") return "Rejected";
  return "Review";
}

export default function AtlasLineageAuditClient({ initialAudit }: { initialAudit: AtlasLineageAudit }) {
  const [audit, setAudit] = useState(initialAudit);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const pending = useMemo(
    () => audit.items.filter((item) => item.status === "pending"),
    [audit.items],
  );
  const reviewed = useMemo(
    () => audit.items.filter((item) => item.status === "accepted" || item.status === "rejected"),
    [audit.items],
  );

  async function runAction(payload: Record<string, unknown>, key: string) {
    setBusyKey(key);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/atlas/owner/lineage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json() as LineageResponse;
      if (!response.ok || !data.ok || !data.audit) {
        throw new Error(data.error || "Trail lineage audit action failed.");
      }

      setAudit(data.audit);
      if (payload.action === "scan") {
        setMessage(data.queued
          ? `${data.queued} completed record${data.queued === 1 ? " was" : "s were"} queued for review.`
          : "No new deterministic history matches were found.");
      } else {
        setMessage(payload.decision === "accept"
          ? "Evidence confirmed and provenance recorded."
          : "Candidate rejected and will not be suggested again.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Trail lineage audit action failed.");
    } finally {
      setBusyKey(null);
    }
  }

  function review(item: AtlasLineageEvidenceItem, decision: "accept" | "reject") {
    return runAction({
      action: "review",
      evidenceId: item.evidenceId,
      decision,
      note: notes[item.evidenceId]?.trim() || undefined,
    }, `${decision}:${item.evidenceId}`);
  }

  return (
    <AtlasAppShell className={styles.shell}>
      <AtlasTopBar
        kicker="Owner"
        title="Trail Lineage"
        status={<span>{audit.summary.pending} awaiting review</span>}
        action={<Link href="/" className={styles.backLink}>Home</Link>}
      />

      <div className={styles.body}>
        <AtlasCard className={styles.intro} variant="cream">
          <span>Evidence audit</span>
          <strong>Connect old records without inventing history.</strong>
          <p>Atlas scans only completed project work already tied to a real project step and proposed Trail node. Nothing is confirmed until the owner reviews it.</p>
          <button
            type="button"
            onClick={() => runAction({ action: "scan" }, "scan")}
            disabled={busyKey !== null}
          >
            {busyKey === "scan" ? "Scanning…" : "Scan completed project records"}
          </button>
          {message ? <p className={styles.message}>{message}</p> : null}
          {error ? <p className={styles.error}>{error}</p> : null}
        </AtlasCard>

        <div className={styles.summary} aria-label="Trail lineage audit summary">
          <span><b>{audit.summary.pending}</b>pending</span>
          <span><b>{audit.summary.unresolvedNodes}</b>unresolved nodes</span>
          <span><b>{audit.summary.accepted}</b>confirmed</span>
          <span><b>{audit.summary.rejected}</b>rejected</span>
        </div>

        <AtlasCard as="section" className={styles.section} ariaLabelledBy="pending-lineage-title">
          <AtlasSectionHeading
            kicker="Owner review"
            title="Evidence Candidates"
            count={pending.length}
            id="pending-lineage-title"
          />

          {pending.length ? (
            <div className={styles.candidateList}>
              {pending.map((item) => {
                const confidence = Math.round(Number(item.confidence || 0) * 100);
                const projectHref = item.projectId ? `/project/${encodeURIComponent(item.projectId)}` : null;
                return (
                  <article className={styles.candidate} key={item.evidenceId}>
                    <header>
                      <div>
                        <span>{titleCase(item.workstream)} · {confidence}% match</span>
                        <strong>{item.projectTitle || item.profileLabel}</strong>
                      </div>
                      <AtlasStateBadge state="review">Review</AtlasStateBadge>
                    </header>

                    <div className={styles.route}>
                      <div>
                        <span>Source record</span>
                        <strong>{item.sourceTitle}</strong>
                        <small>{titleCase(item.sourceStatus)}{item.sourceDate ? ` · ${prettyDate(item.sourceDate)}` : ""}</small>
                      </div>
                      <b aria-hidden="true">→</b>
                      <div>
                        <span>Proposed Trail point</span>
                        <strong>{item.nodeLabel}</strong>
                        <small>{item.profileLabel}</small>
                      </div>
                    </div>

                    <p>{item.matchReason || "Existing project-step linkage"}</p>
                    {projectHref ? <Link href={projectHref} className={styles.projectLink}>Inspect project</Link> : null}

                    <textarea
                      value={notes[item.evidenceId] || ""}
                      onChange={(event) => setNotes((current) => ({
                        ...current,
                        [item.evidenceId]: event.target.value,
                      }))}
                      placeholder="Optional provenance note"
                      rows={2}
                    />

                    <footer>
                      <button
                        type="button"
                        className={styles.rejectButton}
                        onClick={() => review(item, "reject")}
                        disabled={busyKey !== null}
                      >
                        {busyKey === `reject:${item.evidenceId}` ? "Rejecting…" : "Reject match"}
                      </button>
                      <button
                        type="button"
                        className={styles.confirmButton}
                        onClick={() => review(item, "accept")}
                        disabled={busyKey !== null}
                      >
                        {busyKey === `accept:${item.evidenceId}` ? "Confirming…" : "Confirm evidence"}
                      </button>
                    </footer>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className={styles.empty}>No completed record is waiting for owner confirmation.</p>
          )}
        </AtlasCard>

        <AtlasCard as="section" className={styles.section} ariaLabelledBy="unresolved-lineage-title">
          <AtlasSectionHeading
            kicker="Missing history"
            title="Unresolved Earlier Nodes"
            count={audit.unresolvedNodes.length}
            id="unresolved-lineage-title"
          />
          <p className={styles.sectionLead}>These earlier Trail points do not have accepted evidence. Atlas leaves them open rather than filling them from later work.</p>
          {audit.unresolvedNodes.length ? (
            <div className={styles.unresolvedList}>
              {audit.unresolvedNodes.map((node) => (
                <Link
                  href={node.projectId ? `/project/${encodeURIComponent(node.projectId)}` : "/"}
                  key={`${node.trailBindingId}:${node.nodeKey}`}
                >
                  <span>{titleCase(node.workstream)} · {node.profileLabel}</span>
                  <strong>{node.nodeLabel}</strong>
                  <small>{node.projectTitle || titleCase(node.subjectKind)} · current point {titleCase(node.currentNodeKey)}</small>
                </Link>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>Every earlier Trail point has accepted evidence.</p>
          )}
        </AtlasCard>

        <AtlasCard as="section" className={styles.section} ariaLabelledBy="reviewed-lineage-title">
          <AtlasSectionHeading
            kicker="Provenance record"
            title="Reviewed Evidence"
            count={reviewed.length}
            id="reviewed-lineage-title"
          />
          {reviewed.length ? (
            <div className={styles.reviewedList}>
              {reviewed.slice(0, 30).map((item) => (
                <article key={item.evidenceId}>
                  <div>
                    <span>{item.projectTitle || item.profileLabel}</span>
                    <AtlasStateBadge state={evidenceState(item)}>{evidenceStateLabel(item)}</AtlasStateBadge>
                  </div>
                  <strong>{item.sourceTitle} → {item.nodeLabel}</strong>
                  <small>{prettyDate(item.confirmedAt || item.occurredAt)}{item.reviewNote ? ` · ${item.reviewNote}` : ""}</small>
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>No lineage candidate has been reviewed yet.</p>
          )}
        </AtlasCard>
      </div>
    </AtlasAppShell>
  );
}
