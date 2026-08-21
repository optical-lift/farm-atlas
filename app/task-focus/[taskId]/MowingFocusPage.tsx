"use client";

import { useEffect, useState } from "react";

import MaintenanceDirectiveStrip from "@/components/atlas/maintenance-directive-strip";
import MowingTaskCardBody from "@/components/atlas/mowing-task-card-body";
import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import TaskPrimaryResultControls from "@/components/atlas/task-primary-result-controls";
import { buildMowingCardViewModel } from "@/lib/atlas/mowing-card-view-model";
import type { WorkerReadinessResponse } from "@/lib/atlas/worker-readiness";
import styles from "./HarvestFocus.module.css";
import TaskFocusCueDelivery from "./TaskFocusCueDelivery";

export type MowingFocusTask = {
  id: string;
  title: string;
  dueDate: string | null;
  routeLabel: string;
  zoneLabel: string;
  equipmentGroup: string | null;
  resourceLabel?: string | null;
  resourceStatus?: string | null;
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

function tomorrowIso(days = 1) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function mowingIssueChoices(equipmentGroup: string | null) {
  const value = equipmentGroup?.toLowerCase() ?? "";
  if (value.includes("riding")) return ["Won't start", "Needs gas", "Something broke", "Other"];
  if (value.includes("battery") || value.includes("push mower")) return ["Battery problem", "Mower problem", "Battery missing", "Other"];
  return ["Equipment problem", "Area problem", "Other"];
}

export default function MowingFocusPage({ task }: { task: MowingFocusTask }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [completionPercent, setCompletionPercent] = useState("50");
  const [recheckDate, setRecheckDate] = useState(tomorrowIso(1));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<WorkerReadinessResponse | null>(null);
  const returnTo = task.returnTo || "/collections/mowing";
  const taskReady = readiness?.ok === true && readiness.executable === true;
  const blockedPresentation = readiness?.ok ? readiness.presentation ?? null : null;
  const card = buildMowingCardViewModel({
    routeLabel: task.routeLabel,
    zoneLabel: task.zoneLabel,
    lastMowedAt: task.lastMowedAt,
    dueDate: task.dueDate,
    nextCheckDate: task.nextCheckDate,
    targetCutHeightInches: task.targetCutHeightInches,
    equipmentGroup: task.equipmentGroup,
  });
  const issueChoices = mowingIssueChoices(task.equipmentGroup);

  useEffect(() => {
    const controller = new AbortController();
    setReadiness(null);

    void (async () => {
      try {
        const response = await fetch(`/api/atlas/task-execution-readiness?taskId=${encodeURIComponent(task.id)}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const body = await response.json() as WorkerReadinessResponse;
        if (!controller.signal.aborted) setReadiness(response.ok ? body : { ok: false, error: body.error || "Task readiness could not be loaded." });
      } catch {
        if (!controller.signal.aborted) setReadiness({ ok: false, error: "Task readiness could not be loaded." });
      }
    })();

    return () => controller.abort();
  }, [task.id]);

  async function save(selectedOutcome: Outcome, explicitNote?: string) {
    if (!taskReady) {
      setMessage("This job is not ready yet.");
      return;
    }

    const resultNote = explicitNote?.trim() || note.trim();
    const needsPercent = selectedOutcome === "mowed_partial";
    const needsRecheck = selectedOutcome === "acceptable_no_cut" || selectedOutcome === "too_wet";
    const needsNote = selectedOutcome === "mowed_partial" || selectedOutcome === "equipment_or_area_problem";
    const validPercent = Number.isInteger(Number(completionPercent)) && Number(completionPercent) >= 1 && Number(completionPercent) <= 99;
    const complete = (!needsPercent || validPercent) && (!needsRecheck || Boolean(recheckDate)) && (!needsNote || Boolean(resultNote));
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
          note: resultNote || null,
          idempotencyKey: `mowing:${task.id}:${selectedOutcome}:${Date.now()}`,
        }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Mowing result failed.");

      if (selectedOutcome === "mowed_full") {
        const completionEvent = new CustomEvent("atlas:task-completed", {
          cancelable: true,
          detail: { taskId: task.id, returnTo },
        });
        if (window.dispatchEvent(completionEvent)) window.location.assign(returnTo);
        return;
      }

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

  const completion = taskReady ? (
    <div className="atlas-task-result-footer">
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
    </div>
  ) : false;

  return (
    <main className={styles.shell}>
      <div className={styles.body}>
        <article className={styles.ticket}>
          <AtlasTaskCardFrame
            family={card.family}
            title={card.route}
            subtitle={card.place}
            completion={completion}
          >
            <MowingTaskCardBody
              card={card}
              resourceLabel={task.resourceLabel}
              resourceStatus={task.resourceStatus}
              issueChoices={issueChoices}
              issueDisabled={!taskReady || saving}
              onEquipmentIssue={(issue, issueNote) => void save("equipment_or_area_problem", [issue, issueNote].filter(Boolean).join(" · "))}
            />

            {readiness === null ? null : !readiness.ok ? (
              <section role="status" style={{ margin: 18, borderRadius: 18, padding: "16px 17px", background: "rgba(54, 70, 58, .055)", color: "#4b554c" }}>
                <small style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase", opacity: .55 }}>Task unavailable</small>
                <strong style={{ display: "block", marginTop: 5, fontSize: 18 }}>Readiness could not be loaded</strong>
              </section>
            ) : !taskReady ? (
              <section
                role="status"
                data-atlas-task-readiness="blocked"
                data-atlas-block-kind={blockedPresentation?.kind ?? "waiting"}
                style={{ margin: 18, borderRadius: 18, padding: "17px", background: "rgba(54, 70, 58, .055)", color: "#39453c" }}
              >
                <small style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase", opacity: .5 }}>Waiting</small>
                <strong style={{ display: "block", marginTop: 5, fontSize: 19, lineHeight: 1.2 }}>{blockedPresentation?.title ?? "Not ready yet"}</strong>
                <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.48 }}>{blockedPresentation?.body ?? "This job can’t be done yet."}</p>
                {blockedPresentation?.detail ? <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.45, opacity: .7 }}>{blockedPresentation.detail}</p> : null}
              </section>
            ) : (
              <div style={{ padding: "0 18px 16px" }}>
                <MaintenanceDirectiveStrip taskId={task.id} />
              </div>
            )}

            {task.currentNote ? <p className={styles.message}>Previous note · {task.currentNote}</p> : null}
            {message ? <p className={styles.message}>{message}</p> : null}
          </AtlasTaskCardFrame>
        </article>
      </div>

      <TaskFocusCueDelivery taskId={task.id} />
    </main>
  );
}
