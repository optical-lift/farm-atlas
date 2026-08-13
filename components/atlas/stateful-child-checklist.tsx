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
    <section className="atlas-stateful-children atlas-task-trail-section" aria-label={heading}>
      <style>{`
        .atlas-stateful-children {
          --atlas-task-trail-x:36px;
          position:relative;
          margin:0;
          padding:17px 28px 8px;
          border-top:1px solid rgba(66,65,82,.11);
          color:#3d3e50;
          background:#fff;
        }
        .atlas-stateful-children::before {
          content:"";
          position:absolute;
          left:var(--atlas-task-trail-x);
          top:-1px;
          bottom:-1px;
          width:1px;
          background:rgba(86,89,112,.28);
        }
        .atlas-stateful-children__heading {
          display:block;
          margin:0 0 13px 28px;
          color:#777ca0;
          font-size:.66rem;
          font-weight:950;
          letter-spacing:.11em;
          text-transform:uppercase;
        }
        .atlas-stateful-children__list { display:grid; gap:0; margin:0; padding:0; list-style:none; }
        .atlas-stateful-children__row {
          position:relative;
          min-height:58px;
          padding:1px 0 15px 60px;
          color:#555766;
        }
        .atlas-stateful-children__row::before {
          content:"";
          position:absolute;
          left:var(--atlas-task-trail-x);
          top:10px;
          width:27px;
          height:1px;
          background:rgba(86,89,112,.42);
        }
        .atlas-stateful-children__checkpoint {
          position:absolute;
          z-index:2;
          left:calc(var(--atlas-task-trail-x) - 9px);
          top:1px;
          width:19px;
          height:19px;
          display:grid;
          place-items:center;
          border:2px solid #6d7088;
          border-radius:50%;
          padding:0;
          background:#fff;
          color:#fff;
          font:inherit;
          font-size:.62rem;
          font-weight:950;
          line-height:1;
          box-shadow:0 0 0 4px #fff;
        }
        .atlas-stateful-children__checkpoint[data-state="done"] { background:#6d7088; }
        .atlas-stateful-children__checkpoint:disabled { opacity:.5; }
        .atlas-stateful-children__body { min-width:0; }
        .atlas-stateful-children__body strong { display:block; font-size:.9rem; line-height:1.3; }
        .atlas-stateful-children__body p { margin:3px 0 0; color:#747582; font-size:.75rem; line-height:1.35; }
        .atlas-stateful-children__row.is-done .atlas-stateful-children__body strong { color:#696b76; text-decoration:line-through; text-decoration-thickness:1px; }
        .atlas-stateful-children__message { margin:6px 0 0; color:#865f4f; font-size:.72rem; font-weight:700; line-height:1.3; }
        @media (max-width:560px) {
          .atlas-stateful-children { --atlas-task-trail-x:29px; padding:17px 21px 6px; }
          .atlas-stateful-children__heading { margin-left:28px; }
          .atlas-stateful-children__row { padding-left:54px; }
          .atlas-stateful-children__row::before { width:24px; }
        }
      `}</style>
      <span className="atlas-stateful-children__heading">{heading}</span>
      <ul className="atlas-stateful-children__list">
        {orderedTasks.map((task) => {
          const done = isDone(task);
          const saving = savingId === task.task_id;
          const detail = rowDetail(task);
          const accessibleAction = done ? `Reopen ${rowLabel(task)}` : `${actionLabel(task)}: ${rowLabel(task)}`;
          return (
            <li key={task.task_id} className={`atlas-stateful-children__row${done ? " is-done" : ""}`} data-stateful-child-task-id={task.task_id}>
              <button
                className="atlas-stateful-children__checkpoint"
                data-state={done ? "done" : "open"}
                type="button"
                aria-label={accessibleAction}
                title={accessibleAction}
                disabled={Boolean(savingId)}
                onClick={() => void toggle(task, done ? "open" : "done")}
              >
                {saving ? "…" : done ? "✓" : <span aria-hidden="true" />}
              </button>
              <div className="atlas-stateful-children__body">
                <strong>{rowLabel(task)}</strong>
                {detail ? <p>{detail}</p> : null}
                {message[task.task_id] ? <p className="atlas-stateful-children__message">{message[task.task_id]}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
