"use client";

import { useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskResultInstrumentContext,
} from "@/components/atlas/assigned-task-execution-shell";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition, type AtlasTaskTransition } from "@/lib/atlas/task-transition-client";
import { reportAtlasNeedLighterWork } from "@/lib/atlas/worker-support-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type ConveyorAction = "done" | "progress" | "need" | "changed" | "lighter";

function FarmHandConveyorResultInstrument({
  task,
  assignee,
  assembly,
  busy,
  returnHref,
}: AssignedTaskResultInstrumentContext) {
  const [saving, setSaving] = useState<ConveyorAction | null>(null);
  const [message, setMessage] = useState("");
  const locked = Boolean(saving) || busy;
  const moveBlocked =
    locked ||
    !assembly ||
    assembly.readiness.status === "blocked" ||
    assembly.spine.connection === "stops_at_move";

  async function record(
    action: Exclude<ConveyorAction, "lighter">,
    transition: AtlasTaskTransition,
    promptText?: string,
    fallbackNote?: string,
  ) {
    if (locked) return;
    if ((action === "done" || action === "progress") && moveBlocked) return;

    try {
      setSaving(action);
      setMessage("");
      const note = promptText
        ? window.prompt(promptText, "")?.trim() || fallbackNote || ""
        : fallbackNote || "";
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition,
        note,
        reason: note,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: {
          workClass: task.work_class,
          assigneeKey: assignee.key,
          workerResponse: action,
          source: "farm_hand_conveyor",
        },
      });
      window.location.assign(returnHref);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not save what happened.");
      setSaving(null);
    }
  }

  async function needLighterWork() {
    if (locked) return;

    try {
      setSaving("lighter");
      setMessage("");
      await reportAtlasNeedLighterWork(task.task_id);
      window.location.assign(returnHref);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not adjust the work stream.");
      setSaving(null);
    }
  }

  return (
    <section data-atlas-result-instrument="farm-hand-conveyor">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
        <button
          type="button"
          disabled={moveBlocked}
          onClick={() => void record("done", "done")}
          style={primaryButtonStyle}
        >
          {saving === "done" ? "Saving…" : "Done"}
        </button>
        <button
          type="button"
          disabled={moveBlocked}
          onClick={() => void record("progress", "partial", "What did you get done?", "Made progress")}
          style={buttonStyle}
        >
          {saving === "progress" ? "Saving…" : "Made progress"}
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => void record("need", "blocked", "What do you need?", "Need something")}
          style={buttonStyle}
        >
          {saving === "need" ? "Saving…" : "Need something"}
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => void record("changed", "changed_plan", "What changed on the farm?", "Farm changed")}
          style={buttonStyle}
        >
          {saving === "changed" ? "Saving…" : "Farm changed"}
        </button>
      </div>
      <button type="button" disabled={locked} onClick={() => void needLighterWork()} style={lighterButtonStyle}>
        {saving === "lighter" ? "Adjusting the work…" : "Need lighter work"}
      </button>
      {message ? <p style={{ margin: "6px 8px 2px", fontSize: 12, color: "#7a2d29" }}>{message}</p> : null}
    </section>
  );
}

export default function FarmHandConveyorTaskDetail(props: Props) {
  return (
    <AssignedTaskExecutionShell
      {...props}
      resultInstrument={FarmHandConveyorResultInstrument}
    />
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
