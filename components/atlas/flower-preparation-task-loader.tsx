"use client";

import { useCallback, useEffect, useState } from "react";

import FlowerPreparationFocusPage, { type FlowerPreparationTask } from "@/app/task-focus/[taskId]/FlowerPreparationFocusPage";
import DirectedFlowerPreparationTaskDetail, { type DirectedPreparationTask } from "@/components/atlas/directed-flower-preparation-task-detail";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = { task: AtlasTaskCard; childTasks: AtlasTaskCard[]; assignee: AtlasAssigneeConfig };
type PreparationContext = FlowerPreparationTask & Partial<Pick<DirectedPreparationTask, "directiveId" | "directiveLines">>;
type ContextResponse = { ok?: boolean; error?: string; task?: PreparationContext };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function focusedTaskId() {
  if (typeof window === "undefined") return "";
  const match = window.location.pathname.match(/^\/task-focus\/([^/?#]+)/i);
  if (!match?.[1]) return "";
  try {
    const candidate = decodeURIComponent(match[1]).trim();
    return UUID_PATTERN.test(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

function preparationTaskId(task: AtlasTaskCard) {
  // The Task Focus route is the canonical identity of the task the worker opened.
  // Prefer it over a re-hydrated card field so this loader cannot lose the task id
  // between the server-rendered task card and the client-side context request.
  const routeTaskId = focusedTaskId();
  if (routeTaskId) return routeTaskId;

  const cardTaskId = typeof task.task_id === "string" ? task.task_id.trim() : "";
  return UUID_PATTERN.test(cardTaskId) ? cardTaskId : "";
}

export default function FlowerPreparationTaskLoader({ task, assignee }: Props) {
  const [context, setContext] = useState<PreparationContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const taskId = preparationTaskId(task);
      if (!taskId) throw new Error("This preparation task lost its focused task identity.");
      const response = await fetch(`/api/atlas/flower-preparation-context?taskId=${encodeURIComponent(taskId)}`, { cache: "no-store" });
      const payload = await response.json() as ContextResponse;
      if (!response.ok || !payload.ok || !payload.task) throw new Error(payload.error || "Preparation context could not be loaded.");
      setContext({ ...payload.task, returnTo: assignee.listPath });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Preparation context could not be loaded.");
    }
  }, [assignee.listPath, task]);

  useEffect(() => { void load(); }, [load]);

  if (context?.directiveId && context.directiveLines?.length) {
    return <DirectedFlowerPreparationTaskDetail task={{
      id: context.id,
      dueDate: context.dueDate,
      harvestDate: context.harvestDate,
      directiveId: context.directiveId,
      directiveLines: context.directiveLines,
      returnTo: context.returnTo,
    }} />;
  }
  if (context) return <FlowerPreparationFocusPage task={context} />;

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 520, width: "100%", border: "1px solid rgba(88,87,111,.14)", borderRadius: 18, background: "#fffdf7", padding: 20 }}>
        <small style={{ display: "block", fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase" }}>Atlas · Prepare</small>
        <h1 style={{ margin: "8px 0", fontSize: 24 }}>Harvested flowers</h1>
        <p style={{ margin: 0, lineHeight: 1.45 }}>{error || "Reading the harvested physical inputs for this preparation…"}</p>
        {error ? <button type="button" onClick={() => void load()} style={{ marginTop: 14, minHeight: 38, padding: "0 14px", borderRadius: 999 }}>Try again</button> : null}
      </div>
    </main>
  );
}
