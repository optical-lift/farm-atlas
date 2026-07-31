"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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
  { action: "beginning", title: "Beginning", detail: "First buds, pods, or stems" },
  { action: "harvestable", title: "Harvestable now", detail: "Release real harvest work", tone: "ready" },
  { action: "declining", title: "Declining", detail: "Some remains, but the window is closing" },
  { action: "finished", title: "Finished", detail: "No more useful harvest expected" },
  { action: "problem_or_uncertain", title: "Problem or uncertain", detail: "Return this crop to the Owner", tone: "problem" },
];

function prettyDate(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

  async function submit() {
    if (!action) return;
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
        setMessage(data.harvest?.action === "planned_awaiting_capacity" ? "Harvest is ready. Atlas preserved the harvest move behind the work-capacity gate." : "Harvest is ready. The harvest-and-count move is now in Atlas.");
      } else if (action === "finished") {
        setMessage("Harvest watch closed. Atlas will keep the crop available for closeout rather than creating another watch.");
      } else if (action === "problem_or_uncertain") {
        setMessage("Returned to the Owner for review.");
      } else {
        setMessage(`Observation recorded. Check again ${prettyDate(data.nextDate ?? recheckDate)}.`);
      }
      window.setTimeout(() => window.location.assign(returnTo), 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Harvest observation failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.top}>
        <Link href={returnTo} className={styles.brand}><small>Atlas</small><strong>Harvest Watch</strong></Link>
        <Link href={returnTo} className={styles.close} aria-label="Close harvest watch">×</Link>
      </header>

      <div className={styles.body}>
        <article className={styles.ticket}>
          <section className={styles.hero}>
            <div className={styles.kicker}><span>Field observation</span><span>{prettyDate(task.dueDate)}</span></div>
            <h1>{crop}</h1>
            <p>{task.objectLabel}</p>
          </section>

          <section className={styles.facts} aria-label="Harvest Watch facts">
            <div className={`${styles.fact} ${styles.factWide}`}><small>Expected watch window</small><strong>{prettyDate(task.expectedHarvestStart)}–{prettyDate(task.expectedHarvestEnd)}</strong></div>
            <div className={styles.fact}><small>Recorded stage</small><strong>{task.cycleState?.replaceAll("_", " ") || "Unknown"}</strong></div>
            <div className={styles.fact}><small>What time means</small><strong>Look now—not “ready now”</strong></div>
          </section>

          <section className={styles.prompt}>
            <small>What is physically true?</small>
            <h2>Choose the crop’s real harvest state.</h2>
            <p>The projected window opened this observation. Your result—not the date—determines what Atlas does next.</p>
          </section>

          <div className={styles.choices}>
            {choices.map((choice) => (
              <button key={choice.action} type="button" className={styles.choice} data-active={action === choice.action} data-tone={choice.tone} onClick={() => setAction(choice.action)}>
                <strong>{choice.title}</strong><span>{choice.detail}</span>
              </button>
            ))}
          </div>

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
              <button type="button" className={styles.submit} disabled={saving || (needsNote && !note.trim()) || (needsRecheck && !recheckDate)} onClick={() => void submit()}>{saving ? "Recording…" : "Record observation"}</button>
              {message ? <p className={styles.message}>{message}</p> : null}
            </section>
          ) : null}
        </article>
      </div>
    </main>
  );
}
