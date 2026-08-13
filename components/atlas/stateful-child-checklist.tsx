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

function sortOrder(task: AtlasTaskCard) {
  const value = Number(meta(task, "checklist_sort_order"));
  return Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
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

function rowDetail(task: AtlasTaskCard) {
  return text(meta(task, "checklist_detail")) || text(meta(task, "display_detail"));
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

  const orderedTasks = [...childTasks].sort((a, b) => sortOrder(a) - sortOrder(b) || a.title.localeCompare(b.title));
  const heading = text(meta(orderedTasks[0], "checklist_group_label")) || "Checklist";

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
        .atlas-stateful-children { margin:0 28px 20px; padding:16px 0 0; border-top:1px solid rgba(66,65,82,.11); color:#3d3e50; }
        .atlas-stateful-children__heading { display:block; margin-bottom:10px; color:#777ca0; font-size:.66rem; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-stateful-children__list { display:grid; gap:12px; margin:0; padding:0; list-style:none; }
        .atlas-stateful-children__row { display:grid; grid-template-columns:42px minmax(0,1fr) auto; gap:7px; align-items:start; min-height:42px; color:#555766; }
        .atlas-stateful-children__branch { margin-left:-5px; padding-top:3px; color:#9a9cac; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.83rem; line-height:1.25; letter-spacing:-.08em; white-space:pre; }
        .atlas-stateful-children__body { min-width:0; }
        .atlas-stateful-children__body strong { display:block; font-size:.9rem; line-height:1.3; }
        .atlas-stateful-children__body p { margin:3px 0 0; color:#747582; font-size:.75rem; line-height:1.35; }
        .atlas-stateful-children__row.is-done .atlas-stateful-children__body strong { color:#696b76; text-decoration:line-through; text-decoration-thickness:1px; }
        .atlas-stateful-children__action { margin-top:-2px; border:0; padding:4px 0 4px 9px; background:transparent; color:#675b8f; font:inherit; font-size:.72rem; font-weight:900; white-space:nowrap; text-align:right; }
        .atlas-stateful-children__row.is-done .atlas-stateful-children__action { color:#72746e; }
        .atlas-stateful-children__action:disabled { opacity:.48; }
        .atlas-stateful-children__message { grid-column:2 / -1; margin:0; color:#865f4f; font-size:.72rem; font-weight:700; line-height:1.3; }
        @media (max-width:560px) {
          .atlas-stateful-children { margin:0 21px 18px; }
          .atlas-stateful-children__row { grid-template-columns:34px minmax(0,1fr) auto; gap:5px; }
          .atlas-stateful-children__branch { margin-left:-9px; }
          .atlas-stateful-children__action { font-size:.68rem; }
        }
      `}</style>
      <span className="atlas-stateful-children__heading">{heading}</span>
      <ul className="atlas-stateful-children__list">
        {orderedTasks.map((task, index) => {
          const done = isDone(task);
          const saving = savingId === task.task_id;
          const detail = rowDetail(task);
          const final = index === orderedTasks.length - 1;
          return (
            <li key={task.task_id} className={`atlas-stateful-children__row${done ? " is-done" : ""}`} data-stateful-child-task-id={task.task_id}>
              <span className="atlas-stateful-children__branch" aria-hidden="true">{final ? "└──" : "├──"}</span>
              <div className="atlas-stateful-children__body">
                <strong>{rowLabel(task)}</strong>
                {detail ? <p>{detail}</p> : null}
              </div>
              <button className="atlas-stateful-children__action" type="button" disabled={Boolean(savingId)} onClick={() => void toggle(task, done ? "open" : "done")}>
                {saving ? "Saving…" : done ? "Reopen" : actionLabel(task)}
              </button>
              {message[task.task_id] ? <p className="atlas-stateful-children__message">{message[task.task_id]}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
