"use client";

import { useMemo, useState } from "react";

import { atlasFarmDateIso, atlasShiftFarmDate } from "@/lib/atlas/farm-day";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type HarvestAction = "not_ready" | "beginning" | "harvestable" | "declining" | "finished" | "problem_or_uncertain";

type HarvestDraft = {
  action: HarvestAction | "";
  recheckDate: string;
  estimatedQuantity: string;
  unit: string;
  note: string;
};

type HarvestResponse = {
  ok?: boolean;
  error?: string;
};

const ACTIONS: Array<{ key: HarvestAction; label: string; hint: string }> = [
  { key: "not_ready", label: "Not ready", hint: "Keep watching" },
  { key: "beginning", label: "Beginning", hint: "Starting harvest stage" },
  { key: "harvestable", label: "Harvestable", hint: "Ready to harvest" },
  { key: "declining", label: "Declining", hint: "Check what remains" },
  { key: "finished", label: "Finished", hint: "Harvest window is over" },
  { key: "problem_or_uncertain", label: "Problem / uncertain", hint: "Needs a human decision" },
];

function initialDraft(): HarvestDraft {
  return {
    action: "",
    recheckDate: atlasShiftFarmDate(atlasFarmDateIso(), 1),
    estimatedQuantity: "",
    unit: "",
    note: "",
  };
}

function requiresRecheck(action: HarvestAction | "") {
  return action === "not_ready" || action === "beginning" || action === "declining";
}

