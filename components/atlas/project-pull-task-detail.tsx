"use client";

import { useState } from "react";

import AssignedTaskExecutionShell, {
  type AssignedTaskResultInstrumentContext,
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
}: AssignedTaskResultInstrumentContext) {
  const [returning, setReturning] = useState(false);
  const [message, setMessage] = useState("");

  async function returnToPool() {
    if (busy || returning) return;
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
    <section data-atlas-supplemental-result-instrument="project-pull-return" style={{ paddingTop: 4 }}>
      <button
        type="button"
        disabled={busy || returning}
        onClick={() => void returnToPool()}
        style={{
          width: "100%",
          border: 0,
          borderRadius: 10,
          padding: "11px 14px",
          background: "transparent",
          color: "inherit",
          font: "inherit",
          fontSize: 13,
          fontWeight: 650,
          cursor: busy || returning ? "default" : "pointer",
          opacity: busy || returning ? .5 : .72,
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
      supplementalResultInstrument={(context) => <ProjectPullReturnInstrument {...context} />}
    />
  );
}
