"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TaskChildChecklist } from "@/components/atlas/task-child-checklist";
import { atlasTaskDisplay } from "@/lib/atlas/task-display";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

type Outcome = "done" | "partial" | "blocked" | "not_relevant" | "changed_plan";

type Props = {
  taskId: string;
  assigneeLabel?: string | null;
};

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

function metaBool(task: AtlasTaskCard, key: string) {
  const value = task.metadata?.[key];
  return value === true || value === "true" || value === "yes" || value === 1;
}

function canonicalAssignee(task: AtlasTaskCard, explicit?: string | null) {
  if (explicit?.trim()) return explicit.trim();

  const assigned = metaString(task, "assigned_to").toLowerCase();
  const zone = metaString(task, "collection_zone").toLowerCase();

  if (metaBool(task, "owner_task") || assigned === "owner" || zone === "owner") return "Owner";
  if (metaBool(task, "marshall_task") || assigned === "marshall" || zone === "marshall") return "Marshall";
  if (
    metaBool(task, "children_task") ||
    assigned === "children" ||
    assigned === "kids" ||
    zone === "children" ||
    zone === "kids"
  ) return "Kids";
  if (assigned) return assigned.replace(/^./, (letter) => letter.toUpperCase());
  return "Farm Team";
}

function assigneeReturnPath(label: string) {
  const normalized = label.toLowerCase();
  if (normalized === "owner") return "/owner";
  if (normalized === "marshall") return "/marshall";
  if (normalized === "kids" || normalized === "children") return "/children";
  return "/";
}

function metaLines(task: AtlasTaskCard) {
  const value = task.metadata?.detail_lines;
  if (Array.isArray(value)) return value.filter((line): line is string => typeof line === "string" && line.trim().length > 0);
  return task.note ? [task.note] : [];
}

function childParentId(task: AtlasTaskCard) {
  return task.parent_task_id || metaString(task, "parent_task_id");
}

function returnDestination(fallback = "/") {
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo");
  return returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : fallback;
}

export default function AssignedTaskFocusPage({ taskId, assigneeLabel }: Props) {
  const [task, setTask] = useState<AtlasTaskCard | null>(null);
  const [children, setChildren] = useState<AtlasTaskCard[]>([]);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [selected, all] = await Promise.all([
        fetchAtlasTaskCards({ taskId }),
        fetchAtlasTaskCards({ scope: "all" }),
      ]);
      const selectedTask = selected.taskCards?.[0] ?? null;
      setTask(selectedTask);
      setChildren((all.taskCards ?? []).filter((row) => childParentId(row) === taskId && row.status !== "archived"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task failed to load.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((response) => response.json())
      .then((data: { ok?: boolean; label?: string }) => setWeatherLabel(data.ok && data.label ? data.label : "weather unavailable"))
      .catch(() => setWeatherLabel("weather unavailable"));
  }, [taskId]);

  const display = useMemo(() => task ? atlasTaskDisplay(task) : null, [task]);
  const assignedTo = useMemo(() => task ? canonicalAssignee(task, assigneeLabel) : assigneeLabel || "Farm Team", [task, assigneeLabel]);
  const fallbackReturn = assigneeReturnPath(assignedTo);
  const directTomorrow = assignedTo === "Owner" || assignedTo === "Marshall";
  const detailLines = task ? metaLines(task) : [];
  const detailHeading = task ? metaString(task, "detail_heading") || "Details" : "Details";

  async function transition(outcome: Outcome, note = "") {
    if (!task) return;
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
        payload: { workClass: task.work_class },
      });
      if (outcome === "done" || outcome === "not_relevant" || outcome === "changed_plan") {
        window.location.assign(returnDestination(fallbackReturn));
        return;
      }
      await load();
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task update failed.");
    } finally {
      setSaving(null);
    }
  }

  async function reschedule(targetDate: string, reason = "Rescheduled from assigned work page") {
    if (!task) return;
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
      });
      window.location.assign(returnDestination(fallbackReturn));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task reschedule failed.");
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell"><section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone"><div className="atlas-task-page-empty">Loading task…</div></section></main>;
  }

  if (!task || !display) {
    return <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell"><section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone"><div className="atlas-task-page-empty">This task is no longer available.</div></section></main>;
  }

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href={returnDestination(fallbackReturn)} className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">{assignedTo}</span></Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <Link href={returnDestination(fallbackReturn)} className="atlas-note-plus" aria-label={`Back to ${assignedTo} work`}>↩</Link>
        </header>

        <div className="atlas-task-page-body">
          <article className="atlas-task-page-active atlas-task-ticket-card">
            <section className="atlas-task-place-card" aria-label={`Assigned to ${assignedTo}`}>
              <small>Assigned to</small>
              <strong>{assignedTo.toUpperCase()}</strong>
            </section>
            <div className="atlas-task-page-kicker"><span>Up Now</span><small>{task.task_type.replaceAll("_", " ")}</small></div>
            <h1>{display.title.toUpperCase()}</h1>
            <div className="atlas-task-page-time-row"><span>{metaString(task, "display_action") || task.action_key || "Work"}</span><span>{prettyDate(task.due_date)}</span></div>
            <section className="atlas-task-place-card"><small>Location</small><strong>{display.location || "Elm Farm"}</strong></section>

            {detailLines.length ? <section className="atlas-task-detail-card"><strong>{detailHeading}</strong>{detailLines.map((line) => <p key={line}>{line}</p>)}</section> : null}
            <TaskChildChecklist childTasks={children} onChange={load} />

            <div className="atlas-task-page-actions atlas-task-primary-actions">
              <button type="button" className="done" disabled={Boolean(saving)} onClick={() => void transition("done")}>{saving === "done" ? "Finishing" : "Done"}</button>
              {directTomorrow ? (
                <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(addDays(todayIso(), 1), "Moved to tomorrow from assigned task page")}>{saving === "reschedule" ? "Moving" : "Tomorrow"}</button>
              ) : (
                <button type="button" disabled={Boolean(saving)} onClick={() => setUnfinishedOpen((open) => !open)}>{unfinishedOpen ? "Close" : "Unfinished"}</button>
              )}
            </div>

            {!directTomorrow && unfinishedOpen ? <section className="atlas-task-unfinished-panel">
              <strong>What happened?</strong>
              <div className="atlas-task-unfinished-grid">
                <button type="button" disabled={Boolean(saving)} onClick={() => void transition("partial", window.prompt("What is left?", "")?.trim() || "Partly done")}>Partly done</button>
                <button type="button" className="blocked" disabled={Boolean(saving)} onClick={() => void transition("blocked", window.prompt("What blocked it?", "")?.trim() || "Blocked")}>Blocked</button>
              </div>
              <span>Reschedule</span>
              <div className="atlas-task-unfinished-grid reschedule">
                <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(addDays(todayIso(), 1), "Moved to tomorrow from assigned task page")}>Tomorrow</button>
                <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(addDays(todayIso(), 7), "Moved to next week from assigned task page")}>Next week</button>
                <button type="button" disabled={Boolean(saving)} onClick={() => { const date = window.prompt("Pick a date (YYYY-MM-DD)", task.due_date || todayIso())?.trim(); if (date) void reschedule(date); }}>Pick a date</button>
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
