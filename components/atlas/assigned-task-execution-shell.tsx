"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import TaskExecutionBrief from "@/components/atlas/task-execution-brief";
import TaskPrimaryResultControls from "@/components/atlas/task-primary-result-controls";
import { TaskChildChecklist } from "@/components/atlas/task-child-checklist";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type { TaskMoveAssembly } from "@/lib/atlas/task-move-assembly";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

export type AssignedTaskOutcome = "done" | "partial" | "blocked" | "not_relevant" | "changed_plan";

export type AssignedTaskInstrumentContext = {
  task: AtlasTaskCard;
  assignee: AtlasAssigneeConfig;
  assembly: TaskMoveAssembly | null;
  busy: boolean;
  returnHref: string;
  refreshTask: () => Promise<void>;
};

export type AssignedTaskMethodInstrument = (context: AssignedTaskInstrumentContext) => ReactNode;
export type AssignedTaskResultInstrumentContext = AssignedTaskInstrumentContext;
export type AssignedTaskResultInstrument = (context: AssignedTaskResultInstrumentContext) => ReactNode;
export type AssignedTaskResultPayload = Record<string, unknown> | ((outcome: AssignedTaskOutcome) => Record<string, unknown>);

export type AssignedTaskExecutionShellProps = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
  methodInstrument?: AssignedTaskMethodInstrument;
  resultInstrument?: AssignedTaskResultInstrument;
  supplementalResultInstrument?: AssignedTaskResultInstrument;
  doneDisabled?: boolean;
  resultPayload?: AssignedTaskResultPayload;
};

type TaskMoveResponse = { ok?: boolean; assembly?: TaskMoveAssembly; error?: string };

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

