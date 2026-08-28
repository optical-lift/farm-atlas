"use client";

import { useCallback, useEffect, useState } from "react";

import FlowerPreparationFocusPage, {
  type FlowerPreparationTask,
} from "@/app/task-focus/[taskId]/FlowerPreparationFocusPage";
import FlowerPreparationDirectiveCard, {
  type DirectiveFlowerPreparationTask,
  type FlowerPreparationDirective,
} from "@/components/atlas/flower-preparation-directive-card";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type PreparationContext = FlowerPreparationTask & {
  directive?: FlowerPreparationDirective | null;
};

type ContextResponse = {
  ok?: boolean;
  error?: string;
  task?: PreparationContext;
};

export default function FlowerPreparationTaskLoader({ task, assignee }: Props) {
  const [context, setContext] = useState<PreparationContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch(`/api/atlas/flower-preparation-context?taskId=${encodeURIComponent(task.task_id)}`, { cache: "no-store" });
      const payload = await response.json() as ContextResponse;
      if (!response.ok || !payload.ok || !payload.task) throw new Error(payload.error || "Preparation context could not be loaded.");
      setContext({ ...payload.task, returnTo: assignee.listPath });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Preparation context could not be loaded.");
    }
  }, [assignee.listPath, task.task_id]);

  useEffect(() => { void load(); }, [load]);

  if (context?.directive) {
    return <FlowerPreparationDirectiveCard task={context as DirectiveFlowerPreparationTask} />;
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
