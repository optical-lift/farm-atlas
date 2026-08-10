"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import TaskExecutionBrief from "@/components/atlas/task-execution-brief";
import TaskPrimaryResultControls from "@/components/atlas/task-primary-result-controls";
import { TaskChildChecklist } from "@/components/atlas/task-child-checklist";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

type Props = { task: AtlasTaskCard; childTasks: AtlasTaskCard[]; assignee: AtlasAssigneeConfig };
type Outcome = "done" | "partial" | "blocked" | "not_relevant" | "changed_plan";

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10);
}
function returnDestination(fallback: string) {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export default function DominionAssignedTaskDetail({ task: initialTask, childTasks: initialChildren, assignee }: Props) {
  const [task, setTask] = useState(initialTask);
  const [children, setChildren] = useState(initialChildren);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);

  useEffect(() => {
    void fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((response) => response.json())
      .then((data: { ok?: boolean; label?: string }) => setWeatherLabel(data.ok && data.label ? data.label : "weather unavailable"))
      .catch(() => setWeatherLabel("weather unavailable"));
  }, []);

  async function refreshTask() {
    const response = await fetch(`/api/atlas/task-cards?taskId=${encodeURIComponent(task.task_id)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
    const data = await response.json() as { ok?: boolean; taskCards?: AtlasTaskCard[]; error?: string; details?: string };
    if (!response.ok || !data.ok || !data.taskCards?.[0]) throw new Error(data.details || data.error || "Task refresh failed.");
    setTask(data.taskCards[0]);
  }

  async function transition(outcome: Outcome, note = "") {
    try {
      setSaving(outcome); setMessage(null);
      await postAtlasTaskTransition({ taskId: task.task_id, transition: outcome, note, reason: note, laneKey: task.action_key || undefined, workKey: task.action_key || undefined, payload: { workClass: task.work_class, assigneeKey: assignee.key } });
      if (outcome === "done" || outcome === "not_relevant" || outcome === "changed_plan") { window.location.assign(returnDestination(assignee.listPath)); return; }
      await refreshTask(); setUnfinishedOpen(false); setMessage("Saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Task update failed."); }
    finally { setSaving(null); }
  }

  async function reschedule(targetDate: string | null, reason: string, scheduleIntent?: string) {
    try {
      setSaving("reschedule"); setMessage(null);
      await postAtlasTaskTransition({ taskId: task.task_id, transition: "rescheduled", ...(targetDate ? { targetDate } : {}), reason, laneKey: task.action_key || undefined, workKey: task.action_key || undefined, payload: { assigneeKey: assignee.key, ...(scheduleIntent ? { scheduleIntent } : {}) } });
      window.location.assign(returnDestination(assignee.listPath));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Task reschedule failed."); }
    finally { setSaving(null); }
  }

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href={assignee.listPath} className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">{assignee.label}</span></Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <Link href={assignee.listPath} className="atlas-note-plus" aria-label={`Back to ${assignee.label} work`}>↩</Link>
        </header>
        <div className="atlas-task-page-body">
          <article className="atlas-task-page-active atlas-task-ticket-card atlas-dominion-task-card">
            <TaskExecutionBrief task={task} />
            <TaskChildChecklist childTasks={children} onChange={async () => setChildren((current) => [...current])} />
            <footer className="atlas-task-result-footer">
              <TaskPrimaryResultControls busy={Boolean(saving)} doneBusy={saving === "done"} unfinishedOpen={unfinishedOpen} onToggleUnfinished={() => setUnfinishedOpen((open) => !open)} onDone={() => void transition("done")}>
                <section className="atlas-task-unfinished-panel atlas-task-result-unfinished">
                  <strong>What happened?</strong>
                  <div className="atlas-task-unfinished-grid">
                    <button type="button" disabled={Boolean(saving)} onClick={() => void transition("partial", window.prompt("What is left?", "")?.trim() || "Partly done")}>Partly done</button>
                    <button type="button" className="blocked" disabled={Boolean(saving)} onClick={() => void transition("blocked", window.prompt("What problem did you find?", "")?.trim() || "Problem found")}>Problem found</button>
                  </div>
                </section>
              </TaskPrimaryResultControls>
              <details className="atlas-task-more-outcomes">
                <summary><span>Move or close this card</span><b aria-hidden="true">⌄</b></summary>
                <div className="atlas-task-more-outcomes-body">
                  <span>Reschedule</span>
                  <div className="atlas-task-more-outcomes-grid">
                    <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(null, "Moved to next Elm Farm calendar day", "next_day")}>Tomorrow</button>
                    <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(addDays(todayIso(), 7), "Moved to next week")}>Next week</button>
                    <button type="button" disabled={Boolean(saving)} onClick={() => { const date = window.prompt("Pick a date (YYYY-MM-DD)", task.due_date || todayIso())?.trim(); if (date) void reschedule(date, "Rescheduled from task page"); }}>Pick a date</button>
                  </div>
                  <span>Close without doing it</span>
                  <div className="atlas-task-more-outcomes-grid quiet">
                    <button type="button" disabled={Boolean(saving)} onClick={() => void transition("changed_plan", window.prompt("What changed?", "")?.trim() || "Plan changed")}>Changed plan</button>
                    <button type="button" disabled={Boolean(saving)} onClick={() => void transition("not_relevant", window.prompt("Why is this no longer relevant?", "")?.trim() || "Not relevant")}>Not relevant</button>
                  </div>
                </div>
              </details>
            </footer>
            {message ? <p className="atlas-task-page-message">{message}</p> : null}
          </article>
        </div>
      </section>
    </main>
  );
}
