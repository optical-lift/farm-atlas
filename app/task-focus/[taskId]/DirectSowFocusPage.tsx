"use client";

import { useMemo, useState } from "react";

import TaskBedMap from "@/components/atlas/task-bed-map";
import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";
import styles from "./DirectSowFocus.module.css";

export type DirectSowFocusTask = {
  id: string;
  title: string;
  dueDate: string | null;
  cropLabel: string;
  variety: string | null;
  locationLabel: string;
  zoneLabel: string | null;
  targetLabels: string[];
  rowsPerBed: number | null;
  spacingInches: number | null;
  seedRequirementQuantity: number | null;
  seedRequirementUnit: string | null;
  projectedGerminationStart: string | null;
  projectedGerminationEnd: string | null;
  projectedHarvestStart: string | null;
  projectedHarvestEnd: string | null;
  projectedClearDate: string | null;
  successionNumber: number | null;
  completionMode: "seed_inventory" | "canonical";
  actionKey: string | null;
  workClass: string | null;
  returnTo: string | null;
};

type SeedResult = "depleted" | "some_left_unknown" | "exact_remaining";

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "";
  const date = new Date(`${dateIso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? dateIso : new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(date);
}

function prettyRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return "";
  if (!start) return prettyDate(end);
  if (!end) return prettyDate(start);
  const a = new Date(`${start.slice(0, 10)}T12:00:00Z`);
  const b = new Date(`${end.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${prettyDate(start)}–${prettyDate(end)}`;
  if (a.getUTCMonth() === b.getUTCMonth()) {
    const monthDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(a);
    return `${monthDay}–${b.getUTCDate()}`;
  }
  return `${prettyDate(start)}–${prettyDate(end)}`;
}

function returnDestination(fallback: string | null) {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("returnTo");
  if (fromQuery && fromQuery.startsWith("/") && !fromQuery.startsWith("//")) return fromQuery;
  return fallback && fallback.startsWith("/") && !fallback.startsWith("//") ? fallback : "/";
}

function completeTaskExit(taskId: string, fallback: string | null) {
  const returnTo = returnDestination(fallback);
  const event = new CustomEvent("atlas:task-completed", { cancelable: true, detail: { taskId, returnTo } });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) window.location.assign(returnTo);
}

function inches(value: number | null) {
  if (!value) return "—";
  return `${Number.isInteger(value) ? value : value.toFixed(1)}″`;
}

function quantityLabel(quantity: number | null, unit: string | null) {
  if (!quantity) return "—";
  return `${quantity.toLocaleString()} ${unit || "seeds"}`;
}

function uniqueLabels(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const label = value?.trim();
    if (!label) return [];
    const key = label.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [label];
  });
}

export default function DirectSowFocusPage({ task }: { task: DirectSowFocusTask }) {
  const [weedy, setWeedy] = useState(false);
  const [ranOut, setRanOut] = useState(false);
  const [note, setNote] = useState("");
  const [finishOpen, setFinishOpen] = useState(false);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null);
  const [remainingQuantity, setRemainingQuantity] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const seedName = task.variety || task.cropLabel;
  const germination = prettyRange(task.projectedGerminationStart, task.projectedGerminationEnd);
  const harvest = prettyRange(task.projectedHarvestStart, task.projectedHarvestEnd);
  const clear = prettyDate(task.projectedClearDate);
  const bedLabels = uniqueLabels(task.targetLabels.length ? task.targetLabels : [task.locationLabel]);
  const surpriseNote = useMemo(() => {
    const observations = [weedy ? "It was weedy." : "", ranOut ? "Ran out of seeds before the planned sowing was fully supplied." : ""].filter(Boolean);
    return [...observations, note.trim()].filter(Boolean).join(" ");
  }, [note, ranOut, weedy]);

  const trail = [
    { label: "Prepared", detail: "beds ready", state: "done" },
    { label: "Sow", detail: seedName, state: "now" },
    { label: "Germination", detail: germination || "forecast pending", state: "later" },
    { label: "Harvest", detail: harvest || "forecast pending", state: "later" },
    { label: "Clear", detail: clear || "forecast pending", state: "later" },
  ] as const;

  async function finishInventorySowing() {
    const exactRemaining = seedResult === "exact_remaining" ? Number(remainingQuantity) : null;
    if (!seedResult) {
      setMessage("Tell Atlas what is left in the seed lot.");
      return;
    }
    if (seedResult === "exact_remaining" && (exactRemaining === null || !Number.isFinite(exactRemaining) || exactRemaining <= 0)) {
      setMessage("Enter the exact number of seeds remaining.");
      return;
    }

    try {
      setSaving(true);
      setMessage(null);
      const response = await fetch("/api/atlas/direct-sow-result", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          taskId: task.id,
          result: seedResult,
          remainingQuantity: seedResult === "exact_remaining" ? exactRemaining : null,
          note: surpriseNote || null,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string | { message?: string } };
      if (!response.ok || !data.ok) {
        const error = typeof data.error === "string" ? data.error : data.error?.message;
        throw new Error(error || "Sowing result failed.");
      }
      completeTaskExit(task.id, task.returnTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sowing result failed.");
    } finally {
      setSaving(false);
    }
  }

  async function finishCanonicalSowing() {
    try {
      setSaving(true);
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.id,
        transition: "done",
        note: surpriseNote || undefined,
        reason: surpriseNote || undefined,
        laneKey: task.actionKey || undefined,
        workKey: task.actionKey || undefined,
        payload: { workClass: task.workClass || undefined, sowCardFamily: true },
      });
      completeTaskExit(task.id, task.returnTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function reportUnfinished(kind: "partial" | "blocked") {
    const promptLabel = kind === "partial" ? "What is left?" : "What problem did you find?";
    const entered = window.prompt(promptLabel, surpriseNote || "")?.trim();
    if (!entered) return;
    try {
      setSaving(true);
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.id,
        transition: kind,
        note: entered,
        reason: entered,
        laneKey: task.actionKey || undefined,
        workKey: task.actionKey || undefined,
        payload: { workClass: task.workClass || undefined, sowCardFamily: true },
      });
      window.location.assign(returnDestination(task.returnTo));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task update failed.");
    } finally {
      setSaving(false);
    }
  }

  const completion = (
    <div className={styles.finish}>
      <div className={styles.finishButtons}>
        <button
          type="button"
          className={styles.primaryFinish}
          disabled={saving}
          onClick={() => {
            setUnfinishedOpen(false);
            if (task.completionMode === "seed_inventory") setFinishOpen((open) => !open);
            else void finishCanonicalSowing();
          }}
        >
          Done
        </button>
        <button type="button" disabled={saving} onClick={() => { setUnfinishedOpen((open) => !open); setFinishOpen(false); }}>Unfinished</button>
      </div>

      {task.completionMode === "seed_inventory" && finishOpen ? (
        <section className={styles.resultDrawer} aria-label="Finish sowing">
          <header><strong>What is left in the seed bag?</strong><small>Atlas uses this to keep seed inventory truthful.</small></header>
          <div className={styles.resultChoices}>
            <button type="button" data-active={seedResult === "depleted"} onClick={() => { setSeedResult("depleted"); setRemainingQuantity(""); }}>Used the rest</button>
            <button type="button" data-active={seedResult === "some_left_unknown"} onClick={() => { setSeedResult("some_left_unknown"); setRemainingQuantity(""); }}>Some left</button>
            <button type="button" data-active={seedResult === "exact_remaining"} onClick={() => setSeedResult("exact_remaining")}>I know how many</button>
          </div>
          {seedResult === "exact_remaining" ? (
            <label className={styles.inlineField}><span>Seeds left</span><input inputMode="numeric" min="1" step="1" type="number" value={remainingQuantity} onChange={(event) => setRemainingQuantity(event.target.value)} /></label>
          ) : null}
          <button type="button" className={styles.commitFinish} disabled={saving || !seedResult} onClick={() => void finishInventorySowing()}>{saving ? "Saving…" : "Finish sowing"}</button>
        </section>
      ) : null}

      {unfinishedOpen ? (
        <section className={styles.unfinishedDrawer}>
          <strong>What happened?</strong>
          <div><button type="button" disabled={saving} onClick={() => void reportUnfinished("partial")}>Partly done</button><button type="button" disabled={saving} onClick={() => void reportUnfinished("blocked")}>Problem found</button></div>
        </section>
      ) : null}
      {message ? <p className={styles.message}>{message}</p> : null}
    </div>
  );

  return (
    <main className={styles.shell}>
      <div className={styles.body}>
        <AtlasTaskCardFrame
          family="Sow"
          familyDetail={task.successionNumber ? `Succession ${task.successionNumber}` : undefined}
          title={task.locationLabel}
          subtitle={task.zoneLabel || undefined}
          timing={task.dueDate ? `Sowing window · ${prettyDate(task.dueDate)}` : "Sowing window open"}
          completion={completion}
        >
          <div className={styles.trail} aria-label={`${task.locationLabel} crop-cycle trail`}>
            {trail.map((step) => (
              <span className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLater} key={step.label}>
                <b>{step.label}</b><small>{step.detail}</small>
              </span>
            ))}
          </div>

          <section className={styles.bedSection}>
            <div className={styles.seedRow}><small>Seed</small><strong>{seedName}</strong></div>
            <div className={styles.factRow}>
              <div><small>Rows</small><strong>{task.rowsPerBed ? `${task.rowsPerBed} / bed` : "—"}</strong></div>
              <div><small>Spacing</small><strong>{inches(task.spacingInches)}</strong></div>
              <div><small>Seed estimate</small><strong>{quantityLabel(task.seedRequirementQuantity, task.seedRequirementUnit)}</strong></div>
            </div>
          </section>

          <TaskBedMap taskId={task.id} detail="sow this canonical bed" />

          <section className={styles.zoneBeds} aria-label="Zone and beds">
            <header><span>Zone + bed</span></header>
            {task.zoneLabel ? <strong className={styles.zoneName}>{task.zoneLabel}</strong> : null}
            <div className={styles.zoneBedRows}>
              {bedLabels.map((label, index) => {
                const id = `sow-bed-${task.id}-${index}`;
                return (
                  <div className={styles.zoneBedRow} key={label}>
                    <input id={id} type="checkbox" />
                    <label htmlFor={id}><span aria-hidden="true" /> <strong>{label}</strong></label>
                  </div>
                );
              })}
            </div>
          </section>

          <section className={styles.projections}>
            <header><span>Projections</span><small>from this sowing&apos;s planned date</small></header>
            <div className={styles.projectionGrid}>
              <div><small>Germination</small><strong>{germination || "—"}</strong></div>
              <div><small>Bloom / harvest</small><strong>{harvest || "—"}</strong></div>
              <div><small>Ready to clear</small><strong>{clear || "—"}</strong></div>
            </div>
          </section>

          <section className={styles.surprises}>
            <header><span>Surprises</span><small>only if something differed</small></header>
            <div className={styles.surprisePills}>
              <label className={styles.surprisePill}><input type="checkbox" checked={weedy} onChange={(event) => setWeedy(event.target.checked)} /><span>It was weedy</span></label>
              <label className={styles.surprisePill}><input type="checkbox" checked={ranOut} onChange={(event) => setRanOut(event.target.checked)} /><span>Ran out of seeds</span></label>
              <details className={styles.logDrawer}><summary>Log it</summary><div className={styles.logPanel}><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add note…" aria-label="Add a sowing note" /><small>Included with the result you record below.</small></div></details>
            </div>
          </section>
        </AtlasTaskCardFrame>
      </div>
    </main>
  );
}
