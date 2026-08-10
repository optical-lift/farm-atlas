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
  const [resolvedAssembly, setResolvedAssembly] = useState<TaskMoveAssembly | null>(assembly ?? null);

  useEffect(() => {
    if (assembly) {
      setResolvedAssembly(assembly);
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
        // Keep the compatibility execution brief visible if canonical resolution is unavailable.
      });

    return () => controller.abort();
  }, [assembly, task?.task_id]);

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
      <section className="atlas-task-execution-brief atlas-task-execution-brief--task-move" aria-label="Task instructions">
        <style>{`
          .atlas-task-execution-brief--task-move { margin:0; background:#fff; color:#2d2e44; }
          .atlas-task-execution-brief__support { margin:0 28px; padding:20px 0 24px; border-top:1px solid rgba(66,65,82,.12); }
          .atlas-task-execution-brief__support-title { margin:0 0 13px; color:#858bc0; font-size:.72rem; font-weight:900; letter-spacing:.14em; text-transform:uppercase; }
          .atlas-task-execution-brief__support-grid { display:grid; gap:12px; margin:0; }
          .atlas-task-execution-brief__support-row { display:grid; grid-template-columns:92px minmax(0,1fr); gap:14px; }
          .atlas-task-execution-brief__support-row dt { margin:2px 0 0; color:#858bc0; font-size:.7rem; font-weight:900; letter-spacing:.12em; text-transform:uppercase; }
          .atlas-task-execution-brief__support-row dd { margin:0; color:#3d3e50; font-size:.94rem; font-weight:690; line-height:1.42; }
          .atlas-task-execution-brief__support-row dd p { margin:0; }
          .atlas-task-execution-brief__support-row dd p + p { margin-top:5px; }
          .atlas-task-execution-brief__support details { margin-top:14px; border:1px solid rgba(66,65,82,.12); border-radius:14px; background:#fbfaf6; }
          .atlas-task-execution-brief__support summary { display:flex; justify-content:space-between; gap:12px; padding:11px 13px; cursor:pointer; color:#555667; font-size:.82rem; font-weight:850; list-style:none; }
          .atlas-task-execution-brief__support summary::-webkit-details-marker { display:none; }
          .atlas-task-execution-brief__support-details { margin:0; padding:0 13px 13px; white-space:pre-line; color:#5f606b; font-size:.86rem; line-height:1.48; }
          @media (max-width:560px) {
            .atlas-task-execution-brief__support { margin:0 21px; }
            .atlas-task-execution-brief__support-row { grid-template-columns:74px minmax(0,1fr); gap:10px; }
          }
        `}</style>
        <TaskMoveSpine assembly={resolvedAssembly} />
        <section className="atlas-task-execution-brief__support" aria-label="How to complete this move">
          <h2 className="atlas-task-execution-brief__support-title">Instructions</h2>
          <dl className="atlas-task-execution-brief__support-grid">
            {resolvedHow.length ? (
              <div className="atlas-task-execution-brief__support-row">
                <dt>How</dt>
                <dd>{resolvedHow.map((line) => <p key={line}>{line}</p>)}</dd>
              </div>
            ) : null}
            <div className="atlas-task-execution-brief__support-row">
              <dt>Done when</dt>
              <dd>{resolvedDone}</dd>
            </div>
          </dl>
          {resolvedDetails ? (
            <details>
              <summary><span>More instructions</span><span aria-hidden="true">⌄</span></summary>
              <p className="atlas-task-execution-brief__support-details">{resolvedDetails}</p>
            </details>
          ) : null}
        </section>
      </section>
    );
  }

  return (
    <section className="atlas-task-execution-brief" aria-label="Task instructions">
      <style>{`
        .atlas-task-execution-brief { margin: 0; padding: 28px 30px 26px; background: #fff; color: #2d2e44; }
        .atlas-task-execution-brief__head { padding-bottom: 22px; border-bottom: 1px solid rgba(66,65,82,.14); }
        .atlas-task-execution-brief__label { display:block; margin:0 0 7px; color:#858bc0; font-size:.76rem; font-weight:900; letter-spacing:.16em; text-transform:uppercase; }
        .atlas-task-execution-brief h1 { margin:0; max-width:18ch; font-size:clamp(2rem,7vw,3.4rem); line-height:.98; letter-spacing:-.045em; }
        .atlas-task-execution-brief__due { display:inline-block; margin-top:14px; padding:7px 11px; border:1px solid rgba(112,113,151,.18); border-radius:999px; background:#f7f7fb; color:#4f5065; font-size:.86rem; font-weight:800; }
        .atlas-task-execution-brief__rows { display:grid; margin:0; }
        .atlas-task-execution-brief__row { display:grid; grid-template-columns:92px minmax(0,1fr); gap:14px; padding:18px 0; border-bottom:1px solid rgba(66,65,82,.11); }
        .atlas-task-execution-brief dt { margin:2px 0 0; color:#858bc0; font-size:.72rem; font-weight:900; letter-spacing:.14em; text-transform:uppercase; }
        .atlas-task-execution-brief dd { margin:0; color:#333448; font-size:1.03rem; font-weight:760; line-height:1.38; }
        .atlas-task-execution-brief dd p { margin:0; }
        .atlas-task-execution-brief dd p + p { margin-top:5px; }
        .atlas-task-execution-brief details { margin-top:16px; border:1px solid rgba(66,65,82,.12); border-radius:15px; background:#fbfaf6; }
        .atlas-task-execution-brief summary { display:flex; justify-content:space-between; gap:12px; padding:12px 14px; cursor:pointer; color:#555667; font-size:.86rem; font-weight:850; list-style:none; }
        .atlas-task-execution-brief summary::-webkit-details-marker { display:none; }
        .atlas-task-execution-brief__details { margin:0; padding:0 14px 14px; white-space:pre-line; color:#5f606b; font-size:.9rem; line-height:1.48; }
        @media (max-width:560px) {
          .atlas-task-execution-brief { padding:24px 22px 22px; }
          .atlas-task-execution-brief__row { grid-template-columns:78px minmax(0,1fr); gap:10px; }
        }
      `}</style>
      <header className="atlas-task-execution-brief__head">
        <span className="atlas-task-execution-brief__label">Do</span>
        <h1>{resolvedDo}</h1>
        {resolvedDue ? <span className="atlas-task-execution-brief__due">{resolvedDue}</span> : null}
      </header>
      <dl className="atlas-task-execution-brief__rows">
        <div className="atlas-task-execution-brief__row">
          <dt>Place</dt>
          <dd>{resolvedPlace}</dd>
        </div>
        <div className="atlas-task-execution-brief__row">
          <dt>How</dt>
          <dd>{resolvedHow.map((line) => <p key={line}>{line}</p>)}</dd>
        </div>
        <div className="atlas-task-execution-brief__row">
          <dt>Done when</dt>
          <dd>{resolvedDone}</dd>
        </div>
      </dl>
      {resolvedDetails ? (
        <details>
          <summary><span>More instructions</span><span aria-hidden="true">⌄</span></summary>
          <p className="atlas-task-execution-brief__details">{resolvedDetails}</p>
        </details>
      ) : null}
    </section>
  );
}
