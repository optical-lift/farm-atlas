"use client";

import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { taskExecutionModel } from "@/lib/atlas/task-execution";

type Props = {
  task?: AtlasTaskCard;
  doText?: string;
  placeText?: string;
  howLines?: string[];
  doneWhen?: string;
  details?: string | null;
  dueLabel?: string | null;
};

export default function TaskExecutionBrief({
  task,
  doText,
  placeText,
  howLines,
  doneWhen,
  details,
  dueLabel,
}: Props) {
  const model = task ? taskExecutionModel(task) : null;
  const resolvedDo = doText || model?.doText || "Do this task";
  const resolvedPlace = placeText || model?.placeText || "Elm Farm";
  const resolvedHow = howLines?.length ? howLines : model?.howLines || ["Follow the task instructions."];
  const resolvedDone = doneWhen || model?.doneWhen || "The requested work is finished.";
  const resolvedDetails = details === undefined ? model?.details || null : details;
  const resolvedDue = dueLabel === undefined ? model?.dueLabel || null : dueLabel;

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
