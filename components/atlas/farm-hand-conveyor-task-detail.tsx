"use client";

import { useState } from "react";

import DominionAssignedTaskDetail from "@/components/atlas/dominion-assigned-task-detail";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition, type AtlasTaskTransition } from "@/lib/atlas/task-transition-client";
import { reportAtlasNeedLighterWork } from "@/lib/atlas/worker-support-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type ConveyorAction = "done" | "progress" | "need" | "changed" | "lighter" | "reschedule";

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function FarmHandConveyorTaskDetail(props: Props) {
  const [saving, setSaving] = useState<ConveyorAction | null>(null);
  const [message, setMessage] = useState("");

  async function record(
    action: ConveyorAction,
    transition: AtlasTaskTransition,
    promptText?: string,
    fallbackNote?: string,
  ) {
    try {
      setSaving(action);
      setMessage("");
      const note = promptText
        ? window.prompt(promptText, "")?.trim() || fallbackNote || ""
        : fallbackNote || "";
      await postAtlasTaskTransition({
        taskId: props.task.task_id,
        transition,
        note,
        reason: note,
        laneKey: props.task.action_key || undefined,
        workKey: props.task.action_key || undefined,
        payload: {
          workClass: props.task.work_class,
          assigneeKey: props.assignee.key,
          workerResponse: action,
          source: "farm_hand_conveyor",
        },
      });
      window.location.assign("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not save what happened.");
      setSaving(null);
    }
  }

  async function reschedule(targetDate: string | null, reason: string, scheduleIntent?: string) {
    try {
      setSaving("reschedule");
      setMessage("");
      await postAtlasTaskTransition({
        taskId: props.task.task_id,
        transition: "rescheduled",
        ...(targetDate ? { targetDate } : {}),
        reason,
        laneKey: props.task.action_key || undefined,
        workKey: props.task.action_key || undefined,
        payload: {
          assigneeKey: props.assignee.key,
          source: "farm_hand_conveyor",
          ...(scheduleIntent ? { scheduleIntent } : {}),
        },
      });
      window.location.assign("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not reschedule the card.");
      setSaving(null);
    }
  }

  async function needLighterWork() {
    try {
      setSaving("lighter");
      setMessage("");
      await reportAtlasNeedLighterWork(props.task.task_id);
      window.location.assign("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not adjust the work stream.");
      setSaving(null);
    }
  }

  return (
    <>
      <style>{`.atlas-task-result-footer{display:none!important}.atlas-task-page-body{padding-bottom:250px!important}`}</style>
      <DominionAssignedTaskDetail {...props} />
      <aside
        aria-label="Tell Atlas what happened"
        style={{
          position: "fixed",
          zIndex: 45,
          left: "50%",
          bottom: 14,
          transform: "translateX(-50%)",
          width: "min(430px, calc(100vw - 28px))",
          border: "1px solid rgba(36,35,31,.16)",
          borderRadius: 14,
          padding: 10,
          background: "rgba(247,244,236,.98)",
          boxShadow: "0 10px 32px rgba(30,28,22,.13)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
          <button type="button" disabled={Boolean(saving)} onClick={() => void record("done", "done")} style={primaryButtonStyle}>
            {saving === "done" ? "Saving…" : "Done"}
          </button>
          <button type="button" disabled={Boolean(saving)} onClick={() => void record("progress", "partial", "What did you get done?", "Made progress")} style={buttonStyle}>
            {saving === "progress" ? "Saving…" : "Made progress"}
          </button>
          <button type="button" disabled={Boolean(saving)} onClick={() => void record("need", "blocked", "What do you need?", "Need something")} style={buttonStyle}>
            {saving === "need" ? "Saving…" : "Need something"}
          </button>
          <button type="button" disabled={Boolean(saving)} onClick={() => void record("changed", "changed_plan", "What changed on the farm?", "Farm changed")} style={buttonStyle}>
            {saving === "changed" ? "Saving…" : "Farm changed"}
          </button>
        </div>
        <button type="button" disabled={Boolean(saving)} onClick={() => void needLighterWork()} style={lighterButtonStyle}>
          {saving === "lighter" ? "Adjusting the work…" : "Need lighter work"}
        </button>
        <details style={{ marginTop: 2 }}>
          <summary style={{ cursor: "pointer", padding: "7px 10px", fontSize: 13, fontWeight: 650 }}>Move this card</summary>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7, padding: "3px 0 2px" }}>
            <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(null, "Moved to next Elm Farm calendar day from farm-hand task page", "next_day")} style={buttonStyle}>Tomorrow</button>
            <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(addDays(todayIso(), 7), "Moved to next week from farm-hand task page")} style={buttonStyle}>Next week</button>
            <button type="button" disabled={Boolean(saving)} onClick={() => {
              const date = window.prompt("Pick a date (YYYY-MM-DD)", props.task.due_date || todayIso())?.trim();
              if (date) void reschedule(date, "Rescheduled from farm-hand task page");
            }} style={buttonStyle}>Pick a date</button>
          </div>
          {saving === "reschedule" ? <p style={{ margin: "5px 8px 0", fontSize: 12 }}>Moving card…</p> : null}
        </details>
        {message ? <p style={{ margin: "6px 8px 2px", fontSize: 12, color: "#7a2d29" }}>{message}</p> : null}
      </aside>
    </>
  );
}

const buttonStyle = {
  border: "1px solid rgba(36,35,31,.16)",
  borderRadius: 10,
  padding: "11px 8px",
  background: "#fffdf7",
  color: "inherit",
  font: "inherit",
  fontSize: 13,
  fontWeight: 650,
  cursor: "pointer",
} as const;

const primaryButtonStyle = {
  ...buttonStyle,
  background: "#4d3475",
  color: "white",
  borderColor: "#4d3475",
} as const;

const lighterButtonStyle = {
  width: "100%",
  border: 0,
  borderRadius: 10,
  padding: "10px 14px 7px",
  marginTop: 3,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  fontSize: 13,
  fontWeight: 650,
  cursor: "pointer",
  opacity: .76,
} as const;
