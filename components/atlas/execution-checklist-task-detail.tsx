"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import TaskDominionTrail from "@/components/atlas/task-dominion-trail";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

type ChecklistItem = {
  itemId: string;
  itemKey: string;
  sectionKey: string;
  sectionLabel: string;
  label: string;
  sortOrder: number;
  required: boolean;
  checked: boolean;
  checkedAt: string | null;
};

type ExecutionChecklist = {
  taskId: string;
  title: string;
  completionLabel: string;
  items: ChecklistItem[];
  totalCount: number;
  completeCount: number;
  ready: boolean;
};

type ChecklistResponse = {
  ok?: boolean;
  checklist?: ExecutionChecklist;
  error?: string | { message?: string };
  details?: string;
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

function requestError(data: ChecklistResponse) {
  if (data.details) return data.details;
  if (typeof data.error === "string") return data.error;
  return data.error?.message || "Atlas could not update the checklist.";
}

function requestKey(taskId: string, itemKey: string, checked: boolean) {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${taskId}:${itemKey}:${checked ? "checked" : "reopened"}:${nonce}`;
}

async function readChecklist(taskId: string) {
  const response = await fetch(`/api/atlas/task-execution-checklist?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await response.json() as ChecklistResponse;
  if (!response.ok || !data.ok || !data.checklist) throw new Error(requestError(data));
  return data.checklist;
}

async function writeChecklistItem(taskId: string, itemKey: string, checked: boolean) {
  const response = await fetch("/api/atlas/task-execution-checklist", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-atlas-intent": "task-execution-checklist-v1",
    },
    cache: "no-store",
    body: JSON.stringify({
      taskId,
      itemKey,
      checked,
      idempotencyKey: requestKey(taskId, itemKey, checked),
    }),
  });
  const data = await response.json() as ChecklistResponse;
  if (!response.ok || !data.ok || !data.checklist) throw new Error(requestError(data));
  return data.checklist;
}

