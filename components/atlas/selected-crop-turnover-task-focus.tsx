"use client";

import { useEffect, useState } from "react";

import AssignedTaskExecutionShell from "@/components/atlas/assigned-task-execution-shell";
import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";
import styles from "./weed-card-task-focus.module.css";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type TurnoverContext = {
  taskId: string;
  collectionLabel: string;
  cropCycleId: string;
  cropLabel: string;
  variety: string | null;
  cycleState: string | null;
  locations: string[];
  biomassDestination: string;
  executionDo: string;
  doneWhen: string;
  preserveOtherCrops: boolean;
  wholeBedTurnover: boolean;
};

type TurnoverResult = "partial" | "done";
type SavingAction = "result" | "blocked" | null;

function returnTo(path: string) {
  const requested = new URLSearchParams(window.location.search).get("returnTo");
  return requested && requested.startsWith("/") && !requested.startsWith("//") ? requested : path;
}

function displayCrop(context: TurnoverContext) {
  if (!context.variety) return context.cropLabel;
  if (context.cropLabel.toLowerCase().includes(context.variety.toLowerCase())) return context.cropLabel;
  return `${context.variety} ${context.cropLabel}`;
}

export default function SelectedCropTurnoverTaskFocus({ task, childTasks, assignee }: Props) {
  const [turnover, setTurnover] = useState<TurnoverContext | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedResult, setSelectedResult] = useState<TurnoverResult | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [note, setNote] = useState("");
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blockedNote, setBlockedNote] = useState("");
  const [saving, setSaving] = useState<SavingAction>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/atlas/weed-card/turnover?taskId=${encodeURIComponent(task.task_id)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json() as { ok?: boolean; turnover?: TurnoverContext };
        if (!response.ok || !data.ok || !data.turnover) throw new Error("Turnover context unavailable");
        if (active) setTurnover(data.turnover);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [task.task_id]);

  if (failed) return <AssignedTaskExecutionShell task={task} childTasks={childTasks} assignee={assignee} />;
  if (!turnover) {
    return (
      <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
        <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
          <div className="atlas-task-page-body">
            <article className="atlas-task-page-active atlas-task-ticket-card atlas-dominion-task-card" aria-busy="true" />
          </div>
        </section>
      </main>
    );
  }

  const crop = displayCrop(turnover);
  const busy = saving !== null;

  async function saveResult() {
    if (!selectedResult) {
      setMessage("Choose what happened first.");
      return;
    }
    try {
      setSaving("result");
      setMessage(null);
      const automaticNote = selectedResult === "done"
        ? `${crop} biomass removed to ${turnover.biomassDestination}. Other crop occupancy was left in place.`
        : `${crop} was partly removed; turnover is not complete.`;
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: selectedResult,
        note: note.trim() || automaticNote,
        laneKey: task.action_key || "clear",
        workKey: task.action_key || "clear",
        payload: {
          weedManagementMode: "clear_selected_crop",
          selectedCropCycleId: turnover.cropCycleId,
          biomassDestination: turnover.biomassDestination,
          wholeBedTurnover: false,
        },
      });
      window.location.assign(returnTo(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not save the turnover result.");
    } finally {
      setSaving(null);
    }
  }

  async function finishBlocked() {
    const blocker = blockedNote.trim();
    if (!blocker) {
      setMessage("Say what stopped the turnover.");
      return;
    }
    try {
      setSaving("blocked");
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: "blocked",
        note: `Blocked: ${blocker}`,
        reason: blocker,
        laneKey: task.action_key || "clear",
        workKey: task.action_key || "clear",
        payload: {
          weedManagementMode: "clear_selected_crop",
          selectedCropCycleId: turnover.cropCycleId,
        },
      });
      window.location.assign(returnTo(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not record the blocker.");
    } finally {
      setSaving(null);
    }
  }

  const completion = (
    <div className={styles.finish}>
      <button
        type="button"
        className={styles.saveResult}
        disabled={busy || !selectedResult}
        onClick={() => void saveResult()}
      >
        {saving === "result" ? "Saving…" : "Save result"}
      </button>
      {message ? <p className={styles.message}>{message}</p> : null}
    </div>
  );

  return (
    <main className={styles.shell} data-atlas-weed-card-template="task-card-lab-v4-selected-crop-turnover">
      <div className={styles.body}>
        <AtlasTaskCardFrame
          family="Weed"
          familyDetail="Turning over"
          title={turnover.collectionLabel}
          subtitle="Selected crop only"
          timing="Clear crop body · preserve the rest of the bed"
          completion={completion}
        >
          <section className={styles.bedNow}>
            <span>Crop to clear</span>
            <strong>{crop}</strong>
          </section>

          <section className={styles.activeCrops} aria-label={`${crop} crop occupancy`}>
            <header><span>Crop occupancy</span><small>where this crop lives</small></header>
            <div className={styles.cropRows}>
              <article className={styles.cropRow}>
                <div className={styles.cropIdentity}>
                  <strong>{crop}</strong>
                  <small>{turnover.locations.length ? turnover.locations.join(" + ") : turnover.collectionLabel}</small>
                </div>
                <div className={styles.cropState}>
                  <b>Selected for removal</b>
                  <small>other bed crops stay</small>
                </div>
              </article>
            </div>
          </section>

          <section className={styles.bedNow}>
            <span>Clear / remove</span>
            <strong>{`Remove ${crop} biomass → ${turnover.biomassDestination}`}</strong>
          </section>

          <section className={styles.history} aria-label="Turnover method">
            <header><span>Do</span></header>
            <ol>
              <li><strong>{turnover.executionDo}</strong></li>
              {turnover.preserveOtherCrops ? <li><strong>Leave every other living crop in the foot beds in place.</strong></li> : null}
              <li><strong>Done when: {turnover.doneWhen}</strong></li>
            </ol>
          </section>

          <section className={styles.results}>
            <header><span>What happened?</span></header>
            <div className={styles.resultPills} role="group" aria-label="Turnover result">
              <button
                type="button"
                data-active={selectedResult === "partial" ? "true" : "false"}
                aria-pressed={selectedResult === "partial"}
                disabled={busy}
                onClick={() => { setSelectedResult("partial"); setMessage(null); }}
              >
                Partly removed
              </button>
              <button
                type="button"
                data-active={selectedResult === "done" ? "true" : "false"}
                aria-pressed={selectedResult === "done"}
                disabled={busy}
                onClick={() => { setSelectedResult("done"); setMessage(null); }}
              >
                Removed
              </button>
            </div>
            <div className={styles.resultActions}>
              <button type="button" className={styles.logButton} aria-expanded={logOpen} disabled={busy} onClick={() => setLogOpen((open) => !open)}>Add note</button>
              <button type="button" className={styles.blockedAction} aria-expanded={blockedOpen} disabled={busy} onClick={() => setBlockedOpen((open) => !open)}>Blocked</button>
            </div>
            {logOpen ? (
              <div className={styles.logDrawer}>
                <input className={styles.optionalNote} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="Optional observation" aria-label="Turnover observation" />
              </div>
            ) : null}
            {blockedOpen ? (
              <div className={styles.blockedDrawer}>
                <input value={blockedNote} disabled={busy} onChange={(event) => setBlockedNote(event.target.value)} placeholder="What stopped the turnover?" aria-label="Turnover blocker" />
                <button type="button" disabled={busy || !blockedNote.trim()} onClick={() => void finishBlocked()}>{saving === "blocked" ? "Saving…" : "Record blocker"}</button>
              </div>
            ) : null}
          </section>
        </AtlasTaskCardFrame>
      </div>
    </main>
  );
}
