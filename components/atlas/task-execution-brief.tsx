"use client";

import { useEffect, useState } from "react";

import TaskMoveSpine from "@/components/atlas/task-move-spine";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasActionForTask } from "@/lib/atlas/task-display";
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

function metadataText(task: AtlasTaskCard | undefined, key: string) {
  const value = task?.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataLines(task: AtlasTaskCard | undefined, key: string) {
  const value = task?.metadata?.[key];
  return Array.isArray(value)
    ? value.filter((line): line is string => typeof line === "string" && Boolean(line.trim())).map((line) => line.trim())
    : [];
}

function presentationAssembly(assembly: TaskMoveAssembly | null | undefined, task: AtlasTaskCard | undefined) {
  if (!assembly) return null;
  const displaySubject = metadataText(task, "display_subject");
  if (!displaySubject) return assembly;
  return {
    ...assembly,
    spine: {
      ...assembly.spine,
      move: {
        ...assembly.spine.move,
        subject: {
          ...assembly.spine.move.subject,
          label: displaySubject,
          status: "resolved" as const,
          provenance: "task_record" as const,
        },
      },
    },
  };
}

function VisibleMethod({ label, how, details }: { label: string; how: string[]; details: string | null }) {
  const lines = how.map((line) => line.trim()).filter(Boolean);
  const fallbackDetail = !lines.length && details?.trim() ? details.trim() : null;
  if (!lines.length && !fallbackDetail) return null;

  return (
    <section className="atlas-worker-method" aria-label={label}>
      <style>{`
        .atlas-worker-method { margin:0 28px 20px; padding:14px 0 0; border-top:1px solid rgba(66,65,82,.11); color:#3d3e50; }
        .atlas-worker-method__label { display:block; margin-bottom:9px; color:#777ca0; font-size:.66rem; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-worker-method__list { display:grid; gap:7px; margin:0; padding:0; list-style:none; }
        .atlas-worker-method__item { display:grid; grid-template-columns:17px minmax(0,1fr); gap:8px; align-items:start; font-size:.87rem; font-weight:720; line-height:1.35; }
        .atlas-worker-method__mark { color:#767a98; font-weight:950; }
        .atlas-worker-method p { margin:0; font-size:.87rem; font-weight:680; line-height:1.4; white-space:pre-line; }
        @media (max-width:560px) { .atlas-worker-method { margin:0 21px 18px; } }
      `}</style>
      <span className="atlas-worker-method__label">{label}</span>
      {lines.length ? (
        <ul className="atlas-worker-method__list">
          {lines.map((line, index) => (
            <li className="atlas-worker-method__item" key={`${line}-${index}`}>
              <span className="atlas-worker-method__mark" aria-hidden="true">—</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {fallbackDetail ? <p>{fallbackDetail}</p> : null}
    </section>
  );
}

function VisibleFacts({ label, lines }: { label: string; lines: string[] }) {
  if (!lines.length) return null;
  return (
    <section className="atlas-worker-facts" aria-label={label}>
      <style>{`
        .atlas-worker-facts { margin:0 28px 20px; padding:14px 0 0; border-top:1px solid rgba(66,65,82,.11); color:#3d3e50; }
        .atlas-worker-facts__label { display:block; margin-bottom:9px; color:#777ca0; font-size:.66rem; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-worker-facts__list { display:grid; gap:6px; margin:0; padding:0; list-style:none; }
        .atlas-worker-facts__item { font-size:.82rem; font-weight:710; line-height:1.35; color:#5a5c6a; }
        @media (max-width:560px) { .atlas-worker-facts { margin:0 21px 18px; } }
      `}</style>
      <span className="atlas-worker-facts__label">{label}</span>
      <ul className="atlas-worker-facts__list">
        {lines.map((line, index) => <li className="atlas-worker-facts__item" key={`${line}-${index}`}>{line}</li>)}
      </ul>
    </section>
  );
}

function stripLeadingAction(action: string, text: string) {
  const trimmed = text.trim();
  if (!action.trim() || !trimmed.toLowerCase().startsWith(`${action.trim().toLowerCase()} `)) return trimmed;
  return trimmed.slice(action.trim().length).trim();
}

export default function TaskExecutionBrief({
  task,
  assembly,
  doText,
  placeText,
  howLines,
  doneWhen: _doneWhen,
  details,
  dueLabel,
}: Props) {
  const model = task ? taskExecutionModel(task) : null;
  const assemblyControlled = assembly !== undefined;
  const [resolvedAssembly, setResolvedAssembly] = useState<TaskMoveAssembly | null>(() => presentationAssembly(assembly ?? null, task));

  useEffect(() => {
    if (assemblyControlled) {
      setResolvedAssembly(presentationAssembly(assembly ?? null, task));
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
        if (nextAssembly) setResolvedAssembly(presentationAssembly(nextAssembly, task));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });

    return () => controller.abort();
  }, [assembly, assemblyControlled, task]);

  const resolvedDo = doText || resolvedAssembly?.execution.what || model?.doText || "";
  const resolvedPlace = placeText || resolvedAssembly?.execution.where || model?.placeText || "Elm Farm";
  const resolvedHow = howLines?.length
    ? howLines
    : resolvedAssembly?.execution.how.length
      ? resolvedAssembly.execution.how
      : model?.howLines || [];
  const resolvedDetails = details === undefined
    ? resolvedAssembly?.execution.details || model?.details || null
    : details;
  const resolvedDue = dueLabel === undefined
    ? resolvedAssembly?.execution.dueLabel || model?.dueLabel || null
    : dueLabel;
  const displaySubject = metadataText(task, "display_subject");
  const fallbackTitle = displaySubject || task?.title || resolvedDo;
  const detailHeading = metadataText(task, "detail_heading") || "Timing forecast";
  const directDetailLines = metadataLines(task, "detail_lines");
  const detailLines = directDetailLines.length ? directDetailLines : metadataLines(task, "projection_detail_lines");
  const resultLines = metadataLines(task, "worker_result_lines");

  if (resolvedAssembly) {
    return (
      <section className="atlas-task-execution-brief atlas-task-execution-brief--human" aria-label="Task instructions">
        <TaskMoveSpine assembly={resolvedAssembly} />
        <VisibleMethod
          label={resolvedAssembly.execution.howLabel || "Steps"}
          how={resolvedHow}
          details={resolvedDetails}
        />
        <VisibleFacts label={detailHeading} lines={detailLines} />
        <VisibleFacts label="Next" lines={resultLines} />
      </section>
    );
  }

  const action = task ? atlasActionForTask(task) : "Task";
  const actionDetail = resolvedDo ? stripLeadingAction(action, resolvedDo) : "";
  const showAction = Boolean(actionDetail && actionDetail.toLowerCase() !== fallbackTitle.toLowerCase());

  return (
    <section className="atlas-task-execution-brief atlas-task-execution-brief--human" aria-label="Task instructions">
      <style>{`
        .atlas-worker-fallback { margin:0; padding:22px 28px 18px; background:#fff; color:#303145; }
        .atlas-worker-fallback__place { margin:0 0 6px; color:#777ca0; font-size:.67rem; font-weight:920; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-worker-fallback h1 { margin:0; font-size:clamp(1.9rem,6vw,2.7rem); line-height:1.02; letter-spacing:-.035em; }
        .atlas-worker-fallback__due { display:block; margin-top:8px; color:#6b6d7b; font-size:.75rem; font-weight:780; }
        .atlas-worker-fallback__action { margin-top:22px; }
        .atlas-worker-fallback__action small { display:block; margin-bottom:4px; color:#8589a6; font-size:.64rem; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-worker-fallback__action strong { display:block; font-size:1rem; line-height:1.35; }
        @media (max-width:560px) { .atlas-worker-fallback { padding:20px 21px 16px; } }
      `}</style>
      <section className="atlas-worker-fallback">
        <p className="atlas-worker-fallback__place">{resolvedPlace} · {action}</p>
        <h1>{fallbackTitle}</h1>
        {resolvedDue ? <span className="atlas-worker-fallback__due">{resolvedDue}</span> : null}
        {showAction ? (
          <div className="atlas-worker-fallback__action">
            <small>{action}</small>
            <strong>{actionDetail}</strong>
          </div>
        ) : null}
      </section>
      <VisibleMethod label="Steps" how={resolvedHow} details={resolvedDetails} />
      <VisibleFacts label={detailHeading} lines={detailLines} />
      <VisibleFacts label="Next" lines={resultLines} />
    </section>
  );
}
