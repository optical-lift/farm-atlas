"use client";

import { useMemo, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import styles from "./HarvestFocus.module.css";

export type HarvestCutTask = {
  id: string;
  cropLabel: string;
  variety: string | null;
  objectLabel: string;
  dueDate: string | null;
  estimatedQuantity: number | null;
  estimatedUnit: string | null;
  returnTo?: string | null;
};

type BucketBand = "quarter" | "half" | "three_quarters" | "one" | "more_than_one";

const BUCKET_CHOICES: Array<{ key: BucketBand; label: string; detail: string }> = [
  { key: "quarter", label: "¼ bucket", detail: "About a quarter full" },
  { key: "half", label: "½ bucket", detail: "About half full" },
  { key: "three_quarters", label: "¾ bucket", detail: "About three-quarters full" },
  { key: "one", label: "1 bucket", detail: "About one full bucket" },
  { key: "more_than_one", label: "1+ buckets", detail: "More than one bucket" },
];

function prettyDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function displayCrop(task: HarvestCutTask) {
  if (!task.variety) return task.cropLabel;
  return task.variety.toLowerCase().includes(task.cropLabel.toLowerCase()) ? task.variety : `${task.variety} ${task.cropLabel}`;
}

function bucketLabel(value: BucketBand | null) {
  return BUCKET_CHOICES.find((choice) => choice.key === value)?.label || "Choose amount";
}

export default function HarvestCutFocusPage({ task }: { task: HarvestCutTask }) {
  const [bucketBand, setBucketBand] = useState<BucketBand | null>(null);
  const [moreAvailable, setMoreAvailable] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const crop = useMemo(() => displayCrop(task), [task]);
  const returnTo = task.returnTo || (task.dueDate ? `/day?date=${encodeURIComponent(task.dueDate)}` : "/");
  const trail = [
    { label: "Crop", detail: "active", state: "done" },
    { label: "Harvest watch", detail: "ready", state: "done" },
    { label: "Harvest", detail: "today", state: "now" },
    { label: "Harvest again", detail: "if producing", state: "later" },
    { label: "Next phase", detail: "when harvest closes", state: "later" },
  ] as const;

  async function submit() {
    if (!bucketBand || moreAvailable === null) return;
    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/harvest-cut", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          bucketBand,
          moreAvailable,
          note: note.trim() || null,
          idempotencyKey: `flower-harvest:${task.id}:${Date.now()}`,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Harvest output failed.");
      setMessage(moreAvailable ? "Harvest recorded. Atlas will open the next field watch tomorrow." : "Harvest recorded. This crop’s harvest window is closed.");
      window.setTimeout(() => window.location.assign(returnTo), 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Harvest output failed.");
    } finally {
      setSaving(false);
    }
  }

  const completion = (
    <div className={styles.finish}>
      <span>Finish Harvest</span>
      <button type="button" className={styles.primaryFinish} disabled={saving || !bucketBand || moreAvailable === null} onClick={() => void submit()}>
        {saving ? "Recording…" : bucketBand ? `Record ${bucketLabel(bucketBand)}` : "Choose what came out of the field"}
      </button>
      {message ? <p className={styles.message}>{message}</p> : null}
    </div>
  );

  return (
    <main className={styles.shell} data-atlas-harvest-card="cut">
      <div className={styles.body}>
        <AtlasTaskCardFrame
          family="Harvest"
          familyDetail="crop-cycle truth"
          title={crop}
          subtitle={task.objectLabel}
          timing={task.dueDate ? `Harvest · ${prettyDate(task.dueDate)}` : "Harvest"}
          completion={completion}
        >
          <div className={styles.trail} aria-label={`${crop} harvest continuity`}>
            {trail.map((step) => <span key={`${step.label}-${step.detail}`} data-state={step.state}><b>{step.label}</b><small>{step.detail}</small></span>)}
          </div>

          <section className={styles.cropTruth}>
            <div><span>Crop now</span><strong>Harvestable</strong></div>
            <div className={styles.cropFacts}>
              <b>Marketable field output</b>
              <b>Bucket-scale observation</b>
              {task.estimatedQuantity !== null ? <b>Earlier look · about {task.estimatedQuantity} {task.estimatedUnit || "units"}</b> : null}
            </div>
          </section>

          <section className={styles.sharedTruth}>
            <div><span>Harvest board</span><strong>Same crop · same harvest record</strong></div>
            <p>This card writes physical output into the crop cycle used by Harvest. If more remains, Atlas returns the crop to Harvest Watch instead of creating a separate tally.</p>
          </section>

          <section className={styles.quantity}>
            <header><div><span>Today’s harvest</span><small>Choose the closest physical bucket amount</small></div></header>
            <div className={styles.bucketTotal} aria-live="polite"><strong>{bucketLabel(bucketBand)}</strong><span>No stem conversion is invented.</span></div>
            <div className={styles.bucketChoices} aria-label="Flower harvest bucket amount">
              {BUCKET_CHOICES.map((choice) => (
                <button key={choice.key} type="button" data-active={bucketBand === choice.key ? "true" : "false"} onClick={() => { setBucketBand(choice.key); setMessage(null); }}>
                  <strong>{choice.label}</strong><span>{choice.detail}</span>
                </button>
              ))}
            </div>
          </section>

          {bucketBand ? (
            <section className={styles.results}>
              <header><span>What happened?</span><small>Is this crop still producing after today’s cut?</small></header>
              <div className={styles.resultGrid}>
                <button type="button" data-active={moreAvailable === true ? "true" : "false"} onClick={() => setMoreAvailable(true)}><strong>More remains</strong><span>Return this crop to Harvest Watch</span></button>
                <button type="button" data-active={moreAvailable === false ? "true" : "false"} onClick={() => setMoreAvailable(false)}><strong>Harvest finished</strong><span>Close this productive Harvest phase</span></button>
              </div>
            </section>
          ) : null}

          {bucketBand ? (
            <section className={styles.form}>
              <label><span>Harvest note (optional)</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Condition, quality, or handling note." /></label>
            </section>
          ) : null}
        </AtlasTaskCardFrame>
      </div>
    </main>
  );
}
