"use client";

import Link from "next/link";
import { useState } from "react";

import MaintenanceDirectiveStrip from "@/components/atlas/maintenance-directive-strip";
import TaskExecutionBrief from "@/components/atlas/task-execution-brief";
import TaskPrimaryResultControls from "@/components/atlas/task-primary-result-controls";
import styles from "./HarvestFocus.module.css";

export type MowingFocusTask = {
  id: string;
  title: string;
  dueDate: string | null;
  routeLabel: string;
  zoneLabel: string;
  equipmentGroup: string | null;
  targetCutHeightInches: number | null;
  rhythmState: string;
  warningAt: string | null;
  dueAt: string | null;
  failureAt: string | null;
  areaStatus: string;
  lastMowedAt: string | null;
  lastObservedAt: string | null;
  nextCheckDate: string | null;
  currentNote: string | null;
  canCloseRoute: boolean;
  returnTo?: string | null;
};

type Outcome = "mowed_full" | "mowed_partial" | "acceptable_no_cut" | "too_wet" | "equipment_or_area_problem" | "closed_not_mowable";

const unfinishedChoices: Array<{ value: Exclude<Outcome, "mowed_full" | "closed_not_mowable">; title: string; detail: string }> = [
  { value: "mowed_partial", title: "Partly mowed", detail: "Record what remains" },
  { value: "acceptable_no_cut", title: "Still acceptable", detail: "No cut needed today" },
  { value: "too_wet", title: "Too wet", detail: "Choose when to check again" },
  { value: "equipment_or_area_problem", title: "Problem found", detail: "Record the equipment or area problem" },
];

function prettyDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function tomorrowIso(days = 1) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function mowingPlace(task: MowingFocusTask) {
  if (task.routeLabel.toLowerCase().includes(task.zoneLabel.toLowerCase())) return task.routeLabel;
  return `${task.zoneLabel} · ${task.routeLabel}`;
}

export default function MowingFocusPage({ task }: { task: MowingFocusTask }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [completionPercent, setCompletionPercent] = useState("50");
  const [recheckDate, setRecheckDate] = useState(tomorrowIso(1));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const returnTo = task.returnTo || "/collections/mowing";
  const howLines = [
    task.equipmentGroup || "Use the route mower",
    task.targetCutHeightInches ? `Cut to ${task.targetCutHeightInches} in` : "Use the route standard height",
  ];
  const doneWhen = task.targetCutHeightInches
    ? `The whole ${task.routeLabel} route is cut to ${task.targetCutHeightInches} in.`
    : `The whole ${task.routeLabel} route is cut.`;

  async function save(selectedOutcome: Outcome) {
    const needsPercent = selectedOutcome === "mowed_partial";
    const needsRecheck = selectedOutcome === "acceptable_no_cut" || selectedOutcome === "too_wet";
    const needsNote = selectedOutcome === "mowed_partial" || selectedOutcome === "equipment_or_area_problem";
    const validPercent = Number.isInteger(Number(completionPercent)) && Number(completionPercent) >= 1 && Number(completionPercent) <= 99;
    const complete = (!needsPercent || validPercent) && (!needsRecheck || Boolean(recheckDate)) && (!needsNote || Boolean(note.trim()));
    if (!complete) {
      setMessage("Add the needed result detail before saving.");
      return;
    }

    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/mowing", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          outcome: selectedOutcome,
          completionPercent: needsPercent ? Number(completionPercent) : selectedOutcome === "mowed_full" ? 100 : null,
          recheckDate: needsRecheck ? recheckDate : null,
          note: note.trim() || null,
          idempotencyKey: `mowing:${task.id}:${selectedOutcome}:${Date.now()}`,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Mowing result failed.");
      window.location.assign(returnTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mowing result failed.");
    } finally {
      setSaving(false);
    }
  }

  const needsPercent = outcome === "mowed_partial";
  const needsRecheck = outcome === "acceptable_no_cut" || outcome === "too_wet";
  const needsNote = outcome === "mowed_partial" || outcome === "equipment_or_area_problem";

  return (
    <main className={styles.shell}>
      <header className={styles.top}>
        <Link href={returnTo} className={styles.brand}><small>Atlas</small><strong>Work</strong></Link>
        <Link href={returnTo} className={styles.close} aria-label="Close task">×</Link>
      </header>

      <div className={styles.body}>
        <article className={styles.ticket}>
          <TaskExecutionBrief
            doText={`Mow · ${task.routeLabel}`}
            placeText={mowingPlace(task)}
            howLines={howLines}
            doneWhen={doneWhen}
            dueLabel={task.dueDate ? `Due · ${prettyDate(task.dueDate)}` : null}
            details={null}
          />

          <MaintenanceDirectiveStrip taskId={task.id} />

          {task.lastMowedAt ? (
            <p className={styles.message}>Last full mow · {prettyDate(task.lastMowedAt)}</p>
          ) : null}

          <footer className="atlas-task-result-footer">
            <TaskPrimaryResultControls
              busy={saving}
              doneBusy={saving && outcome === "mowed_full"}
              unfinishedOpen={unfinishedOpen}
              onToggleUnfinished={() => {
                setUnfinishedOpen((open) => !open);
                setOutcome(null);
                setMessage(null);
              }}
              onDone={() => {
                setOutcome("mowed_full");
                void save("mowed_full");
              }}
            >
              <section className="atlas-task-unfinished-panel atlas-task-result-unfinished">
                <strong>What happened?</strong>
                <div className={styles.choices}>
                  {unfinishedChoices.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      className={styles.choice}
                      data-active={outcome === choice.value}
                      onClick={() => {
                        setOutcome(choice.value);
                        setMessage(null);
                      }}
                    >
                      <strong>{choice.title}</strong><span>{choice.detail}</span>
                    </button>
                  ))}
                </div>
              </section>
            </TaskPrimaryResultControls>

            {outcome && outcome !== "mowed_full" ? (
              <section className={styles.form}>
                {needsPercent ? <label><span>Percent of route finished</span><input inputMode="numeric" min="1" max="99" value={completionPercent} onChange={(event) => setCompletionPercent(event.target.value)} /></label> : null}
                {needsRecheck ? <label><span>Check again</span><input type="date" min={tomorrowIso(1)} value={recheckDate} onChange={(event) => setRecheckDate(event.target.value)} /></label> : null}
                <label><span>{needsNote ? "What remains or what is wrong?" : "Note (optional)"}</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
                <button type="button" className={styles.submit} disabled={saving} onClick={() => void save(outcome)}>{saving ? "Saving…" : "Save result"}</button>
              </section>
            ) : null}

            {task.canCloseRoute ? (
              <details className="atlas-task-more-outcomes">
                <summary><span>Management</span><b aria-hidden="true">⌄</b></summary>
                <div className="atlas-task-more-outcomes-body">
                  <button type="button" disabled={saving} onClick={() => void save("closed_not_mowable")}>Close this mowing route</button>
                </div>
              </details>
            ) : null}
          </footer>

          {task.currentNote ? <p className={styles.message}>Previous note · {task.currentNote}</p> : null}
          {message ? <p className={styles.message}>{message}</p> : null}
        </article>
      </div>
    </main>
  );
}
