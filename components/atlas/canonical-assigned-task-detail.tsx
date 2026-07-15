"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TaskChildChecklist } from "@/components/atlas/task-child-checklist";
import { atlasTaskDisplay } from "@/lib/atlas/task-display";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";

type Outcome = "done" | "partial" | "blocked" | "not_relevant" | "changed_plan";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

const ALLOWED_RETURN_PATHS = new Set(["/", "/owner", "/marshall", "/children", "/task"]);

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function prettyDate(value: string | null | undefined) {
  if (!value) return "No date";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function metaString(task: AtlasTaskCard, key: string) {
  const value = task.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function detailLines(task: AtlasTaskCard) {
  const value = task.metadata?.detail_lines;
  if (Array.isArray(value)) return value.filter((line): line is string => typeof line === "string" && line.trim().length > 0);
  return task.note ? [task.note] : [];
}

function returnDestination(fallback: string) {
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo");
  return returnTo && ALLOWED_RETURN_PATHS.has(returnTo) ? returnTo : fallback;
}

export default function CanonicalAssignedTaskDetail({ task: initialTask, childTasks: initialChildren, assignee }: Props) {
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

  const display = useMemo(() => atlasTaskDisplay(task), [task]);
  const lines = detailLines(task);
  const detailHeading = metaString(task, "detail_heading") || "Details";

  async function refreshTask() {
    const response = await fetch(`/api/atlas/task-cards?taskId=${encodeURIComponent(task.task_id)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await response.json() as { ok?: boolean; taskCards?: AtlasTaskCard[]; error?: string; details?: string };
    if (!response.ok || !data.ok || !data.taskCards?.[0]) throw new Error(data.details || data.error || "Task refresh failed.");
    setTask(data.taskCards[0]);
  }

  async function transition(outcome: Outcome, note = "") {
    try {
      setSaving(outcome);
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: outcome,
        note,
        reason: note,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: { workClass: task.work_class, assigneeKey: assignee.key },
      });
      if (outcome === "done" || outcome === "not_relevant" || outcome === "changed_plan") {
        window.location.assign(returnDestination(assignee.listPath));
        return;
      }
      await refreshTask();
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task update failed.");
    } finally {
      setSaving(null);
    }
  }

  async function reschedule(targetDate: string, reason: string) {
    try {
      setSaving("reschedule");
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: "rescheduled",
        targetDate,
        reason,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: { assigneeKey: assignee.key },
      });
      window.location.assign(returnDestination(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task reschedule failed.");
    } finally {
      setSaving(null);
    }
  }

  async function moveToNextDay() {
    try {
      setSaving("reschedule");
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: "rescheduled",
        reason: "Moved to next Elm Farm calendar day from assigned task page",
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: { assigneeKey: assignee.key, scheduleIntent: "next_day" },
      });
      window.location.assign(returnDestination(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task reschedule failed.");
    } finally {
      setSaving(null);
    }
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
          <article className="atlas-task-page-active atlas-task-ticket-card">
            <section className="atlas-task-place-card" aria-label={`Assigned to ${assignee.label}`}>
              <small>Assigned to</small>
              <strong>{assignee.label.toUpperCase()}</strong>
            </section>
            <div className="atlas-task-page-kicker"><span>Up Now</span><small>{task.task_type.replaceAll("_", " ")}</small></div>
            <h1>{display.title.toUpperCase()}</h1>
            <div className="atlas-task-page-time-row"><span>{metaString(task, "display_action") || task.action_key || "Work"}</span><span>{prettyDate(task.due_date)}</span></div>
            <section className="atlas-task-place-card"><small>Location</small><strong>{display.location || "Elm Farm"}</strong></section>

            {lines.length ? <section className="atlas-task-detail-card"><strong>{detailHeading}</strong>{lines.map((line) => <p key={line}>{line}</p>)}</section> : null}
            <TaskChildChecklist childTasks={children} onChange={async () => setChildren((current) => [...current])} />

            <div className="atlas-task-page-actions atlas-task-primary-actions">
              <button type="button" className="done" disabled={Boolean(saving)} onClick={() => void transition("done")}>{saving === "done" ? "Finishing" : "Done"}</button>
              {assignee.secondaryAction === "tomorrow" ? (
                <button type="button" disabled={Boolean(saving)} onClick={() => void moveToNextDay()}>{saving === "reschedule" ? "Moving" : "Tomorrow"}</button>
              ) : (
                <button type="button" disabled={Boolean(saving)} onClick={() => setUnfinishedOpen((open) => !open)}>{unfinishedOpen ? "Close" : "Unfinished"}</button>
              )}
            </div>

            {assignee.secondaryAction === "unfinished" && unfinishedOpen ? <section className="atlas-task-unfinished-panel">
              <strong>What happened?</strong>
              <div className="atlas-task-unfinished-grid">
                <button type="button" disabled={Boolean(saving)} onClick={() => void transition("partial", window.prompt("What is left?", "")?.trim() || "Partly done")}>Partly done</button>
                <button type="button" className="blocked" disabled={Boolean(saving)} onClick={() => void transition("blocked", window.prompt("What blocked it?", "")?.trim() || "Blocked")}>Blocked</button>
              </div>
              <span>Reschedule</span>
              <div className="atlas-task-unfinished-grid reschedule">
                <button type="button" disabled={Boolean(saving)} onClick={() => void moveToNextDay()}>Tomorrow</button>
                <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(addDays(todayIso(), 7), "Moved to next week from assigned task page")}>Next week</button>
                <button type="button" disabled={Boolean(saving)} onClick={() => { const date = window.prompt("Pick a date (YYYY-MM-DD)", task.due_date || todayIso())?.trim(); if (date) void reschedule(date, "Rescheduled from assigned task page"); }}>Pick a date</button>
              </div>
              <span>Close without doing it</span>
              <div className="atlas-task-unfinished-grid quiet">
                <button type="button" disabled={Boolean(saving)} onClick={() => void transition("changed_plan", window.prompt("What changed?", "")?.trim() || "Plan changed")}>Changed plan</button>
                <button type="button" disabled={Boolean(saving)} onClick={() => void transition("not_relevant", window.prompt("Why is this no longer relevant?", "")?.trim() || "Not relevant")}>Not relevant</button>
              </div>
            </section> : null}

            {message ? <p className="atlas-task-page-message">{message}</p> : null}
          </article>
        </div>
      </section>
    </main>
  );
}