export default function ExecutionChecklistTaskDetail({ task, assignee }: Props) {
  const [checklist, setChecklist] = useState<ExecutionChecklist | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [savingItem, setSavingItem] = useState<string | null>(null);
  const [savingOutcome, setSavingOutcome] = useState<string | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readChecklist(task.task_id)
      .then((value) => {
        if (!cancelled) setChecklist(value);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Checklist unavailable.");
      });
    return () => { cancelled = true; };
  }, [task.task_id]);

  useEffect(() => {
    void fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((response) => response.json())
      .then((data: { ok?: boolean; label?: string }) => setWeatherLabel(data.ok && data.label ? data.label : "weather unavailable"))
      .catch(() => setWeatherLabel("weather unavailable"));
  }, []);

  const sections = useMemo(() => {
    const ordered: Array<{ key: string; label: string; items: ChecklistItem[] }> = [];
    for (const item of checklist?.items ?? []) {
      let section = ordered.find((candidate) => candidate.key === item.sectionKey);
      if (!section) {
        section = { key: item.sectionKey, label: item.sectionLabel, items: [] };
        ordered.push(section);
      }
      section.items.push(item);
    }
    return ordered;
  }, [checklist]);

  async function toggle(item: ChecklistItem) {
    const nextChecked = !item.checked;
    try {
      setSavingItem(item.itemKey);
      setMessage(null);
      setChecklist((current) => current ? {
        ...current,
        items: current.items.map((candidate) => candidate.itemKey === item.itemKey
          ? { ...candidate, checked: nextChecked }
          : candidate),
        completeCount: current.completeCount + (nextChecked ? 1 : -1),
        ready: current.items.every((candidate) => candidate.itemKey === item.itemKey ? nextChecked || !candidate.required : candidate.checked || !candidate.required),
      } : current);
      setChecklist(await writeChecklistItem(task.task_id, item.itemKey, nextChecked));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checklist update failed.");
      try {
        setChecklist(await readChecklist(task.task_id));
      } catch {
        // Keep the visible error and the last known checklist.
      }
    } finally {
      setSavingItem(null);
    }
  }

  async function transition(outcome: "done" | "partial" | "blocked" | "changed_plan" | "not_relevant", note = "") {
    try {
      setSavingOutcome(outcome);
      setMessage(null);
      await postAtlasTaskTransition({
        taskId: task.task_id,
        transition: outcome,
        note,
        reason: note,
        laneKey: task.action_key || undefined,
        workKey: task.action_key || undefined,
        payload: {
          assigneeKey: assignee.key,
          completion_source: outcome === "done" ? "execution_checklist" : "task_card",
          checklistComplete: checklist?.ready === true,
        },
      });
      if (outcome === "done" || outcome === "changed_plan" || outcome === "not_relevant") {
        window.location.assign(assignee.listPath);
        return;
      }
      setUnfinishedOpen(false);
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task update failed.");
    } finally {
      setSavingOutcome(null);
    }
  }

  async function reschedule(targetDate: string | null, reason: string, scheduleIntent?: string) {
    try {
      setSavingOutcome("reschedule");
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
      window.location.assign(assignee.listPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task reschedule failed.");
    } finally {
      setSavingOutcome(null);
    }
  }

  const busy = Boolean(savingItem || savingOutcome);
  const completionLabel = checklist?.completionLabel || "Elm is ready for Thursday morning";

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <style>{`
        .atlas-execution-checklist { margin: 0 28px 28px; border: 1px solid rgba(68,65,89,.18); border-radius: 26px; overflow: hidden; background: rgba(255,255,255,.72); }
        .atlas-execution-checklist__head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; padding:24px 28px 18px; border-bottom:1px solid rgba(68,65,89,.13); }
        .atlas-execution-checklist__head span { display:block; color:#7772ad; font-size:.82rem; font-weight:850; letter-spacing:.15em; text-transform:uppercase; }
        .atlas-execution-checklist__head strong { display:block; margin-top:4px; color:#25253d; font-size:1.45rem; line-height:1.1; }
        .atlas-execution-checklist__progress { flex:0 0 auto; color:#686675; font-size:.88rem; font-weight:800; }
        .atlas-execution-checklist__section { padding:20px 22px 8px; }
        .atlas-execution-checklist__section + .atlas-execution-checklist__section { border-top:1px solid rgba(68,65,89,.1); }
        .atlas-execution-checklist__section h2 { margin:0 6px 12px; color:#7772ad; font-size:.78rem; font-weight:900; letter-spacing:.14em; text-transform:uppercase; }
        .atlas-execution-checklist__items { display:grid; gap:8px; }
        .atlas-execution-checklist__item { width:100%; display:grid; grid-template-columns:34px 1fr; align-items:center; gap:12px; padding:13px 14px; border:1px solid rgba(68,65,89,.15); border-radius:16px; background:#fffdf8; color:#2d2d43; text-align:left; font:inherit; font-weight:740; line-height:1.25; }
        .atlas-execution-checklist__item:disabled { opacity:.66; }
        .atlas-execution-checklist__item.is-checked { background:#eef3df; color:#55603a; border-color:rgba(97,112,59,.22); }
        .atlas-execution-checklist__mark { width:30px; height:30px; display:grid; place-items:center; border:2px solid #aaa8b2; border-radius:10px; background:#fff; font-size:1rem; font-weight:950; }
        .atlas-execution-checklist__item.is-checked .atlas-execution-checklist__mark { border-color:#829252; background:#dce8ba; }
        .atlas-execution-checklist__loading { padding:28px; color:#777; font-weight:700; }
        .atlas-execution-checklist__completion-note { margin:0 28px 22px; color:#777; font-size:.88rem; line-height:1.35; }
        .atlas-execution-checklist__done:disabled { opacity:.48 !important; cursor:not-allowed; }
        @media (max-width: 560px) {
          .atlas-execution-checklist { margin-left:16px; margin-right:16px; }
          .atlas-execution-checklist__head { padding:20px 18px 16px; }
          .atlas-execution-checklist__section { padding-left:14px; padding-right:14px; }
          .atlas-execution-checklist__completion-note { margin-left:20px; margin-right:20px; }
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
          <article className="atlas-task-page-active atlas-task-ticket-card atlas-dominion-task-card">
            <TaskDominionTrail task={task} instruction="Prepare Elm for Thursday Morning" />

            <section className="atlas-execution-checklist" aria-label="Wednesday closing round">
              <header className="atlas-execution-checklist__head">
                <div>
                  <span>Thursday morning prep</span>
                  <strong>{checklist?.title || "Wednesday closing round"}</strong>
                </div>
                <div className="atlas-execution-checklist__progress">
                  {checklist ? `${checklist.completeCount} / ${checklist.totalCount}` : "Loading"}
                </div>
              </header>

              {!checklist ? <p className="atlas-execution-checklist__loading">Loading the full round…</p> : sections.map((section) => (
                <section className="atlas-execution-checklist__section" key={section.key}>
                  <h2>{section.label}</h2>
                  <div className="atlas-execution-checklist__items">
                    {section.items.map((item) => (
                      <button
                        type="button"
                        className={`atlas-execution-checklist__item${item.checked ? " is-checked" : ""}`}
                        key={item.itemKey}
                        aria-pressed={item.checked}
                        disabled={busy}
                        onClick={() => void toggle(item)}
                      >
                        <span className="atlas-execution-checklist__mark" aria-hidden="true">{item.checked ? "✓" : ""}</span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </section>

            {checklist && !checklist.ready ? (
              <p className="atlas-execution-checklist__completion-note">Complete every required line before confirming that Elm is ready.</p>
            ) : null}

            <footer className="atlas-task-result-footer">
              <div className="atlas-task-result-actions atlas-task-result-actions-simple">
                <button
                  type="button"
                  className="done atlas-execution-checklist__done"
                  disabled={busy || checklist?.ready !== true}
                  onClick={() => void transition("done")}
                >
                  {savingOutcome === "done" ? "Finishing" : completionLabel}
                </button>
                <button
                  type="button"
                  className={unfinishedOpen ? "unfinished is-open" : "unfinished"}
                  aria-expanded={unfinishedOpen}
                  disabled={busy}
                  onClick={() => setUnfinishedOpen((open) => !open)}
                >
                  Unfinished
                </button>
              </div>

              {unfinishedOpen ? (
                <section className="atlas-task-unfinished-panel atlas-task-result-unfinished">
                  <strong>What happened?</strong>
                  <div className="atlas-task-unfinished-grid">
                    <button type="button" disabled={busy} onClick={() => void transition("partial", window.prompt("What is left?", "")?.trim() || "Partly done")}>Partly done</button>
                    <button type="button" className="blocked" disabled={busy} onClick={() => void transition("blocked", window.prompt("What problem did you find?", "")?.trim() || "Problem found")}>Problem found</button>
                  </div>
                </section>
              ) : null}

              <details className="atlas-task-more-outcomes">
                <summary><span>Move or close this card</span><b aria-hidden="true">⌄</b></summary>
                <div className="atlas-task-more-outcomes-body">
                  <span>Reschedule</span>
                  <div className="atlas-task-more-outcomes-grid">
                    <button type="button" disabled={busy} onClick={() => void reschedule(null, "Moved to next Elm Farm calendar day from assigned task page", "next_day")}>Tomorrow</button>
                    <button type="button" disabled={busy} onClick={() => void reschedule(addDays(todayIso(), 7), "Moved to next week from assigned task page")}>Next week</button>
                    <button type="button" disabled={busy} onClick={() => {
                      const date = window.prompt("Pick a date (YYYY-MM-DD)", task.due_date || todayIso())?.trim();
                      if (date) void reschedule(date, "Rescheduled from assigned task page");
                    }}>Pick a date</button>
                  </div>
                  <span>Close without doing it</span>
                  <div className="atlas-task-more-outcomes-grid quiet">
                    <button type="button" disabled={busy} onClick={() => void transition("changed_plan", window.prompt("What changed?", "")?.trim() || "Plan changed")}>Changed plan</button>
                    <button type="button" disabled={busy} onClick={() => void transition("not_relevant", window.prompt("Why is this no longer relevant?", "")?.trim() || "Not relevant")}>Not relevant</button>
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
