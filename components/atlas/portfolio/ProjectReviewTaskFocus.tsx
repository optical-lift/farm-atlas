"use client";

import Link from "next/link";
import { useState } from "react";

import type { AtlasProjectTaskFocus } from "@/lib/atlas/portfolio";
import styles from "./ProjectReviewTaskFocus.module.css";

type Outcome = "on_track" | "next_move_changed" | "waiting_external" | "blocked" | "complete";

type Props = {
  focus: AtlasProjectTaskFocus;
  returnTo?: string | null;
};

const choices: Array<{ value: Outcome; title: string; detail: string }> = [
  { value: "on_track", title: "On track", detail: "Keep the current move and cadence" },
  { value: "next_move_changed", title: "Change the current move", detail: "Record what the project should do next" },
  { value: "waiting_external", title: "Waiting on someone or something", detail: "Keep the project active and set a review date" },
  { value: "blocked", title: "Blocked", detail: "Record the blocker and return date" },
  { value: "complete", title: "Project complete", detail: "Close the project and pause its review Clock" },
];

function tomorrowIso(days = 1) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function prettyDate(value: string | null | undefined) {
  if (!value) return "No date";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ProjectReviewTaskFocus({ focus, returnTo }: Props) {
  const task = focus.task;
  const project = focus.project;
  const destination = returnTo || `/project/${encodeURIComponent(project.projectId)}`;
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [nextMilestone, setNextMilestone] = useState(project.currentMilestone || "");
  const [nextReviewDate, setNextReviewDate] = useState(tomorrowIso(2));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const changesMove = outcome === "next_move_changed";
  const needsReturn = outcome === "waiting_external" || outcome === "blocked";
  const needsNote = needsReturn;
  const complete = Boolean(outcome)
    && (!changesMove || Boolean(nextMilestone.trim()))
    && (!needsReturn || Boolean(nextReviewDate))
    && (!needsNote || Boolean(note.trim()));

  async function submit() {
    if (!outcome || !complete) return;
    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/project-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: "review",
          taskId: task.taskId,
          outcome,
          nextMilestone: changesMove ? nextMilestone.trim() : null,
          nextReviewDate: needsReturn ? nextReviewDate : null,
          note: note.trim() || null,
          idempotencyKey: `project-review:${task.taskId}:${outcome}:${Date.now()}`,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Project review failed.");

      if (outcome === "on_track") setMessage("Project reviewed and left on track.");
      else if (outcome === "next_move_changed") setMessage("Project reviewed and its current move changed.");
      else if (outcome === "waiting_external") setMessage(`Waiting state recorded. Atlas will return this project ${prettyDate(nextReviewDate)}.`);
      else if (outcome === "blocked") setMessage(`Blocker recorded. Atlas will return this project ${prettyDate(nextReviewDate)}.`);
      else setMessage("Project completed and its review Clock paused.");
      window.setTimeout(() => window.location.assign(destination), 1100);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project review failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.top}>
        <Link href={destination} className={styles.brand}><small>Atlas</small><strong>Project review</strong></Link>
        <Link href={destination} className={styles.close} aria-label="Close project review">×</Link>
      </header>

      <div className={styles.body}>
        <article className={styles.ticket}>
          <section className={styles.hero}>
            <div><span>Owner decision</span><span>{prettyDate(task.dueDate)}</span></div>
            <h1>{project.title}</h1>
            <p>{project.farmName || focus.organizationName}</p>
          </section>

          <section className={styles.facts}>
            <div className={styles.wide}><small>What time means</small><strong>The Owner’s review point arrived. Time does not decide whether this project is healthy, moving, blocked, or complete.</strong></div>
            <div><small>Current health</small><strong>{project.health.replaceAll("_", " ")}</strong></div>
            <div><small>Current move</small><strong>{project.currentMilestone || "Not recorded"}</strong></div>
          </section>

          <section className={styles.prompt}>
            <small>What is true now?</small>
            <h2>Review the project, then record the decision.</h2>
            <p>The result changes the canonical project itself. This is not a separate reminder status.</p>
          </section>

          <div className={styles.choices}>
            {choices.map((choice) => (
              <button key={choice.value} type="button" data-active={outcome === choice.value} onClick={() => setOutcome(choice.value)}>
                <strong>{choice.title}</strong><span>{choice.detail}</span>
              </button>
            ))}
          </div>

          {outcome ? (
            <section className={styles.form}>
              {changesMove ? <label><span>New current move</span><input value={nextMilestone} onChange={(event) => setNextMilestone(event.target.value)} placeholder="What should move next?" /></label> : null}
              {needsReturn ? <label><span>Review again</span><input type="date" min={tomorrowIso(1)} value={nextReviewDate} onChange={(event) => setNextReviewDate(event.target.value)} /></label> : null}
              <label><span>{needsNote ? "What is it waiting on or what is blocked?" : "Review note (optional)"}</span><textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record the decision in plain language." /></label>
              <button type="button" disabled={saving || !complete} onClick={() => void submit()}>{saving ? "Recording…" : "Record project review"}</button>
              {!complete ? <p>Complete the required review details before recording.</p> : null}
              {message ? <p className={styles.message}>{message}</p> : null}
            </section>
          ) : null}
        </article>
      </div>
    </main>
  );
}
