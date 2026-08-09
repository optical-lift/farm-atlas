"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";

function prettyDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function TaskProjectMoveContext({ task }: { task: AtlasTaskCard }) {
  const context = task.move_context;
  if (!context?.projects?.length) return null;

  const unlockedAssignees = Array.from(new Set(context.unlocks.map((item) => item.assigneeName).filter(Boolean)));
  const why = context.unlocks.length
    ? `This move releases ${context.unlocks.length} ${context.unlocks.length === 1 ? "downstream move" : "downstream moves"}.`
    : context.waitingOn.length
      ? `This move advances ${context.projects[0].title} once the prerequisite work lands.`
      : `This is a concrete move toward ${context.projects[0].title}.`;

  return (
    <section className="atlas-full-task-move-context" aria-label="Project Move context">
      <style>{`
        .atlas-full-task-move-context {
          display: grid;
          gap: 12px;
          margin: 14px 0;
          padding: 14px;
          border: 1px solid rgba(85,90,134,.15);
          border-radius: 15px;
          background: linear-gradient(145deg, rgba(174,179,212,.10), rgba(255,253,247,.64));
        }
        .atlas-full-task-move-context > header { display: grid; gap: 4px; }
        .atlas-full-task-move-context > header small,
        .atlas-full-task-move-section > small {
          color: #8881b7;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: .1em;
          text-transform: uppercase;
        }
        .atlas-full-task-move-context > header strong { color: #303243; font-size: 13px; line-height: 1.35; }
        .atlas-full-task-move-chips { display: flex; flex-wrap: wrap; gap: 5px; }
        .atlas-full-task-move-chips span {
          display: inline-flex;
          padding: 4px 8px;
          border-radius: 999px;
          background: rgba(216,220,151,.21);
          color: #5f6282;
          font-size: 9px;
          font-weight: 900;
        }
        .atlas-full-task-move-section { display: grid; gap: 6px; border-top: 1px solid rgba(85,90,134,.10); padding-top: 10px; }
        .atlas-full-task-move-row,
        .atlas-full-task-project-path {
          display: grid;
          grid-template-columns: auto minmax(0,1fr);
          gap: 5px;
          align-items: baseline;
          color: #4f514c;
          font-size: 10px;
          line-height: 1.35;
        }
        .atlas-full-task-move-row b { color: #5f6282; white-space: nowrap; }
        .atlas-full-task-project-path {
          grid-template-columns: minmax(0,1fr) auto;
          padding: 7px 8px;
          border: 1px solid rgba(85,90,134,.11);
          border-radius: 10px;
          color: #303243;
          text-decoration: none;
          font-weight: 800;
        }
        .atlas-full-task-project-path em { color: #8881b7; font-size: 8px; font-style: normal; text-transform: uppercase; white-space: nowrap; }
        .atlas-full-task-move-none { color: #4f514c; font-size: 10px; font-weight: 800; }
      `}</style>

      <header>
        <small>Project move</small>
        <strong>{why}</strong>
        <div className="atlas-full-task-move-chips">
          {context.unlocks.length ? <span>{unlockedAssignees.length === 1 ? `Unlocks ${unlockedAssignees[0]} ×${context.unlocks.length}` : `Unlocks ${context.unlocks.length} moves`}</span> : null}
          <span>Advances {context.projects.length} {context.projects.length === 1 ? "project" : "projects"}</span>
        </div>
      </header>

      {context.unlocks.length ? (
        <div className="atlas-full-task-move-section">
          <small>Unlocks</small>
          {context.unlocks.map((item) => <div className="atlas-full-task-move-row" key={item.taskId}><b>{item.assigneeName} →</b><span>{item.title}</span></div>)}
        </div>
      ) : null}

      <div className="atlas-full-task-move-section">
        <small>Advances</small>
        {context.projects.map((project) => (
          <Link className="atlas-full-task-project-path" href={`/project/${encodeURIComponent(project.projectId)}`} key={project.projectId}>
            <span>{project.path.map((node) => node.title).join(" → ")}</span>
            <em>{project.portfolioType === "event" && project.targetDate ? prettyDate(project.targetDate) : project.portfolioType.replaceAll("_", " ")}</em>
          </Link>
        ))}
      </div>

      <div className="atlas-full-task-move-section">
        <small>Waiting on</small>
        {context.waitingOn.length
          ? context.waitingOn.map((item) => <div className="atlas-full-task-move-row" key={item.taskId}><b>{item.assigneeName} →</b><span>{item.title}</span></div>)
          : <span className="atlas-full-task-move-none">Nothing. This is your move.</span>}
      </div>
    </section>
  );
}

export function TaskProjectMoveContextPortal({ task }: { task: AtlasTaskCard }) {
  const [resolvedTask, setResolvedTask] = useState(task);
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    setTarget(document.querySelector(".atlas-task-page-active"));
  }, []);

  useEffect(() => {
    if (task.move_context?.projects?.length) return;
    let active = true;
    void fetchAtlasTaskCards(task.task_id)
      .then((response) => {
        if (active && response.taskCards[0]) setResolvedTask(response.taskCards[0]);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [task]);

  if (!target || !resolvedTask.move_context?.projects?.length) return null;
  return createPortal(<TaskProjectMoveContext task={resolvedTask} />, target);
}