function validQuantity(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

export default function HarvestReadinessRoundChecklist({
  childTasks,
  onChange,
}: {
  childTasks: AtlasTaskCard[];
  onChange: () => Promise<void> | void;
}) {
  const [drafts, setDrafts] = useState<Record<string, HarvestDraft>>({});
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [errorByTask, setErrorByTask] = useState<Record<string, string>>({});

  const orderedChildren = useMemo(
    () => [...childTasks].sort((left, right) => left.created_at.localeCompare(right.created_at)),
    [childTasks],
  );

  if (!orderedChildren.length) return null;

  function draftFor(taskId: string) {
    return drafts[taskId] ?? initialDraft();
  }

  function patchDraft(taskId: string, patch: Partial<HarvestDraft>) {
    setDrafts((current) => ({
      ...current,
      [taskId]: { ...(current[taskId] ?? initialDraft()), ...patch },
    }));
    setErrorByTask((current) => ({ ...current, [taskId]: "" }));
  }

  async function recordObservation(task: AtlasTaskCard) {
    const draft = draftFor(task.task_id);
    if (!draft.action) {
      setErrorByTask((current) => ({ ...current, [task.task_id]: "Choose what you see first." }));
      return;
    }

    if (requiresRecheck(draft.action) && (!draft.recheckDate || draft.recheckDate <= atlasFarmDateIso())) {
      setErrorByTask((current) => ({ ...current, [task.task_id]: "Choose a future recheck date." }));
      return;
    }

    if (draft.action === "problem_or_uncertain" && !draft.note.trim()) {
      setErrorByTask((current) => ({ ...current, [task.task_id]: "Describe the problem or uncertainty." }));
      return;
    }

    const estimatedQuantity = validQuantity(draft.estimatedQuantity);
    if (Number.isNaN(estimatedQuantity)) {
      setErrorByTask((current) => ({ ...current, [task.task_id]: "Estimated quantity must be zero or greater." }));
      return;
    }
    if (estimatedQuantity !== null && !draft.unit.trim()) {
      setErrorByTask((current) => ({ ...current, [task.task_id]: "Add a unit for the estimated quantity." }));
      return;
    }

    try {
      setSavingTaskId(task.task_id);
      setErrorByTask((current) => ({ ...current, [task.task_id]: "" }));
      const response = await fetch("/api/atlas/harvest-watch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          taskId: task.task_id,
          action: draft.action,
          estimatedQuantity,
          unit: draft.unit.trim() || null,
          recheckDate: requiresRecheck(draft.action) ? draft.recheckDate : null,
          note: draft.note.trim() || null,
          idempotencyKey: `harvest-round:${task.task_id}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        }),
      });
      const data = await response.json() as HarvestResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "Harvest observation failed.");
      setDrafts((current) => {
        const next = { ...current };
        delete next[task.task_id];
        return next;
      });
      await onChange();
    } catch (error) {
      setErrorByTask((current) => ({
        ...current,
        [task.task_id]: error instanceof Error ? error.message : "Harvest observation failed.",
      }));
    } finally {
      setSavingTaskId(null);
    }
  }

  return (
    <section className="atlas-plant-check atlas-harvest-readiness-round" data-atlas-harvest-readiness-round="true">
      <h3>Record readiness in this round</h3>
      <p className="atlas-harvest-round-help">
        Check each crop where it is growing. The round closes automatically after every crop below has a recorded observation.
      </p>
      <div className="atlas-plant-check__list">
        {orderedChildren.map((task) => {
          const draft = draftFor(task.task_id);
          const saving = savingTaskId === task.task_id;
          const error = errorByTask[task.task_id];
          return (
            <article className="atlas-plant-check__item atlas-harvest-round-item" key={task.task_id} data-harvest-watch-task-id={task.task_id}>
              <div className="atlas-plant-check__content">
                <strong>{task.title}</strong>
                {task.note ? <p>{task.note}</p> : null}
              </div>

              <div className="atlas-harvest-round-actions" role="group" aria-label={`Harvest readiness for ${task.title}`}>
                {ACTIONS.map((action) => (
                  <button
                    type="button"
                    key={action.key}
                    className={draft.action === action.key ? "selected" : ""}
                    disabled={savingTaskId !== null}
                    aria-pressed={draft.action === action.key}
                    onClick={() => patchDraft(task.task_id, { action: action.key })}
                  >
                    <strong>{action.label}</strong>
                    <span>{action.hint}</span>
                  </button>
                ))}
              </div>

              {requiresRecheck(draft.action) ? (
                <label className="atlas-harvest-round-field">
                  <span>Check again</span>
                  <input
                    type="date"
                    min={atlasShiftFarmDate(atlasFarmDateIso(), 1)}
                    value={draft.recheckDate}
                    disabled={saving}
                    onChange={(event) => patchDraft(task.task_id, { recheckDate: event.target.value })}
                  />
                </label>
              ) : null}

              {draft.action ? (
                <div className="atlas-harvest-round-detail-grid">
                  <label className="atlas-harvest-round-field">
                    <span>Estimated quantity <small>optional</small></span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={draft.estimatedQuantity}
                      disabled={saving}
                      onChange={(event) => patchDraft(task.task_id, { estimatedQuantity: event.target.value })}
                    />
                  </label>
                  <label className="atlas-harvest-round-field">
                    <span>Unit {draft.estimatedQuantity ? "" : <small>optional</small>}</span>
                    <input
                      type="text"
                      placeholder="stems, lb, bunches…"
                      value={draft.unit}
                      disabled={saving}
                      onChange={(event) => patchDraft(task.task_id, { unit: event.target.value })}
                    />
                  </label>
                </div>
              ) : null}

              {draft.action ? (
                <label className="atlas-harvest-round-field">
                  <span>{draft.action === "problem_or_uncertain" ? "What is wrong or uncertain?" : "Note"} {draft.action === "problem_or_uncertain" ? "" : <small>optional</small>}</span>
                  <textarea
                    rows={2}
                    value={draft.note}
                    disabled={saving}
                    onChange={(event) => patchDraft(task.task_id, { note: event.target.value })}
                  />
                </label>
              ) : null}

              {error ? <p className="atlas-harvest-round-error" role="alert">{error}</p> : null}

              {draft.action ? (
                <button
                  type="button"
                  className="atlas-harvest-round-save"
                  disabled={savingTaskId !== null}
                  onClick={() => void recordObservation(task)}
                >
                  {saving ? "Recording…" : "Record this crop"}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
      <style>{`
        .atlas-harvest-round-help { margin:-4px 0 14px; color:#62677b; font-size:.79rem; line-height:1.45; }
        .atlas-harvest-round-item { display:grid; gap:10px; }
        .atlas-harvest-round-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
        .atlas-harvest-round-actions button { display:grid; gap:2px; padding:9px 10px; border:1px solid rgba(81,84,106,.2); border-radius:10px; background:#fbfaf7; color:#474b5e; text-align:left; }
        .atlas-harvest-round-actions button.selected { border-color:#686d8d; background:#f0f0f7; box-shadow:inset 0 0 0 1px rgba(104,109,141,.2); }
        .atlas-harvest-round-actions button strong { font-size:.78rem; }
        .atlas-harvest-round-actions button span { color:#777b8c; font-size:.66rem; line-height:1.25; }
        .atlas-harvest-round-field { display:grid; gap:5px; color:#55596d; font-size:.72rem; font-weight:800; }
        .atlas-harvest-round-field small { color:#8b8e9d; font-weight:600; }
        .atlas-harvest-round-field input,.atlas-harvest-round-field textarea { width:100%; box-sizing:border-box; border:1px solid rgba(81,84,106,.22); border-radius:9px; background:#fff; padding:8px 9px; color:#343746; font:inherit; font-weight:600; }
        .atlas-harvest-round-detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .atlas-harvest-round-save { justify-self:start; padding:9px 12px; border:0; border-radius:999px; background:#585d79; color:white; font-size:.74rem; font-weight:900; }
        .atlas-harvest-round-save:disabled,.atlas-harvest-round-actions button:disabled { opacity:.55; }
        .atlas-harvest-round-error { margin:0; color:#8a4139; font-size:.72rem; line-height:1.35; }
        @media (max-width:560px) { .atlas-harvest-round-actions,.atlas-harvest-round-detail-grid { grid-template-columns:1fr; } }
      `}</style>
    </section>
  );
}
