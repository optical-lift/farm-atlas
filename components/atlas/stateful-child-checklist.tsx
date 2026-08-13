"use client";

import { useState } from "react";

import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function boolish(value: unknown) {
  return value === true || value === "true" || value === "yes" || value === 1;
}

function meta(task: AtlasTaskCard, key: string) {
  return task.metadata?.[key];
}

function isDone(task: AtlasTaskCard) {
  return task.status === "done"
    || task.task_outcomes?.[0]?.outcome === "done"
    || text(meta(task, "checklist_status")) === "done";
}

function rowLabel(task: AtlasTaskCard) {
  return text(meta(task, "checklist_label"))
    || text(meta(task, "display_subject"))
    || task.title.replace(/^Checklist\s+—\s+/i, "");
}

function actionLabel(task: AtlasTaskCard) {
  return text(meta(task, "checklist_action_label"))
    || (boolish(meta(task, "planting_log_auto_capture")) ? "Mark sown" : "Mark complete");
}

function completionPayload(task: AtlasTaskCard) {
  if (!boolish(meta(task, "planting_log_auto_capture"))) return {};
  return {
    plantedAmount: text(meta(task, "planting_log_default_amount")),
    plantedZoneId: text(meta(task, "planting_log_default_zone_id")),
    plantedObjectId: text(meta(task, "planting_log_default_object_id")),
    plantedLocation: text(meta(task, "planting_log_default_location")),
  };
}

export function statefulChildTask(task: AtlasTaskCard) {
  return boolish(meta(task, "stateful_child")) || boolish(meta(task, "planting_log_auto_capture"));
}

export default function StatefulChildChecklist({
  childTasks,
  onChange,
}: {
  childTasks: AtlasTaskCard[];
  onChange: () => Promise<void>;
}) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<Record<string, string | null>>({});
  if (!childTasks.length) return null;

  const heading = text(meta(childTasks[0], "checklist_group_label")) || "Checklist";

  async function toggle(task: AtlasTaskCard, next: "done" | "open") {
    try {
      setSavingId(task.task_id);
      setMessage((current) => ({ ...current, [task.task_id]: null }));
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: next === "done" ? "checklist_done" : "checklist_open",
        laneKey: "checklist",
        workKey: next === "done" ? "checked" : "reopened",
        payload: {
          completion_source: "checklist",
          ...completionPayload(task),
        },
      });
      await onChange();
    } catch (error) {
      setMessage((current) => ({
        ...current,
        [task.task_id]: error instanceof Error ? error.message : "Atlas could not save this step.",
      }));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="atlas-stateful-children" aria-label={heading}>
      <style>{`
        .atlas-stateful-children { margin:0 28px 20px; padding:14px 0 0; border-top:1px solid rgba(66,65,82,.11); color:#3d3e50; }
        .atlas-stateful-children__heading { display:block; margin-bottom:8px; color:#777ca0; font-size:.66rem; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-stateful-children__list { display:grid; gap:8px; }
        .atlas-stateful-children__row { display:grid; grid-template-columns:22px minmax(0,1fr) auto; gap:8px; align-items:center; min-height:42px; }
        .atlas-stateful-children__mark { width:18px; height:18px; display:grid; place-items:center; border:2px solid #727692; border-radius:50%; color:#fff; background:#fff; font-size:.7rem; font-weight:950; }
        .atlas-stateful-children__row.is-done .atlas-stateful-children__mark { background:#727692; }
        .atlas-stateful-children__row strong { font-size:.92rem; line-height:1.25; }
        .atlas-stateful-children__row button { border:1px solid rgba(82,84,105,.16); border-radius:10px; padding:7px 9px; background:#faf9f3; color:#4d4f60; font:inherit; font-size:.7rem; font-weight:850; }
        .atlas-stateful-children__message { grid-column:2 / -1; margin:0; color:#865f4f; font-size:.72rem; font-weight:700; line-height:1.3; }
        @media (max-width:560px) { .atlas-stateful-children { margin:0 21px 18px; } }
      `}</style>
      <span className="atlas-stateful-children__heading">{heading}</span>
      <div className="atlas-stateful-children__list">
        {childTasks.map((task) => {
          const done = isDone(task);
          const saving = savingId === task.task_id;
          return (
            <div key={task.task_id} className={`atlas-stateful-children__row${done ? " is-done" : ""}`} data-stateful-child-task-id={task.task_id}>
              <span className="atlas-stateful-children__mark" aria-hidden="true">{done ? "✓" : ""}</span>
              <strong>{rowLabel(task)}</strong>
              <button type="button" disabled={Boolean(savingId)} onClick={() => void toggle(task, done ? "open" : "done")}>
                {saving ? "Saving…" : done ? "Reopen" : actionLabel(task)}
              </button>
              {message[task.task_id] ? <p className="atlas-stateful-children__message">{message[task.task_id]}</p> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
