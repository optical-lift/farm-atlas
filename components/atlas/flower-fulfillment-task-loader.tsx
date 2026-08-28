"use client";

import { useCallback, useEffect, useState } from "react";

import FlowerFulfillmentFocusPage, { type FlowerFulfillmentTask } from "@/app/task-focus/[taskId]/FlowerFulfillmentFocusPage";
import DestinationAssignedTaskCard, { isDestinationTask } from "@/components/atlas/destination-assigned-task-card";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = { task: AtlasTaskCard; childTasks: AtlasTaskCard[]; assignee: AtlasAssigneeConfig };
type ContextResponse = { ok?: boolean; error?: string; task?: FlowerFulfillmentTask };

function FlowerFulfillmentContextLoader({ task, assignee }: Pick<Props, "task" | "assignee">) {
  const [context, setContext] = useState<FlowerFulfillmentTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch(`/api/atlas/flower-fulfillment-context?taskId=${encodeURIComponent(task.task_id)}`, { cache: "no-store" });
      const payload = await response.json() as ContextResponse;
      if (!response.ok || !payload.ok || !payload.task) throw new Error(payload.error || "Fulfillment context could not be loaded.");
      setContext({ ...payload.task, returnTo: assignee.listPath });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Fulfillment context could not be loaded.");
    }
  }, [assignee.listPath, task.task_id]);
  useEffect(() => { void load(); }, [load]);
  if (context) return <FlowerFulfillmentFocusPage task={context} />;
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 520, width: "100%", border: "1px solid rgba(88,87,111,.14)", borderRadius: 18, background: "#fffdf7", padding: 20 }}>
        <small style={{ display: "block", fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>Atlas · Fulfill</small>
        <h1 style={{ margin: "8px 0", fontSize: 24 }}>Committed flower order</h1>
        <p style={{ margin: 0, lineHeight: 1.45 }}>{error || "Reading the committed order and handoff requirement…"}</p>
        {error ? <button type="button" onClick={() => void load()} style={{ marginTop: 14, minHeight: 38, padding: "0 14px", borderRadius: 999 }}>Try again</button> : null}
      </div>
    </main>
  );
}

export default function FlowerFulfillmentTaskLoader({ task, childTasks, assignee }: Props) {
  if (isDestinationTask(task)) {
    return <DestinationAssignedTaskCard task={task} childTasks={childTasks} assignee={assignee} />;
  }
  return <FlowerFulfillmentContextLoader task={task} assignee={assignee} />;
}
