"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import TaskDominionTrail from "@/components/atlas/task-dominion-trail";
import { TaskChildChecklist } from "@/components/atlas/task-child-checklist";
import type { AtlasAssigneeConfig } from "@/lib/atlas/task-assignment";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { taskConditionRailModel } from "@/lib/atlas/task-condition-rail";
import { fetchAtlasTaskPlantContents, type AtlasTaskPlantContent } from "@/lib/atlas/task-plant-contents";
import { postAtlasTaskTransition } from "@/lib/atlas/task-transition-client";

type Outcome = "done" | "partial" | "blocked" | "not_relevant" | "changed_plan";

type Props = {
  task: AtlasTaskCard;
  childTasks: AtlasTaskCard[];
  assignee: AtlasAssigneeConfig;
};

const ALLOWED_RETURN_PATHS = new Set([
  "/",
  "/owner",
  "/marshall",
  "/children",
  "/task",
  "/manage",
  "/work/today",
  "/collections/mowing",
  "/collections/weeding",
  "/day",
  "/overview/week",
  "/overview/month",
]);

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

function isAllowedReturn(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  return ALLOWED_RETURN_PATHS.has(value.split(/[?#]/, 1)[0]);
}

function returnDestination(fallback: string) {
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo");
  return returnTo && isAllowedReturn(returnTo) ? returnTo : fallback;
}

function shortObjectLabel(objectKey: string, objectLabel: string) {
  const keyPatterns: Array<[RegExp, string]> = [
    [/^fr[_-]?(\d+)$/i, "FR"],
    [/^eb(?:_sunflower)?[_-]?(\d+)$/i, "EB"],
    [/^bb[_-]?(\d+)$/i, "BB"],
    [/^bw[_-]?(\d+)$/i, "BW"],
  ];
  for (const [pattern, prefix] of keyPatterns) {
    const match = objectKey.match(pattern);
    if (match) return `${prefix}${match[1]}`;
  }

  const labelPatterns: Array<[RegExp, string]> = [
    [/^Field Row\s+(\d+)$/i, "FR"],
    [/^Entry Billboard Bed\s+(\d+)$/i, "EB"],
    [/^Barn Bed\s+(\d+)$/i, "BB"],
    [/^Berry Walk(?: Flower)? Bed\s+(\d+)$/i, "BW"],
  ];
  for (const [pattern, prefix] of labelPatterns) {
    const match = objectLabel.match(pattern);
    if (match) return `${prefix}${match[1]}`;
  }

  return objectLabel;
}

function taskObject(task: AtlasTaskCard) {
  return task.objects.find((object) => object.object_type === "bed") ?? task.objects[0] ?? null;
}

export default function ConciseWeedTaskDetail({ task: initialTask, childTasks: initialChildren, assignee }: Props) {
  const [task, setTask] = useState(initialTask);
  const [children, setChildren] = useState(initialChildren);
  const [contents, setContents] = useState<AtlasTaskPlantContent[]>([]);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchAtlasTaskPlantContents(task.task_id)
      .then((rows) => {
        if (active) setContents(rows);
      })
      .catch(() => {
        if (active) setContents([]);
      });
    return () => {
      active = false;
    };
  }, [task.task_id]);

  useEffect(() => {
    void fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((response) => response.json())
      .then((data: { ok?: boolean; label?: string }) => setWeatherLabel(data.ok && data.label ? data.label : "weather unavailable"))
      .catch(() => setWeatherLabel("weather unavailable"));
  }, []);

  const condition = useMemo(() => taskConditionRailModel(task), [task]);
  const target = taskObject(task);
  const instruction = `Weed ${target ? shortObjectLabel(target.object_key, target.object_label) : task.title.replace(/^Weed\s+/i, "")}`;
  const plantLabels = useMemo(
    () => Array.from(new Set(contents.map((content) => content.displayLabel).filter(Boolean))),
    [contents],
  );

  async function refreshTask() {
    const response = await fetch(`/api/atlas/task-cards?taskId=${encodeURIComponent(task.task_id)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await response.json() as { ok?: boolean; taskCards?: AtlasTaskCard[]; error?: string; details?: string };
    if (!response.ok || !data.ok || !data.taskCards?.[0]) {
      throw new Error(data.details || data.error || "Task refresh failed.");
    }
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
        payload: {
          workClass: task.work_class,
          assigneeKey: assignee.key,
          ...(condition.meaningful ? {
            conditionRail: {
              label: condition.label,
              current: condition.points[condition.currentIndex],
              target: condition.points[condition.targetIndex],
              targetReached: outcome === "done",
            },
          } : {}),
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

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
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
            <TaskDominionTrail
              task={task}
              instruction={instruction}
              showZoneLabel={false}
              showSubjectLabel={false}
              plantLabels={plantLabels}
              presentation="field-sheet"
            />

            <TaskChildChecklist childTasks={children} onChange={async () => setChildren((current) => [...current])} />

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
                <summary><span>Move or close this card</span><b aria-hidden="true">⌄</b></summary>
                <div className="atlas-task-more-outcomes-body">
                  <span>Reschedule</span>
                  <div className="atlas-task-more-outcomes-grid">
                    <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(null, "Moved to next Elm Farm calendar day from assigned task page", "next_day")}>Tomorrow</button>
                    <button type="button" disabled={Boolean(saving)} onClick={() => void reschedule(addDays(todayIso(), 7), "Moved to next week from assigned task page")}>Next week</button>
                    <button type="button" disabled={Boolean(saving)} onClick={() => {
                      const date = window.prompt("Pick a date (YYYY-MM-DD)", task.due_date || todayIso())?.trim();
                      if (date) void reschedule(date, "Rescheduled from assigned task page");
                    }}>Pick a date</button>
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
