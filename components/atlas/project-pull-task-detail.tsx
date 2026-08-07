"use client";

import { useState } from "react";

import DominionAssignedTaskDetail from "@/components/atlas/dominion-assigned-task-detail";
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

export default function ProjectPullTaskDetail(props: Props) {
  const [returning, setReturning] = useState(false);
  const [message, setMessage] = useState("");

  async function returnToPool() {
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
          taskId: props.task.task_id,
          note: "Not today — returned to the durable Finish Project pool.",
        }),
      });
      const result = await response.json() as ReturnResponse;
      if (!response.ok || !result.ok) {
        throw new Error(responseMessage(result));
      }
      window.location.assign("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not return this card to the pool.");
      setReturning(false);
    }
  }

  return (
    <>
      <DominionAssignedTaskDetail {...props} />
      <aside style={{
        position: "fixed",
        zIndex: 40,
        left: "50%",
        bottom: 14,
        transform: "translateX(-50%)",
        width: "min(430px, calc(100vw - 28px))",
        border: "1px solid rgba(36,35,31,.16)",
        borderRadius: 14,
        padding: 10,
        background: "rgba(247,244,236,.96)",
        boxShadow: "0 10px 32px rgba(30,28,22,.13)",
        backdropFilter: "blur(8px)",
      }}>
        <button
          type="button"
          disabled={returning}
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
            cursor: returning ? "default" : "pointer",
            opacity: returning ? .5 : .72,
          }}
        >
          {returning ? "Returning to project pool…" : "Not this one today · return it to the Finish Project"}
        </button>
        {message ? <p style={{ margin: "6px 8px 2px", fontSize: 12, color: "#7a2d29" }}>{message}</p> : null}
      </aside>
    </>
  );
}
