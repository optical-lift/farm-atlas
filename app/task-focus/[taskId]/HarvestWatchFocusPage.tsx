"use client";

import { useMemo, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import styles from "./HarvestFocus.module.css";

export type HarvestWatchTask = {
  id: string;
  cropLabel: string;
  variety: string | null;
  objectLabel: string;
  dueDate: string | null;
  cycleState: string | null;
  expectedHarvestStart: string | null;
  expectedHarvestEnd: string | null;
  returnTo?: string | null;
};

type Action = "not_ready" | "beginning" | "harvestable" | "declining" | "finished" | "problem_or_uncertain";

const choices: Array<{ action: Action; title: string; detail: string; tone?: string }> = [
  { action: "not_ready", title: "Not ready", detail: "Nothing usable yet" },
  { action: "beginning", title: "Beginning", detail: "First buds, pods, fruit, or stems" },
  { action: "harvestable", title: "Harvestable now", detail: "Release real harvest work", tone: "ready" },
  { action: "declining", title: "Declining", detail: "Some remains, but the window is closing" },
  { action: "finished", title: "Finished", detail: "No more useful harvest expected" },
  { action: "problem_or_uncertain", title: "Problem or uncertain", detail: "Return this crop to the Owner", tone: "problem" },
];

function prettyDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function prettyRange(start: string | null, end: string | null) {
  const first = prettyDate(start);
  const last = prettyDate(end);
  if (first && last) return `${first}–${last}`;
  return first || last || "window open";
}

function tomorrowIso(days = 1) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function displayCrop(task: HarvestWatchTask) {
  if (!task.variety) return task.cropLabel;
  return task.variety.toLowerCase().includes(task.cropLabel.toLowerCase()) ? task.variety : `${task.variety} ${task.cropLabel}`;
}

function finishLabel(action: Action | null) {
  if (action === "harvestable") return "Record harvestable now";
  if (action === "not_ready") return "Record not ready";
  if (action === "beginning") return "Record beginning";
  if (action === "declining") return "Record declining";
  if (action === "finished") return "Record finished";
  if (action === "problem_or_uncertain") return "Return to Owner";
  return "Choose what is physically true";
}

export default function HarvestWatchFocusPage({ task }: { task: HarvestWatchTask }) {
  const [action, setAction] = useState<Action | null>(null);
  const [recheckDate, setRecheckDate] = useState(tomorrowIso(1));
  const [estimatedQuantity, setEstimatedQuantity] = useState("");
  const [unit, setUnit] = useState("stems");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const needsRecheck = action === "not_ready" || action === "beginning" || action === "declining";
  const needsEstimate = action === "harvestable";
  const needsNote = action === "problem_or_uncertain";
  const returnTo = task.returnTo || (task.dueDate ? `/day?date=${encodeURIComponent(task.dueDate)}` : "/");
  const crop = useMemo(() => displayCrop(task), [task]);
  const canSubmit = Boolean(action) && (!needsNote || Boolean(note.trim())) && (!needsRecheck || Boolean(recheckDate));
  const trail = [
    { label: "Crop", detail: task.cycleState?.replaceAll("_", " ") || "active", state: "done" },
    { label: "Harvest watch", detail: prettyRange(task.expectedHarvestStart, task.expectedHarvestEnd), state: "done" },
    { label: "Observe", detail: "today", state: "now" },
    { label: "Harvest", detail: "if ready", state: "later" },
    { label: "Next phase", detail: "when harvest closes", state: "later" },
  ] as const;

  async function submit() {
    if (!action || !canSubmit) return;
    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/harvest-watch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          action,
          estimatedQuantity: needsEstimate && estimatedQuantity.trim() ? estimatedQuantity : null,
          unit: needsEstimate && estimatedQuantity.trim() ? unit : null,
          recheckDate: needsRecheck ? recheckDate : null,
          note: note.trim() || null,
          idempotencyKey: `harvest-watch:${task.id}:${action}:${Date.now()}`,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string; nextDate?: string; harvest?: { action?: string } };
      if (!response.ok || !data.ok) throw new Error(data.error || "Harvest observation failed.");
      if (action === "harvestable") {
        setMessage(data.harvest?.action === "planned_awaiting_capacity" ? "Harvest is ready. Atlas preserved the harvest move behind the work-capacity gate." : "Harvest is ready. The harvest move is now in Atlas.");
      } else if (action === "finished") {
        setMessage("Harvest watch closed. Atlas will keep the crop available for closeout rather than creating another watch.");
      } else if (action === "problem_or_uncertain") {
        setMessage("Returned to the Owner for review.");
      } else {
        setMessage(`Observation recorded. Check again ${prettyDate(data.nextDate ?? recheckDate) || recheckDate}.`);
      }
      window.setTimeout(() => window.location.assign(returnTo), 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Harvest observation failed.");
    } finally {
      setSaving(false);
    }
  }

  const completion = (
    <div className={styles.finish}>
      <span>Finish Harvest Watch</span>
      <button type="button" className={styles.primaryFinish} disabled={saving || !canSubmit} onClick={() => void submit()}>
        {saving ? "Recording…" : finishLabel(action)}
      </button>
      {message ? <p className={styles.message}>{message}</p> : null}
    </div>
  );

  return (
    <main className={styles.shell} data-atlas-harvest-card="watch">
      <div className={styles.body}>
        <AtlasTaskCardFrame
          family="Harvest"
          familyDetail="crop-cycle truth"
          title={crop}
          subtitle={task.objectLabel}
          timing={task.dueDate ? `Harvest watch · ${prettyDate(task.dueDate)}` : "Harvest watch"}
          completion={completion}
        >
          <div className={styles.trail} aria-label={`${crop} harvest continuity`}>
            {trail.map((step) => <span key={`${step.label}-${step.detail}`} data-state={step.state}><b>{step.label}</b><small>{step.detail}</small></span>)}
          </div>

          <section className={styles.cropTruth}>
            <div><span>Crop now</span><strong>{task.cycleState?.replaceAll("_", " ") || "Harvest watch"}</strong></div>
            <div className={styles.cropFacts}>
              <b>Watch window · {prettyRange(task.expectedHarvestStart, task.expectedHarvestEnd)}</b>
              <b>Look now; the date does not claim readiness</b>
            </div>
          </section>

          <section className={styles.sharedTruth}>
            <div><span>Harvest board</span><strong>Same crop · one crop-cycle record</strong></div>
            <p>This observation changes the same crop truth that releases Harvest. Atlas does not create a second Worker-facing version of the crop.</p>
          </section>

          <section className={styles.results}>
            <header><span>What is physically true?</span><small>Choose the crop state, not a generic completion.</small></header>
            <div className={styles.resultGrid}>
              {choices.map((choice) => (
                <button key={choice.action} type="button" data-active={action === choice.action ? "true" : "false"} data-tone={choice.tone} onClick={() => { setAction(choice.action); setMessage(null); }}>
                  <strong>{choice.title}</strong><span>{choice.detail}</span>
                </button>
              ))}
            </div>
          </section>

          {action ? (
            <section className={styles.form}>
              {needsRecheck ? <label><span>Check again</span><input type="date" min={tomorrowIso(1)} value={recheckDate} onChange={(event) => setRecheckDate(event.target.value)} /></label> : null}
              {needsEstimate ? (
                <div className={styles.row}>
                  <label><span>Rough amount ready</span><input inputMode="decimal" placeholder="Optional" value={estimatedQuantity} onChange={(event) => setEstimatedQuantity(event.target.value)} /></label>
                  <label><span>Unit</span><select value={unit} onChange={(event) => setUnit(event.target.value)}><option value="stems">stems</option><option value="pods">pods</option><option value="fruit">fruit</option><option value="bunches">bunches</option><option value="pounds">pounds</option><option value="plants">plants</option></select></label>
                </div>
              ) : null}
              <label><span>{needsNote ? "What is wrong or uncertain?" : "Note (optional)"}</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder={needsNote ? "Describe what you can actually see." : "Anything the next person should know."} /></label>
            </section>
          ) : null}
        </AtlasTaskCardFrame>
      </div>
    </main>
  );
}
