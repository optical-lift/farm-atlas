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
  const [marketable, setMarketable] = useState("");
  const [seconds, setSeconds] = useState("");
  const [discarded, setDiscarded] = useState("");
  const [unit, setUnit] = useState(task.estimatedUnit || "stems");
  const [moreAvailable, setMoreAvailable] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const crop = useMemo(() => displayCrop(task), [task]);
  const returnTo = task.returnTo || (task.dueDate ? `/day?date=${encodeURIComponent(task.dueDate)}` : "/");

  async function submit() {
    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/harvest-cut", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          marketableQuantity: marketable,
          secondsQuantity: seconds || 0,
          discardedQuantity: discarded || 0,
          unit,
          moreAvailable,
          note: note.trim() || null,
          idempotencyKey: `crop-harvest:${task.id}:${Date.now()}`,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Harvest count failed.");
      setMessage(moreAvailable ? "Harvest recorded. Atlas will open the next field watch tomorrow." : "Harvest recorded. This crop’s harvest window is closed.");
      window.setTimeout(() => window.location.assign(returnTo), 900);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Harvest count failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.top}>
        <Link href={returnTo} className={styles.brand}><small>Atlas</small><strong>Harvest + Count</strong></Link>
        <Link href={returnTo} className={styles.close} aria-label="Close harvest count">×</Link>
      </header>

      <div className={styles.body}>
        <article className={styles.ticket}>
          <section className={styles.hero}>
            <div className={styles.kicker}><span>Actual cut</span><span>{prettyDate(task.dueDate)}</span></div>
            <h1>{crop}</h1>
            <p>{task.objectLabel}</p>
          </section>

          <section className={styles.facts} aria-label="Harvest source">
            <div className={`${styles.fact} ${styles.factWide}`}><small>Readiness observation</small><strong>{task.estimatedQuantity === null ? "Harvestable; no quantity estimate recorded" : `About ${task.estimatedQuantity} ${task.estimatedUnit || "units"} looked ready`}</strong></div>
            <div className={`${styles.fact} ${styles.factWide}`}><small>Count rule</small><strong>Record what was actually cut—not the earlier estimate.</strong></div>
          </section>

          <section className={styles.prompt}>
            <small>Harvest result</small>
            <h2>What came out of the field?</h2>
            <p>Marketable, seconds, and discarded quantities stay separate so future availability can be honest.</p>
          </section>

          <section className={styles.form}>
            <div className={styles.countGrid}>
              <label><span>Marketable</span><input inputMode="decimal" value={marketable} onChange={(event) => setMarketable(event.target.value)} placeholder="0" /></label>
              <label><span>Seconds</span><input inputMode="decimal" value={seconds} onChange={(event) => setSeconds(event.target.value)} placeholder="0" /></label>
              <label><span>Discarded</span><input inputMode="decimal" value={discarded} onChange={(event) => setDiscarded(event.target.value)} placeholder="0" /></label>
            </div>

            <label><span>Unit</span><select value={unit} onChange={(event) => setUnit(event.target.value)}><option value="stems">stems</option><option value="pods">pods</option><option value="fruit">fruit</option><option value="bunches">bunches</option><option value="pounds">pounds</option><option value="plants">plants</option></select></label>

            <label><span>Is there more to harvest from this crop?</span></label>
            <div className={styles.toggle}>
              <button type="button" data-active={moreAvailable === true} onClick={() => setMoreAvailable(true)}>Yes · watch again</button>
              <button type="button" data-active={moreAvailable === false} onClick={() => setMoreAvailable(false)}>No · finished</button>
            </div>

            <label><span>Harvest note (optional)</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Condition, quality, or handling note." /></label>
            <button type="button" className={styles.submit} disabled={saving || !marketable.trim() || moreAvailable === null || !unit} onClick={() => void submit()}>{saving ? "Recording…" : "Record harvest"}</button>
            {message ? <p className={styles.message}>{message}</p> : null}
          </section>
        </article>
      </div>
    </main>
  );
}
