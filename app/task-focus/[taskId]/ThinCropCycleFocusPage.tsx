"use client";

import { useMemo, useState } from "react";

import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";
import styles from "./DirectSowFocus.module.css";

export type ThinCropCycleFocusTask = {
  id: string;
  dueDate: string | null;
  cropLabel: string;
  variety: string | null;
  locationLabel: string;
  zoneLabel: string | null;
  rowsPerBed: number | null;
  targetSpacingInches: number | null;
  projectedHarvestStart: string | null;
  projectedHarvestEnd: string | null;
  projectedClearDate: string | null;
  successionNumber: number | null;
  actionKey: string | null;
  workClass: string | null;
  returnTo: string | null;
};

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
  const query = new URLSearchParams(window.location.search).get("returnTo");
  if (query && query.startsWith("/") && !query.startsWith("//")) return query;
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

export default function ThinCropCycleFocusPage({ task }: { task: ThinCropCycleFocusTask }) {
  const [weedy, setWeedy] = useState(false);
  const [note, setNote] = useState("");
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const variety = task.variety || task.cropLabel;
  const harvest = prettyRange(task.projectedHarvestStart, task.projectedHarvestEnd);
  const clear = prettyDate(task.projectedClearDate);
  const surpriseNote = useMemo(() => [weedy ? "It was weedy." : "", note.trim()].filter(Boolean).join(" "), [note, weedy]);
  const trail = [
    { label: "Sown", detail: "complete", state: "done" },
    { label: "Germinated", detail: "confirmed", state: "done" },
    { label: "Thin", detail: inches(task.targetSpacingInches), state: "now" },
    { label: "Harvest", detail: harvest || "forecast pending", state: "later" },
    { label: "Clear", detail: clear || "forecast pending", state: "later" },
  ] as const;

  async function finish() {
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
        payload: { workClass: task.workClass || undefined, thinCardFamily: true, targetSpacingInches: task.targetSpacingInches },
      });
      completeTaskExit(task.id, task.returnTo);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function reportUnfinished(kind: "partial" | "blocked") {
    const entered = window.prompt(kind === "partial" ? "What is left?" : "What problem did you find?", surpriseNote || "")?.trim();
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
        payload: { workClass: task.workClass || undefined, thinCardFamily: true },
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
        <button type="button" className={styles.primaryFinish} disabled={saving} onClick={() => void finish()}>Done</button>
        <button type="button" disabled={saving} onClick={() => setUnfinishedOpen((open) => !open)}>Unfinished</button>
      </div>
      {unfinishedOpen ? <section className={styles.unfinishedDrawer}><strong>What happened?</strong><div><button type="button" disabled={saving} onClick={() => void reportUnfinished("partial")}>Partly done</button><button type="button" disabled={saving} onClick={() => void reportUnfinished("blocked")}>Problem found</button></div></section> : null}
      {message ? <p className={styles.message}>{message}</p> : null}
    </div>
  );

  return (
    <main className={styles.shell} data-atlas-thin-crop-cycle="sow-visual-v1">
      <div className={styles.body}>
        <AtlasTaskCardFrame
          family="Thin"
          familyDetail={task.successionNumber ? `Succession ${task.successionNumber}` : undefined}
          title={task.locationLabel}
          subtitle={task.zoneLabel || undefined}
          timing={task.dueDate ? `Thinning window · ${prettyDate(task.dueDate)}` : "Thinning window open"}
          completion={completion}
        >
          <div className={styles.trail} aria-label={`${task.locationLabel} crop-cycle trail`}>
            {trail.map((step) => <span className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLater} key={step.label}><b>{step.label}</b><small>{step.detail}</small></span>)}
          </div>

          <section className={styles.bedSection}>
            <div className={styles.seedRow}><small>Crop</small><strong>{variety}</strong></div>
            <div className={styles.factRow}>
              <div><small>Rows</small><strong>{task.rowsPerBed ? `${task.rowsPerBed} / bed` : "—"}</strong></div>
              <div><small>Target spacing</small><strong>{inches(task.targetSpacingInches)}</strong></div>
              <div><small>Crop</small><strong>{task.cropLabel}</strong></div>
            </div>
          </section>

          <section className={styles.zoneBeds} aria-label="Zone and bed">
            <header><span>Zone + bed</span></header>
            {task.zoneLabel ? <strong className={styles.zoneName}>{task.zoneLabel}</strong> : null}
            <div className={styles.zoneBedRows}><div className={styles.zoneBedRow}><input id={`thin-bed-${task.id}`} type="checkbox" /><label htmlFor={`thin-bed-${task.id}`}><span aria-hidden="true" /><strong>{task.locationLabel}</strong></label></div></div>
          </section>

          <section className={styles.projections}>
            <header><span>Crop cycle</span><small>carried from the sowing</small></header>
            <div className={styles.projectionGrid}>
              <div><small>Germination</small><strong>Confirmed</strong></div>
              <div><small>Bloom / harvest</small><strong>{harvest || "—"}</strong></div>
              <div><small>Ready to clear</small><strong>{clear || "—"}</strong></div>
            </div>
          </section>

          <section className={styles.surprises}>
            <header><span>Surprises</span><small>only if something differed</small></header>
            <div className={styles.surprisePills}>
              <label className={styles.surprisePill}><input type="checkbox" checked={weedy} onChange={(event) => setWeedy(event.target.checked)} /><span>It was weedy</span></label>
              <details className={styles.logDrawer}><summary>Log it</summary><div className={styles.logPanel}><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add note…" aria-label="Add a thinning note" /><small>Included with the result you record below.</small></div></details>
            </div>
          </section>
        </AtlasTaskCardFrame>
      </div>
    </main>
  );
}