function returnDestination(fallback: string) {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

function canonicalCompletionBlocked(assembly: TaskMoveAssembly | null, explicit: boolean) {
  return explicit
    || !assembly
    || assembly.readiness.status === "blocked"
    || assembly.spine.connection === "stops_at_move";
}

function DefaultResultInstrument({
  busy,
  doneBusy,
  doneDisabled,
  unfinishedOpen,
  onToggleUnfinished,
  onDone,
  onPartial,
  onBlocked,
}: {
  busy: boolean;
  doneBusy: boolean;
  doneDisabled: boolean;
  unfinishedOpen: boolean;
  onToggleUnfinished: () => void;
  onDone: () => void;
  onPartial: () => void;
  onBlocked: () => void;
}) {
  return (
    <TaskPrimaryResultControls
      busy={busy}
      doneBusy={doneBusy}
      doneDisabled={doneDisabled}
      unfinishedOpen={unfinishedOpen}
      onToggleUnfinished={onToggleUnfinished}
      onDone={onDone}
    >
      <section className="atlas-task-unfinished-panel atlas-task-result-unfinished">
        <strong>What happened?</strong>
        <div className="atlas-task-unfinished-grid">
          <button type="button" disabled={busy} onClick={onPartial}>Partly done</button>
          <button type="button" className="blocked" disabled={busy} onClick={onBlocked}>Problem found</button>
        </div>
      </section>
    </TaskPrimaryResultControls>
  );
}

export default function AssignedTaskExecutionShell({
  task: initialTask,
  childTasks: initialChildren,
  assignee,
  methodInstrument,
  resultInstrument,
  supplementalResultInstrument,
  doneDisabled = false,
  resultPayload,
}: AssignedTaskExecutionShellProps) {
  const [task, setTask] = useState(initialTask);
  const [children, setChildren] = useState(initialChildren);
  const [assembly, setAssembly] = useState<TaskMoveAssembly | null>(null);
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

  useEffect(() => {
    const controller = new AbortController();
    setAssembly(null);
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
        if (nextAssembly) setAssembly(nextAssembly);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // The legacy execution brief remains available if canonical resolution fails.
      });
    return () => controller.abort();
  }, [task.task_id, task.status, task.updated_at]);

  async function refreshTask() {
    const response = await fetch(`/api/atlas/task-cards?taskId=${encodeURIComponent(task.task_id)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await response.json() as {
      ok?: boolean;
      taskCards?: AtlasTaskCard[];
      error?: string;
      details?: string;
    };
    if (!response.ok || !data.ok || !data.taskCards?.[0]) {
      throw new Error(data.details || data.error || "Task refresh failed.");
    }
    setTask(data.taskCards[0]);
  }

  async function transition(outcome: AssignedTaskOutcome, note = "") {
    if (outcome === "done" && canonicalCompletionBlocked(assembly, doneDisabled)) return;
    try {
      setSaving(outcome);
      setMessage(null);
      const additionalPayload = typeof resultPayload === "function" ? resultPayload(outcome) : (resultPayload ?? {});
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: outcome,
        note,
        reason: note,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: {
          workClass: task.work_class,
          assigneeKey: assignee.key,
          ...additionalPayload,
        },
      });
      if (outcome === "done" || outcome === "not_relevant" || outcome === "changed_plan") {
        window.location.assign(returnDestination(assignee.listPath));
        return;
      }
      await refreshTask();
      setUnfinishedOpen(false);
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task update failed.");
    } finally {
      setSaving(null);
    }
  }

  async function reschedule(targetDate: string | null, reason: string, scheduleIntent?: string) {
    try {
      setSaving("reschedule");
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: "rescheduled",
        ...(targetDate ? { targetDate } : {}),
        reason,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: { assigneeKey: assignee.key, ...(scheduleIntent ? { scheduleIntent } : {}) },
      });
      window.location.assign(returnDestination(assignee.listPath));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task reschedule failed.");
    } finally {
      setSaving(null);
    }
  }

  const returnHref = assignee.listPath;
  const instrumentContext: AssignedTaskInstrumentContext = {
    task,
    assignee,
    assembly,
    busy: Boolean(saving),
    returnHref,
    refreshTask,
  };
  const timingLabel = assembly?.execution.dueLabel || task.due_date || null;
  const unresolved = assembly?.unresolved ?? [];

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell" data-atlas-assigned-task-execution-shell="true">
      <style>{`
        .atlas-assigned-task-shell__timing { display:flex; align-items:center; gap:8px; margin:0; padding:10px 28px; border-bottom:1px solid rgba(66,65,82,.09); background:#fbfbfd; color:#666878; font-size:.76rem; font-weight:800; }
        .atlas-assigned-task-shell__timing b { color:#8588ad; font-size:.66rem; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-assigned-task-shell__readiness { margin:0 28px 20px; padding:13px 14px; border:1px solid rgba(87,89,116,.14); border-radius:15px; background:#fafafd; color:#4e5062; }
        .atlas-assigned-task-shell__readiness[data-state="warning"] { background:#fffdf2; }
        .atlas-assigned-task-shell__readiness[data-state="blocked"] { border-style:dashed; background:#fff8f5; color:#704d43; }
        .atlas-assigned-task-shell__readiness-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .atlas-assigned-task-shell__readiness-head span { color:#8588ad; font-size:.66rem; font-weight:950; letter-spacing:.11em; text-transform:uppercase; }
        .atlas-assigned-task-shell__readiness-head strong { font-size:.78rem; }
        .atlas-assigned-task-shell__unresolved { display:grid; gap:5px; margin:9px 0 0; padding:0; list-style:none; font-size:.78rem; font-weight:720; line-height:1.35; }
        .atlas-assigned-task-shell__unresolved li { display:grid; grid-template-columns:auto minmax(0,1fr); gap:7px; }
        .atlas-assigned-task-shell__unresolved small { color:#8588ad; font-size:.62rem; font-weight:900; letter-spacing:.07em; text-transform:uppercase; }
        @media (max-width:560px) {
          .atlas-assigned-task-shell__timing { padding:10px 21px; }
          .atlas-assigned-task-shell__readiness { margin:0 21px 18px; }
        }
      `}</style>
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href={assignee.listPath} className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">{assignee.label}</span>
          </Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <Link href={assignee.listPath} className="atlas-note-plus" aria-label={`Back to ${assignee.label} work`}>↩</Link>
        </header>
        <div className="atlas-task-page-body">
          <article className="atlas-task-page-active atlas-task-ticket-card atlas-assigned-task-execution-card atlas-dominion-task-card">
            {timingLabel ? (
              <p className="atlas-assigned-task-shell__timing" data-atlas-task-timing="true">
                <b>Timing</b>
                <span>{timingLabel}</span>
              </p>
            ) : null}
            <TaskExecutionBrief task={task} assembly={assembly} />
            {assembly && unresolved.length ? (
              <section
                className="atlas-assigned-task-shell__readiness"
                data-atlas-task-readiness="true"
                data-state={assembly.readiness.status}
                aria-label="Task readiness"
              >
                <div className="atlas-assigned-task-shell__readiness-head">
                  <span>Before the move</span>
                  <strong>{assembly.readiness.status === "blocked" ? "Blocked" : "Check"}</strong>
                </div>
                <ul className="atlas-assigned-task-shell__unresolved">
                  {unresolved.map((item, index) => (
                    <li key={`${item.kind}-${item.label}-${index}`}>
                      <small>{item.kind.replaceAll("_", " ")}</small>
                      <span>{item.label}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {methodInstrument ? methodInstrument(instrumentContext) : null}
            <TaskChildChecklist childTasks={children} onChange={async () => setChildren((current) => [...current])} />
            <footer className="atlas-task-result-footer" data-atlas-primary-results="true">
              {resultInstrument ? resultInstrument(instrumentContext) : (
                <DefaultResultInstrument
                  busy={Boolean(saving)}
                  doneBusy={saving === "done"}
                  doneDisabled={canonicalCompletionBlocked(assembly, doneDisabled)}
                  unfinishedOpen={unfinishedOpen}
                  onToggleUnfinished={() => setUnfinishedOpen((open) => !open)}
                  onDone={() => void transition("done")}
                  onPartial={() => void transition("partial", window.prompt("What is left?", "")?.trim() || "Partly done")}
                  onBlocked={() => void transition("blocked", window.prompt("What problem did you find?", "")?.trim() || "Problem found")}
                />
              )}
              {supplementalResultInstrument ? supplementalResultInstrument(instrumentContext) : null}
              <details className="atlas-task-more-outcomes">
                <summary><span>Move or close this card</span><b aria-hidden="true">⌄</b></summary>
                <div className="atlas-task-more-outcomes-body">
                  <span>Reschedule</span>
                  <div className="atlas-task-more-outcomes-grid">
                    <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(null, "Moved to next Elm Farm calendar day", "next_day")}>Tomorrow</button>
                    <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(addDays(todayIso(), 7), "Moved to next week")}>Next week</button>
                    <button
                      type="button"
                      disabled={Boolean(saving)}
                      onClick={() => {
                        const date = window.prompt("Pick a date (YYYY-MM-DD)", task.due_date || todayIso())?.trim();
                        if (date) void reschedule(date, "Rescheduled from task page");
                      }}
                    >
                      Pick a date
                    </button>
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