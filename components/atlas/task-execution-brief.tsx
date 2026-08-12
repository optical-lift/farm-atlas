"use client";

import { useEffect, useState } from "react";

import TaskMoveSpine from "@/components/atlas/task-move-spine";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { taskExecutionModel } from "@/lib/atlas/task-execution";
import type { TaskMoveAssembly } from "@/lib/atlas/task-move-assembly";

type Props = {
  task?: AtlasTaskCard;
  assembly?: TaskMoveAssembly | null;
  doText?: string;
  placeText?: string;
  howLines?: string[];
  doneWhen?: string;
  details?: string | null;
  dueLabel?: string | null;
};

type TaskMoveResponse = {
  ok?: boolean;
  assembly?: TaskMoveAssembly;
};

function Instructions({ how, details }: { how: string[]; details: string | null }) {
  const lines = how.filter((line) => line.trim());
  const fallbackDetail = !lines.length && details?.trim() ? details.trim() : null;
  if (!lines.length && !fallbackDetail) return null;

  return (
    <details className="atlas-worker-instructions">
      <style>{`
        .atlas-worker-instructions { margin:0 28px 20px; padding:13px 0 0; border-top:1px solid rgba(66,65,82,.11); color:#3d3e50; }
        .atlas-worker-instructions summary { cursor:pointer; color:#777ca0; font-size:.69rem; font-weight:950; letter-spacing:.1em; text-transform:uppercase; list-style-position:outside; }
        .atlas-worker-instructions[open] summary { margin-bottom:10px; }
        .atlas-worker-instructions ul { display:grid; gap:7px; margin:0; padding:0 0 0 18px; }
        .atlas-worker-instructions li { padding-left:1px; font-size:.88rem; font-weight:680; line-height:1.4; }
        .atlas-worker-instructions p { margin:0; font-size:.88rem; font-weight:650; line-height:1.42; white-space:pre-line; }
        @media (max-width:560px) { .atlas-worker-instructions { margin:0 21px 18px; } }
      `}</style>
      <summary>Instructions</summary>
      {lines.length ? <ul>{lines.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul> : null}
      {fallbackDetail ? <p>{fallbackDetail}</p> : null}
    </details>
  );
}

export default function TaskExecutionBrief({
  task,
  assembly,
  doText,
  placeText,
  howLines,
  doneWhen,
  details,
  dueLabel,
}: Props) {
  const model = task ? taskExecutionModel(task) : null;
  const assemblyControlled = assembly !== undefined;
  const [resolvedAssembly, setResolvedAssembly] = useState<TaskMoveAssembly | null>(assembly ?? null);

  useEffect(() => {
    if (assemblyControlled) {
      setResolvedAssembly(assembly ?? null);
      return;
    }
    if (!task?.task_id) {
      setResolvedAssembly(null);
      return;
    }

    const controller = new AbortController();
    setResolvedAssembly(null);

    void fetch(`/api/atlas/task-move?taskId=${encodeURIComponent(task.task_id)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json() as TaskMoveResponse;
        if (!response.ok || !data.ok || !data.assembly) return null;
        return data.assembly;
      })
      .then((nextAssembly) => {
        if (nextAssembly) setResolvedAssembly(nextAssembly);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });

    return () => controller.abort();
  }, [assembly, assemblyControlled, task?.task_id]);

  const resolvedDo = doText || resolvedAssembly?.execution.what || model?.doText || "Do this task";
  const resolvedPlace = placeText || resolvedAssembly?.execution.where || model?.placeText || "Elm Farm";
  const resolvedHow = howLines?.length
    ? howLines
    : resolvedAssembly?.execution.how.length
      ? resolvedAssembly.execution.how
      : model?.howLines || [];
  const resolvedDone = doneWhen || resolvedAssembly?.execution.doneWhen || model?.doneWhen || "";
  const resolvedDetails = details === undefined
    ? resolvedAssembly?.execution.details || model?.details || null
    : details;
  const resolvedDue = dueLabel === undefined
    ? resolvedAssembly?.execution.dueLabel || model?.dueLabel || null
    : dueLabel;

  if (resolvedAssembly) {
    return (
      <section className="atlas-task-execution-brief atlas-task-execution-brief--human" aria-label="Task instructions">
        <TaskMoveSpine assembly={resolvedAssembly} />
        <Instructions how={resolvedHow} details={resolvedDetails} />
      </section>
    );
  }

  return (
    <section className="atlas-task-execution-brief atlas-task-execution-brief--human" aria-label="Task instructions">
      <style>{`
        .atlas-worker-fallback { margin:0; padding:22px 28px 18px; background:#fff; color:#303145; }
        .atlas-worker-fallback__place { margin:0 0 6px; color:#777ca0; font-size:.67rem; font-weight:920; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-worker-fallback h1 { margin:0; font-size:clamp(1.9rem,6vw,2.7rem); line-height:1.02; letter-spacing:-.035em; }
        .atlas-worker-fallback__due { display:block; margin-top:8px; color:#6b6d7b; font-size:.75rem; font-weight:780; }
        .atlas-worker-fallback__flow { display:grid; gap:20px; margin-top:22px; }
        .atlas-worker-fallback__step small { display:block; margin-bottom:4px; color:#8589a6; font-size:.64rem; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-worker-fallback__step strong { display:block; font-size:1rem; line-height:1.35; }
        @media (max-width:560px) { .atlas-worker-fallback { padding:20px 21px 16px; } }
      `}</style>
      <section className="atlas-worker-fallback">
        <p className="atlas-worker-fallback__place">{resolvedPlace}</p>
        <h1>{task?.metadata?.display_subject as string || task?.title || resolvedDo}</h1>
        {resolvedDue ? <span className="atlas-worker-fallback__due">{resolvedDue}</span> : null}
        <div className="atlas-worker-fallback__flow">
          <div className="atlas-worker-fallback__step"><small>Do this</small><strong>{resolvedDo}</strong></div>
          {resolvedDone ? <div className="atlas-worker-fallback__step"><small>Done</small><strong>{resolvedDone}</strong></div> : null}
        </div>
      </section>
      <Instructions how={resolvedHow} details={resolvedDetails} />
    </section>
  );
}
