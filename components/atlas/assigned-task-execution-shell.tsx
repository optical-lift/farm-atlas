"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import StatefulChildChecklist, { statefulChildTask } from "@/components/atlas/stateful-child-checklist";
import TaskExecutionBrief from "@/components/atlas/task-execution-brief";
import TaskPrimaryResultControls from "@/components/atlas/task-primary-result-controls";
import { TaskChildChecklist } from "@/components/atlas/task-child-checklist";
import { atlasFarmDateIso, atlasShiftFarmDate } from "@/lib/atlas/farm-day";
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
  doneDisabled?: boolean;
  resultPayload?: AssignedTaskResultPayload;
};

type TaskMoveResponse = { ok?: boolean; assembly?: TaskMoveAssembly; error?: string };
type TaskCardsResponse = {
  ok?: boolean;
  taskCards?: AtlasTaskCard[];
  error?: string;
  details?: string;
};

function returnDestination(fallback: string) {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

function completeTaskExit(taskId: string, fallback: string) {
  const returnTo = returnDestination(fallback);
  const event = new CustomEvent("atlas:task-completed", {
    cancelable: true,
    detail: { taskId, returnTo },
  });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) window.location.assign(returnTo);
}

function childIsDone(task: AtlasTaskCard) {
  return task.status === "done" || task.metadata?.checklist_status === "done";
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
  doneDisabled = false,
  resultPayload,
}: AssignedTaskExecutionShellProps) {
  const [task, setTask] = useState(initialTask);
  const [children, setChildren] = useState(initialChildren);
  const [assembly, setAssembly] = useState<TaskMoveAssembly | null>(null);
  const [assemblyLoading, setAssemblyLoading] = useState(true);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [showCorrectionNote, setShowCorrectionNote] = useState(false);

  useEffect(() => {
    if (window.location.hash !== "#result") return;
    const params = new URLSearchParams(window.location.search);
    setShowCorrectionNote(params.get("correction") === "1");
    const timer = window.setTimeout(() => {
      document.getElementById("result")?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    void fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((response) => response.json())
      .then((data: { ok?: boolean; label?: string }) => setWeatherLabel(data.ok && data.label ? data.label : "weather unavailable"))
      .catch(() => setWeatherLabel("weather unavailable"));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setAssembly(null);
    setAssemblyLoading(true);
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
      })
      .finally(() => {
        if (!controller.signal.aborted) setAssemblyLoading(false);
      });
    return () => controller.abort();
  }, [task.task_id, task.status, task.updated_at]);

  async function refreshTask() {
    const response = await fetch(`/api/atlas/task-cards?taskId=${encodeURIComponent(task.task_id)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await response.json() as TaskCardsResponse;
    if (!response.ok || !data.ok || !data.taskCards?.[0]) {
      throw new Error(data.details || data.error || "Task refresh failed.");
    }
    setTask(data.taskCards[0]);
  }

  async function refreshTaskAndChildren() {
    const response = await fetch("/api/atlas/task-cards", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await response.json() as TaskCardsResponse;
    if (!response.ok || !data.ok || !data.taskCards) {
      throw new Error(data.details || data.error || "Task checklist refresh failed.");
    }

    const parent = data.taskCards.find((candidate) => candidate.task_id === task.task_id);
    if (parent) setTask(parent);
    setChildren(data.taskCards
      .filter((candidate) => candidate.parent_task_id === task.task_id && candidate.status !== "archived")
      .sort((left, right) => left.created_at.localeCompare(right.created_at)));
  }

  async function transition(outcome: AssignedTaskOutcome, note = "") {
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
      if (outcome === "done") {
        completeTaskExit(task.task_id, assignee.listPath);
        return;
      }
      if (outcome === "not_relevant" || outcome === "changed_plan") {
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
  const blockers = (assembly?.unresolved ?? []).filter((item) => item.status === "blocked");
  const statefulChildren = children.filter(statefulChildTask);
  const ordinaryChildren = children.filter((child) => !statefulChildTask(child));
  const openStatefulChildren = statefulChildren.some((child) => !childIsDone(child));
  const canonicalDoneDisabled =
    doneDisabled ||
    task.status === "blocked" ||
    blockers.length > 0 ||
    openStatefulChildren ||
    !assembly ||
    assembly.readiness.status === "blocked" ||
    assembly.spine.connection === "stops_at_move";

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell" data-atlas-assigned-task-execution-shell="true">
      <style>{`
        .atlas-human-task-blocker { margin:0 28px 18px; padding:10px 12px; border-left:3px solid #865f4f; border-radius:0 11px 11px 0; background:#fff8f5; color:#65483e; }
        .atlas-human-task-blocker strong { display:block; font-size:.78rem; }
        .atlas-human-task-blocker ul { display:grid; gap:3px; margin:5px 0 0; padding-left:17px; font-size:.76rem; line-height:1.35; }

        .atlas-assigned-task-execution-card .atlas-plant-check {
          --atlas-task-trail-x:36px;
          position:relative !important;
          margin:0 !important;
          padding:17px 28px 8px 88px !important;
          border:0 !important;
          border-top:1px solid rgba(66,65,82,.11) !important;
          border-radius:0 !important;
          box-shadow:none !important;
          background:#fff !important;
        }
        .atlas-assigned-task-execution-card .atlas-plant-check::before {
          content:"";
          position:absolute;
          left:var(--atlas-task-trail-x);
          top:-1px;
          bottom:-1px;
          width:1px;
          background:rgba(86,89,112,.28);
        }
        .atlas-assigned-task-execution-card .atlas-plant-check > h3 {
          margin:0 0 12px !important;
          padding:0 !important;
          color:#777ca0 !important;
          font-size:.66rem !important;
          font-weight:950 !important;
          letter-spacing:.11em !important;
          text-transform:uppercase !important;
        }
        .atlas-assigned-task-execution-card .atlas-plant-check__list {
          display:grid !important;
          gap:0 !important;
          margin:0 !important;
          padding:0 !important;
          border:0 !important;
          background:transparent !important;
        }
        .atlas-assigned-task-execution-card .atlas-plant-check__item {
          position:relative !important;
          min-height:58px;
          margin:0 !important;
          padding:0 0 14px !important;
          border:0 !important;
          border-radius:0 !important;
          box-shadow:none !important;
          background:transparent !important;
        }
        .atlas-assigned-task-execution-card .atlas-plant-check__item::before {
          content:"";
          position:absolute;
          left:-52px;
          top:10px;
          width:42px;
          height:1px;
          background:rgba(86,89,112,.42);
        }
        .atlas-assigned-task-execution-card .atlas-plant-check__content,
        .atlas-assigned-task-execution-card .atlas-plant-check__actions {
          border:0 !important;
          background:transparent !important;
          box-shadow:none !important;
        }

        .atlas-task-result-footer {
          --atlas-task-trail-x:36px;
          position:relative;
        }
        .atlas-task-result-footer::before {
          content:"";
          position:absolute;
          left:var(--atlas-task-trail-x);
          top:-1px;
          height:43px;
          width:1px;
          background:rgba(86,89,112,.28);
        }
        .atlas-task-finish-node {
          position:absolute;
          z-index:2;
          left:calc(var(--atlas-task-trail-x) - 9px);
          top:34px;
          width:19px;
          height:19px;
          border:2px solid #6d7088;
          border-radius:50%;
          background:#fbf8f2;
          box-shadow:0 0 0 4px #fbf8f2;
          pointer-events:none;
        }
        .atlas-task-finish-node::after {
          content:"";
          position:absolute;
          left:15px;
          top:7px;
          width:25px;
          height:1px;
          background:rgba(86,89,112,.42);
        }

        @media (max-width:560px) {
          .atlas-human-task-blocker { margin:0 21px 16px; }
          .atlas-assigned-task-execution-card .atlas-plant-check { --atlas-task-trail-x:29px; padding:17px 21px 6px 81px !important; }
          .atlas-task-result-footer { --atlas-task-trail-x:29px; }
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
          <article className="atlas-task-page-active atlas-task-ticket-card atlas-assigned-task-execution-card">
            <TaskExecutionBrief task={task} assembly={assembly} assemblyLoading={assemblyLoading} />
            {blockers.length ? (
              <>
                <section className="atlas-human-task-blocker" data-atlas-task-blocker="true" aria-label="Blocked markers on this task">
                  <strong>Blocked — resolve this before this task can be completed.</strong>
                  <ul>{blockers.map((item, index) => <li key={`${item.kind}-${item.label}-${index}`}>{item.label}</li>)}</ul>
                </section>
              </>
            ) : null}
            {methodInstrument ? methodInstrument(instrumentContext) : null}
            <StatefulChildChecklist childTasks={statefulChildren} onChange={refreshTaskAndChildren} />
            <TaskChildChecklist childTasks={ordinaryChildren} onChange={refreshTaskAndChildren} />
            {showCorrectionNote ? (
              <p className="atlas-task-correction-note">This completion has linked farm evidence. Review the recorded result before correcting it.</p>
            ) : null}
            <footer id="result" className="atlas-task-result-footer" data-atlas-primary-results="true">
              <span className="atlas-task-finish-node" aria-hidden="true" />
              {resultInstrument ? resultInstrument(instrumentContext) : (
                <DefaultResultInstrument
                  busy={Boolean(saving)}
                  doneBusy={saving === "done"}
                  doneDisabled={canonicalDoneDisabled}
                  unfinishedOpen={unfinishedOpen}
                  onToggleUnfinished={() => setUnfinishedOpen((open) => !open)}
                  onDone={() => void transition("done")}
                  onPartial={() => void transition("partial", window.prompt("What is left?", "")?.trim() || "Partly done")}
                  onBlocked={() => void transition("blocked", window.prompt("What problem did you find?", "")?.trim() || "Problem found")}
                />
              )}
              <details className="atlas-task-more-outcomes">
                <summary><span>Move or close this card</span><b aria-hidden="true">⌄</b></summary>
                <div className="atlas-task-more-outcomes-body">
                  <span>Reschedule</span>
                  <div className="atlas-task-more-outcomes-grid">
                    <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(null, "Moved to next Elm Farm calendar day", "next_day")}>Tomorrow</button>
                    <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(atlasShiftFarmDate(atlasFarmDateIso(), 7), "Moved to next week")}>Next week</button>
                    <button
                      type="button"
                      disabled={Boolean(saving)}
                      onClick={() => {
                        const date = window.prompt("Pick a date (YYYY-MM-DD)", task.due_date || atlasFarmDateIso())?.trim();
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