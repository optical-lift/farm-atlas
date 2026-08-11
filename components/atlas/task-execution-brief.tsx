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
  if (!how.length && !details) return null;
  return (
    <section className="atlas-human-task-instructions" aria-label="Instructions">
      <style>{`
        .atlas-human-task-instructions { margin:0 28px 21px; padding:14px 0 0; border-top:1px solid rgba(66,65,82,.11); color:#3d3e50; }
        .atlas-human-task-instructions h2 { margin:0 0 9px; color:#777ca0; font-size:.68rem; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-human-task-instructions ul { display:grid; gap:7px; margin:0; padding:0 0 0 18px; }
        .atlas-human-task-instructions li { padding-left:1px; font-size:.9rem; font-weight:690; line-height:1.42; }
        .atlas-human-task-instructions__note { margin:10px 0 0; padding:9px 11px; border-left:2px solid rgba(113,116,153,.38); background:#faf9f5; color:#5f606b; white-space:pre-line; font-size:.82rem; line-height:1.46; }
        @media (max-width:560px) { .atlas-human-task-instructions { margin:0 21px 18px; } }
      `}</style>
      <h2>Instructions</h2>
      {how.length ? <ul>{how.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul> : null}
      {details ? <p className="atlas-human-task-instructions__note">{details}</p> : null}
    </section>
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
        // Compatibility rendering below remains available if canonical resolution fails.
      });

    return () => controller.abort();
  }, [assembly, assemblyControlled, task?.task_id]);

  const resolvedDo = doText || resolvedAssembly?.execution.what || model?.doText || "Do this task";
  const resolvedPlace = placeText || resolvedAssembly?.execution.where || model?.placeText || "Elm Farm";
  const resolvedHow = howLines?.length
    ? howLines
    : resolvedAssembly?.execution.how.length
      ? resolvedAssembly.execution.how
      : model?.howLines || ["Follow the task instructions."];
  const resolvedDone = doneWhen || resolvedAssembly?.execution.doneWhen || model?.doneWhen || "The requested work is finished.";
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

  // Compatibility state while the canonical assembly is loading/unavailable. It
  // uses the same human grammar instead of exposing a second visual architecture.
  return (
    <section className="atlas-task-execution-brief atlas-task-execution-brief--human" aria-label="Task instructions">
      <style>{`
        .atlas-human-task-fallback { margin:0; padding:23px 28px 19px; background:#fff; color:#303145; }
        .atlas-human-task-fallback__place { margin:0 0 5px; color:#777ca0; font-size:.7rem; font-weight:900; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-human-task-fallback h1 { margin:0; font-size:clamp(1.8rem,6vw,2.65rem); line-height:1.02; letter-spacing:-.035em; }
        .atlas-human-task-fallback__due { display:block; margin-top:8px; color:#6b6d7b; font-size:.72rem; font-weight:780; }
        .atlas-human-task-fallback__trail { position:relative; display:grid; gap:18px; margin-top:21px; padding-left:26px; }
        .atlas-human-task-fallback__trail::before { content:""; position:absolute; left:6px; top:9px; bottom:9px; width:1px; background:rgba(86,89,112,.27); }
        .atlas-human-task-fallback__step { position:relative; }
        .atlas-human-task-fallback__step::before { content:""; position:absolute; left:-26px; top:3px; width:13px; height:13px; border:2px solid #6d7088; border-radius:50%; background:#6d7088; box-shadow:0 0 0 4px #fff; }
        .atlas-human-task-fallback__step:last-child::before { background:#fff; }
        .atlas-human-task-fallback__step small { display:block; margin-bottom:3px; color:#898ba0; font-size:.64rem; font-weight:900; letter-spacing:.1em; text-transform:uppercase; }
        .atlas-human-task-fallback__step strong,.atlas-human-task-fallback__step span { display:block; font-size:.91rem; line-height:1.4; }
        @media (max-width:560px) { .atlas-human-task-fallback { padding:21px 21px 17px; } }
      `}</style>
      <section className="atlas-human-task-fallback">
        <p className="atlas-human-task-fallback__place">{resolvedPlace}</p>
        <h1>{task?.title || resolvedDo}</h1>
        {resolvedDue ? <span className="atlas-human-task-fallback__due">{resolvedDue}</span> : null}
        <div className="atlas-human-task-fallback__trail">
          <div className="atlas-human-task-fallback__step"><small>Do this</small><strong>{resolvedDo}</strong></div>
          <div className="atlas-human-task-fallback__step"><small>Finished</small><span>{resolvedDone}</span></div>
        </div>
      </section>
      <Instructions how={resolvedHow} details={resolvedDetails} />
    </section>
  );
}
