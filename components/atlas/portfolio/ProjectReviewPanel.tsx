"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "./ProjectReviewPanel.module.css";

type LastReview = {
  outcome: string;
  reviewedAt: string;
  nextReviewDate: string | null;
  note: string | null;
  nextMilestone: string | null;
};

type Dashboard = {
  ok?: boolean;
  error?: string;
  projectId: string;
  projectTitle: string;
  projectKind: string;
  farmId: string | null;
  configured: boolean;
  supported: boolean;
  unsupportedReason: string | null;
  canConfigure: boolean;
  stateId: string | null;
  state: string | null;
  warningAt: string | null;
  dueAt: string | null;
  failureAt: string | null;
  currentTaskId: string | null;
  bindingActive: boolean;
  ruleVersion: number | null;
  cadenceDays: number | null;
  warningDays: number | null;
  graceDays: number | null;
  lastReview: LastReview | null;
  project: {
    status: string;
    health: string;
    currentMilestone: string | null;
    lastMovementAt: string | null;
  };
};

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function prettyDate(value: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function stateLabel(value: string | null) {
  if (value === "resting") return "In rhythm";
  if (value === "coming_due") return "Coming due";
  if (value === "due") return "Review due";
  if (value === "fallen_out_of_rhythm") return "Review missed";
  if (value === "recovering") return "Recovering";
  if (value === "paused") return "Paused";
  return "Waiting for first review";
}

export default function ProjectReviewPanel({ projectId }: { projectId: string }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cadenceDays, setCadenceDays] = useState("");
  const [warningDays, setWarningDays] = useState("");
  const [graceDays, setGraceDays] = useState("");
  const [firstReviewDate, setFirstReviewDate] = useState("");
  const [reason, setReason] = useState("");

  async function load() {
    try {
      setLoading(true);
      setMessage(null);
      const response = await fetch(`/api/atlas/project-review?projectId=${encodeURIComponent(projectId)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const data = await response.json() as Dashboard;
      if (!response.ok || !data.ok) throw new Error(data.error || "Project review status failed.");
      setDashboard(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project review status failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [projectId]);

  const valid = Boolean(
    Number.isInteger(Number(cadenceDays))
    && Number(cadenceDays) >= 1
    && Number.isInteger(Number(warningDays))
    && Number(warningDays) >= 0
    && Number(warningDays) < Number(cadenceDays)
    && Number.isInteger(Number(graceDays))
    && Number(graceDays) >= 0
    && firstReviewDate
    && reason.trim(),
  );

  async function configure() {
    if (!valid) return;
    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/project-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: "configure",
          projectId,
          cadenceDays: Number(cadenceDays),
          warningDays: Number(warningDays),
          graceDays: Number(graceDays),
          firstReviewDate,
          reason: reason.trim(),
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Project review configuration failed.");
      setMessage("Project review rhythm activated.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project review configuration failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className={styles.panel}><p>Loading project review…</p></section>;
  if (!dashboard) return <section className={styles.panel}><p>{message || "Project review is unavailable."}</p></section>;

  if (!dashboard.supported) {
    return (
      <section className={styles.panel}>
        <header><div><small>Owner rhythm</small><strong>Project review</strong></div><span>Not enrolled</span></header>
        <p>{dashboard.unsupportedReason || "This project is outside the farm review Clock."}</p>
        <p className={styles.quiet}>Atlas will not invent a host farm or cadence for a cross-farm project.</p>
      </section>
    );
  }

  if (dashboard.configured) {
    return (
      <section className={styles.panel} data-state={dashboard.state || "uninitialized"}>
        <header>
          <div><small>Owner rhythm · Rule v{dashboard.ruleVersion}</small><strong>Project review</strong></div>
          <span>{stateLabel(dashboard.state)}</span>
        </header>
        <div className={styles.metrics}>
          <span><small>Cadence</small><strong>{dashboard.cadenceDays} days</strong></span>
          <span><small>Next review</small><strong>{prettyDate(dashboard.dueAt)}</strong></span>
          <span><small>Project health</small><strong>{dashboard.project.health.replaceAll("_", " ")}</strong></span>
        </div>
        <p>Time can require an Owner decision. It cannot decide that the project is moving, waiting, blocked, or complete.</p>
        {dashboard.lastReview ? <p className={styles.quiet}>Last review: {dashboard.lastReview.outcome.replaceAll("_", " ")} · {prettyDate(dashboard.lastReview.reviewedAt)}</p> : null}
        <div className={styles.actions}>
          {dashboard.currentTaskId ? <Link href={`/task-focus/${encodeURIComponent(dashboard.currentTaskId)}?returnTo=${encodeURIComponent(`/project/${projectId}`)}`}>Open review</Link> : <span>{dashboard.state === "due" ? "Review is waiting behind the work-capacity gate." : "No review card is released."}</span>}
          <Link href="/manage/rhythms">Rulebook controls</Link>
        </div>
        {message ? <p className={styles.message}>{message}</p> : null}
      </section>
    );
  }

  if (!dashboard.canConfigure) return null;

  return (
    <details className={styles.panel}>
      <summary>
        <div><small>Owner rhythm</small><strong>Configure project review</strong></div>
        <span>Not configured</span>
      </summary>
      <div className={styles.body}>
        <p>Choose how often this project must be deliberately reviewed. Atlas will not guess a cadence from its age, task count, or target date.</p>
        <div className={styles.grid}>
          <label><span>Review every</span><div><input inputMode="numeric" value={cadenceDays} onChange={(event) => setCadenceDays(event.target.value)} placeholder="days" /><em>days</em></div></label>
          <label><span>Warn this many days before</span><input inputMode="numeric" value={warningDays} onChange={(event) => setWarningDays(event.target.value)} placeholder="0 or more" /></label>
          <label><span>Grace after missed review</span><div><input inputMode="numeric" value={graceDays} onChange={(event) => setGraceDays(event.target.value)} placeholder="days" /><em>days</em></div></label>
          <label><span>First review date</span><input type="date" min={todayIso()} value={firstReviewDate} onChange={(event) => setFirstReviewDate(event.target.value)} /></label>
        </div>
        <label className={styles.reason}><span>Why does this project need this rhythm?</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Record the Owner rule in plain language." /></label>
        <button type="button" disabled={saving || !valid} onClick={() => void configure()}>{saving ? "Activating…" : "Activate review rhythm"}</button>
        {!valid ? <p className={styles.quiet}>Enter an explicit cadence, warning, grace period, first review date, and Owner reason.</p> : null}
        {message ? <p className={styles.message}>{message}</p> : null}
      </div>
    </details>
  );
}
