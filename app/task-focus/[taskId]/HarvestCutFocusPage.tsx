"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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
  { key: "more_than_one", label: "1+ bucket", detail: "More than one bucket" },
];

function prettyDate(value: string | null) {
  if (!value) return "Today";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function displayCrop(task: HarvestCutTask) {
  if (!task.variety) return task.cropLabel;
  return task.variety.toLowerCase().includes(task.cropLabel.toLowerCase()) ? task.variety : `${task.variety} ${task.cropLabel}`;
}

export default function HarvestCutFocusPage({ task }: { task: HarvestCutTask }) {
  const [bucketBand, setBucketBand] = useState<BucketBand | null>(null);
  const [moreAvailable, setMoreAvailable] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const crop = useMemo(() => displayCrop(task), [task]);
  const returnTo = task.returnTo || (task.dueDate ? `/day?date=${encodeURIComponent(task.dueDate)}` : "/");

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

  return (
    <main className={styles.shell}>
      <header className={styles.top}>
        <Link href={returnTo} className={styles.brand}><small>Atlas</small><strong>Harvest</strong></Link>
        <Link href={returnTo} className={styles.close} aria-label="Close harvest">×</Link>
      </header>

      <div className={styles.body}>
        <article className={styles.ticket}>
          <section className={styles.hero}>
            <div className={styles.kicker}><span>Actual harvest</span><span>{prettyDate(task.dueDate)}</span></div>
            <h1>{crop}</h1>
            <p>{task.objectLabel}</p>
          </section>

          <section className={styles.facts} aria-label="Harvest source">
            <div className={`${styles.fact} ${styles.factWide}`}><small>Earlier readiness observation</small><strong>{task.estimatedQuantity === null ? "Harvestable; no rough amount was recorded" : `About ${task.estimatedQuantity} ${task.estimatedUnit || "units"} looked ready earlier`}</strong></div>
            <div className={`${styles.fact} ${styles.factWide}`}><small>Harvest rule</small><strong>Use the bucket scale. Don’t stop to count stems.</strong></div>
          </section>

          <section className={styles.prompt}>
            <small>Physical output</small>
            <h2>What came out of the field?</h2>
            <p>Choose the closest bucket equivalent. This records physical harvest, not finished saleable inventory.</p>
          </section>

          <div className={styles.choices} aria-label="Flower harvest bucket amount">
            {BUCKET_CHOICES.map((choice) => (
              <button key={choice.key} type="button" className={styles.choice} data-active={bucketBand === choice.key} onClick={() => setBucketBand(choice.key)}>
                <strong>{choice.label}</strong>
                <span>{choice.detail}</span>
              </button>
            ))}
          </div>

          {bucketBand ? (
            <section className={styles.form}>
              <label><span>Is there more to harvest from this crop?</span></label>
              <div className={styles.toggle}>
                <button type="button" data-active={moreAvailable === true} onClick={() => setMoreAvailable(true)}>Yes · watch again</button>
                <button type="button" data-active={moreAvailable === false} onClick={() => setMoreAvailable(false)}>No · finished</button>
              </div>

              <label><span>Harvest note (optional)</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Condition, quality, or handling note." /></label>
              <button type="button" className={styles.submit} disabled={saving || moreAvailable === null} onClick={() => void submit()}>{saving ? "Recording…" : "Record harvest"}</button>
              {message ? <p className={styles.message}>{message}</p> : null}
            </section>
          ) : null}
        </article>
      </div>
    </main>
  );
}
