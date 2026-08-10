"use client";

import { useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskInstrumentContext,
} from "@/components/atlas/assigned-task-execution-shell";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type ReturnResponse = {
  ok?: boolean;
  message?: string;
  error?: string | { code?: string; message?: string };
};

function responseMessage(result: ReturnResponse) {
  if (result.message) return result.message;
  if (typeof result.error === "string") return result.error;
  if (result.error?.message) return result.error.message;
  return "Atlas could not return this card to the pool.";
}

function ProjectPullReturnInstrument({
  task,
  busy,
  returnHref,
}: AssignedTaskInstrumentContext) {
  const [returning, setReturning] = useState(false);
  const [message, setMessage] = useState("");

  async function returnToPool() {
    if (returning || busy) return;
    try {
      setReturning(true);
      setMessage("");
      const response = await fetch("/api/atlas/project-pull/return", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-atlas-intent": "project-pull-return-v1",
        },
        body: JSON.stringify({
          taskId: task.task_id,
          note: "Not today — returned to the durable Finish Project pool.",
        }),
      });
      const result = await response.json() as ReturnResponse;
      if (!response.ok || !result.ok) {
        throw new Error(responseMessage(result));
      }
      window.location.assign(returnHref);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not return this card to the pool.");
      setReturning(false);
    }
  }

  return (
    <section data-atlas-method-instrument="project-pull-return" style={{ padding: "0 18px 18px" }}>
      <button
        type="button"
        disabled={returning || busy}
        onClick={() => void returnToPool()}
        style={{
          width: "100%",
          border: "1px solid rgba(36,35,31,.12)",
          borderRadius: 12,
          padding: "11px 14px",
          background: "rgba(247,244,236,.72)",
          color: "inherit",
          font: "inherit",
          fontSize: 13,
          fontWeight: 650,
          cursor: returning || busy ? "default" : "pointer",
          opacity: returning || busy ? .5 : .72,
        }}
      >
        {returning ? "Returning to project pool…" : "Not this one today · return it to the Finish Project"}
      </button>
      {message ? <p style={{ margin: "6px 8px 2px", fontSize: 12, color: "#7a2d29" }}>{message}</p> : null}
    </section>
  );
}

export default function ProjectPullTaskDetail(props: Props) {
  return (
    <AssignedTaskExecutionShell
      {...props}
      methodInstrument={ProjectPullReturnInstrument}
    />
  );
}
