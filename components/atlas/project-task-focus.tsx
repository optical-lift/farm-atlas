"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import ProjectReviewTaskFocus from "@/components/atlas/portfolio/ProjectReviewTaskFocus";
import AtlasTrail from "@/components/atlas/trail/AtlasTrail";
import type { AtlasProjectTaskFocus } from "@/lib/atlas/portfolio";
import { atlasTrailCurrentNode } from "@/lib/atlas/trail";

type Outcome = "done" | "partial" | "blocked" | "not_relevant" | "changed_plan";

type Props = {
  focus: AtlasProjectTaskFocus;
  returnTo?: string | null;
};

function prettyDate(value: string | null | undefined) {
  if (!value) return "No date";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function purchaseList(note: string | null | undefined) {
  if (!note?.trim()) return [];
  const normalized = note.trim().replace(/^Buy exactly:\s*/i, "");
  return normalized
    .split(/;\s*|\n+/)
    .map((item) => item.trim().replace(/\.$/, ""))
    .filter(Boolean);
}

function OrdinaryProjectTaskFocus({ focus, returnTo }: Props) {
  const [saving, setSaving] = useState<Outcome | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const task = focus.task;
  const project = focus.project;
  const destination = returnTo || `/project/${encodeURIComponent(project.projectId)}`;
  const currentNode = useMemo(() => atlasTrailCurrentNode(project.trail), [project.trail]);
  const familyLabel = focus.step?.title || currentNode?.label || titleCase(project.workstream);
  const locationLabel = project.farmName || focus.organizationName;
  const shoppingItems = task.taskType === "purchase" ? purchaseList(task.note) : [];
  const detailLines = [task.blockerText, shoppingItems.length ? null : task.note].filter((value): value is string => Boolean(value && value.trim()));

  async function transition(outcome: Outcome, note = "") {
    try {
      setSaving(outcome);
      setMessage(null);
      const response = await fetch(`/api/atlas/project-tasks/${encodeURIComponent(task.taskId)}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transition: outcome, note }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Project task update failed.");

      if (outcome === "done" || outcome === "not_relevant" || outcome === "changed_plan") {
        window.location.assign(destination);
        return;
      }

      setMessage(outcome === "blocked" ? "Blocked state saved." : "Progress saved.");
      setUnfinishedOpen(false);
      window.setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Project task update failed.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">{focus.organizationName}</span>
          </Link>
          <span className="atlas-weather-line">Project work</span>
          <Link href={destination} className="atlas-note-plus" aria-label={`Back to ${project.title}`}>↩</Link>
        </header>

        <div className="atlas-task-page-body">
          <article className="atlas-task-page-active atlas-task-ticket-card atlas-dominion-task-card">
            <section className="atlas-task-dominion" aria-label={`${project.title} task`}>
              <header className="atlas-task-dominion-place">
                <div>
                  <small>{titleCase(project.workstream)}</small>
                  <strong>{project.title}</strong>
                </div>
                <span>{locationLabel}</span>
              </header>

              {project.trail ? (
                <AtlasTrail context={project.trail} mode="compact" />
              ) : (
                <div className="atlas-task-dominion-no-trail" aria-label="No linked Trail">
                  <span aria-hidden="true" />
                  <i aria-hidden="true" />
                  <span aria-hidden="true" />
                </div>
              )}

              <section className="atlas-task-dominion-move">
                <div className="atlas-task-dominion-kicker">
                  <span>Current move</span>
                  <small>{familyLabel}</small>
                </div>
                <h1>{task.title}</h1>
                <div className="atlas-task-dominion-time">
                  <span>{task.status === "blocked" ? "Blocked" : task.status === "done" ? "Complete" : "Project task"}</span>
                  <span>{prettyDate(task.dueDate)}</span>
                </div>
              </section>

              <footer className="atlas-task-dominion-facts">
                <span><small>Project</small>{project.title}</span>
                <span><small>Trail position</small>{familyLabel}</span>
              </footer>
            </section>

            {shoppingItems.length ? (
              <section className="atlas-task-shopping-list" aria-labelledby="atlas-shopping-list-title">
                <header>
                  <div>
                    <small>Take with you</small>
                    <strong id="atlas-shopping-list-title">Shopping list</strong>
                  </div>
                  <span>{shoppingItems.length} {shoppingItems.length === 1 ? "item" : "items"}</span>
                </header>
                <ul>
                  {shoppingItems.map((item) => <li key={item}><span aria-hidden="true" />{item}</li>)}
                </ul>
              </section>
            ) : null}

            {detailLines.length ? (
              <details className="atlas-task-procedure" open={task.status === "blocked"}>
                <summary>
                  <strong>{task.status === "blocked" ? "What is blocking it" : "Working record"}</strong>
                  <span>{detailLines.length} {detailLines.length === 1 ? "note" : "notes"}</span>
                  <b aria-hidden="true">⌄</b>
                </summary>
                <div className="atlas-task-procedure-body">
                  {detailLines.map((line) => <p key={line}>{line}</p>)}
                </div>
              </details>
            ) : null}

            {focus.permissions.canComplete && task.status !== "done" && task.status !== "skipped" ? (
              <footer className="atlas-task-result-footer">
                <div className="atlas-task-result-actions atlas-task-result-actions-simple">
                  <button type="button" className="done" disabled={Boolean(saving)} onClick={() => void transition("done")}>
                    {saving === "done" ? "Finishing" : "Done"}
                  </button>
                  <button
                    type="button"
                    className={unfinishedOpen ? "unfinished is-open" : "unfinished"}
                    aria-expanded={unfinishedOpen}
                    disabled={Boolean(saving)}
                    onClick={() => setUnfinishedOpen((open) => !open)}
                  >
                    Unfinished
                  </button>
                </div>

                {unfinishedOpen ? (
                  <section className="atlas-task-unfinished-panel atlas-task-result-unfinished">
                    <strong>What happened?</strong>
                    <div className="atlas-task-unfinished-grid">
                      <button type="button" disabled={Boolean(saving)} onClick={() => void transition("partial", window.prompt("What is left?", "")?.trim() || "Partly done")}>
                        {saving === "partial" ? "Saving" : "Partly done"}
                      </button>
                      <button type="button" className="blocked" disabled={Boolean(saving)} onClick={() => void transition("blocked", window.prompt("What blocked it?", "")?.trim() || "Blocked")}>
                        {saving === "blocked" ? "Saving" : "Blocked"}
                      </button>
                    </div>
                  </section>
                ) : null}

                <details className="atlas-task-more-outcomes">
                  <summary><span>Close this card</span><b aria-hidden="true">⌄</b></summary>
                  <div className="atlas-task-more-outcomes-body">
                    <span>Close without completing the Trail node</span>
                    <div className="atlas-task-more-outcomes-grid quiet">
                      <button type="button" disabled={Boolean(saving)} onClick={() => void transition("changed_plan", window.prompt("What changed?", "")?.trim() || "Plan changed")}>Changed plan</button>
                      <button type="button" disabled={Boolean(saving)} onClick={() => void transition("not_relevant", window.prompt("Why is this no longer relevant?", "")?.trim() || "Not relevant")}>Not relevant</button>
                    </div>
                  </div>
                </details>
              </footer>
            ) : null}

            {message ? <p className="atlas-task-page-message">{message}</p> : null}
          </article>
        </div>
      </section>
    </main>
  );
}

export default function ProjectTaskFocus(props: Props) {
  if (props.focus.task.taskType === "project_review" || props.focus.task.metadata?.task_style === "project_review") {
    return <ProjectReviewTaskFocus {...props} />;
  }
  return <OrdinaryProjectTaskFocus {...props} />;
}
