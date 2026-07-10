"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { TaskChildChecklist } from "@/components/atlas/task-child-checklist";
import { atlasTaskDisplay } from "@/lib/atlas/task-display";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type LaneKey = "start" | "maintain" | "harvest" | "venue";
type Outcome = "done" | "partial" | "blocked" | "not_relevant" | "changed_plan";
type RescheduleMode = "tomorrow" | "next_time_block" | "pick_date";
type WeatherResponse = { ok: boolean; label?: string };

type DisplayTask = {
  rhythm: string;
  action: string;
  subject: string;
  location: string;
  detailHeading: string | null;
  detailLines: string[];
  lane: LaneKey;
};

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "No date";
  const date = new Date(`${dateIso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateIso : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function clean(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\b(urgent|high|normal|low)\b/gi, "")
    .replace(/truth/gi, "state")
    .replace(/\s+·\s+·\s+/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .trim();
}

function metadataValue(task: AtlasTaskCard, key: string) {
  return task.metadata?.[key];
}

function metaString(task: AtlasTaskCard, key: string) {
  const value = metadataValue(task, key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metaNumber(task: AtlasTaskCard, key: string) {
  const value = metadataValue(task, key);
  return typeof value === "number" ? value : null;
}

function metaStringList(task: AtlasTaskCard, key: string) {
  const value = metadataValue(task, key);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function titleSubject(title: string) {
  const parts = title.split("—");
  return clean(parts.length > 1 ? parts.slice(1).join("—") : title);
}

function taskSortValue(task: AtlasTaskCard) {
  const dayOrder = metaNumber(task, "day_order") ?? 999;
  return `${task.due_date ?? "9999-12-31"}-${priorityRank[task.priority] ?? 9}-${String(dayOrder).padStart(3, "0")}-${task.title}`;
}

function rhythmFromTask(task: AtlasTaskCard) {
  const explicit = metaString(task, "work_rhythm");
  if (explicit) return explicit;

  const title = task.title.toLowerCase();
  const type = task.task_type.toLowerCase();
  const text = `${type} ${title}`;

  if (text.includes("harvest") || text.includes("postharvest") || text.includes("cure")) return "Harvest + Postharvest";
  if (text.includes("venue") || text.includes("paint") || text.includes("trim") || text.includes("tidy")) return "Venue Maintenance";
  if (text.includes("seed") || text.includes("sow")) return "Seed Sowing";
  if (text.includes("weed")) return "Weeding";
  if (text.includes("plant") || text.includes("transplant")) return "Planting";
  if (text.includes("mow") || text.includes("maintenance")) return "Maintenance";
  if (text.includes("prep") || text.includes("string")) return "Bed Prep";
  return "Farm Work";
}

function actionFromTask(task: AtlasTaskCard, rhythm: string) {
  const explicit = metaString(task, "display_action");
  if (explicit) return explicit;

  const text = `${task.task_type} ${task.title}`.toLowerCase();
  if (text.includes("mow")) return "Mow";
  if (text.includes("weed")) return "Weed";
  if (text.includes("sow")) return "Sow";
  if (text.includes("seed")) return "Seed";
  if (text.includes("plant") || text.includes("transplant")) return "Plant";
  if (text.includes("paint")) return "Paint";
  if (text.includes("trim")) return "Trim";
  if (text.includes("tidy")) return "Tidy";
  if (text.includes("string")) return "String";
  if (text.includes("prep")) return "Prep";
  if (text.includes("harvest") || text.includes("gather")) return "Harvest";
  return rhythm;
}

function laneFromRhythm(rhythm: string, action: string): LaneKey {
  const text = `${rhythm} ${action}`.toLowerCase();
  if (text.includes("harvest") || text.includes("postharvest") || text.includes("gather")) return "harvest";
  if (text.includes("venue") || text.includes("paint") || text.includes("trim") || text.includes("chicken")) return "venue";
  if (text.includes("seed") || text.includes("sow") || text.includes("plant")) return "start";
  return "maintain";
}

function fallbackDetailHeading(task: AtlasTaskCard, rhythm: string) {
  const text = `${task.task_type} ${task.title} ${rhythm}`.toLowerCase();
  if (text.includes("tray")) return "Tray List";
  if (text.includes("seed") || text.includes("sow")) return "Seed / Variety";
  if (text.includes("plant")) return "Plant Material";
  if (text.includes("harvest") || text.includes("postharvest") || text.includes("garlic")) return "Harvest + Handling";
  if (text.includes("paint")) return "Paint";
  if (text.includes("trim")) return "Tool";
  if (text.includes("mow")) return "Equipment";
  return "Details";
}

function displayTask(task: AtlasTaskCard): DisplayTask {
  const rhythm = rhythmFromTask(task);
  const action = actionFromTask(task, rhythm);
  const sharedDisplay = atlasTaskDisplay(task);
  const subject = metaString(task, "display_subject") ?? titleSubject(task.title);
  const location = sharedDisplay.location;
  const metadataLines = metaStringList(task, "detail_lines");
  const noteLines = (task.note ?? "")
    .split(".")
    .map((line) => clean(line))
    .filter(Boolean);
  const resourceLines = task.resource_requirements
    .map((requirement) => clean(requirement.note || [requirement.quantity_needed, requirement.unit, requirement.resource_label].filter(Boolean).join(" ")))
    .filter(Boolean);
  const detailLines = Array.from(new Set(metadataLines.length ? metadataLines : [...resourceLines, ...noteLines]));
  const detailHeading = detailLines.length ? metaString(task, "detail_heading") ?? fallbackDetailHeading(task, rhythm) : null;

  return {
    rhythm,
    action,
    subject,
    location,
    detailHeading,
    detailLines,
    lane: laneFromRhythm(rhythm, action),
  };
}

function laneForTask(task: AtlasTaskCard): LaneKey {
  return displayTask(task).lane;
}

function workKeyForDisplay(display: DisplayTask) {
  return display.action.toLowerCase().replace(/\s+/g, "_");
}

function isChildTask(task: AtlasTaskCard) {
  return metadataValue(task, "is_child_task") === true || metadataValue(task, "is_child_task") === "true";
}

function childParentId(task: AtlasTaskCard) {
  return metaString(task, "parent_task_id");
}

function checklistLabel(task: AtlasTaskCard) {
  return metaString(task, "checklist_label") ?? displayTask(task).subject;
}

function stepOrder(task: AtlasTaskCard) {
  return metaNumber(task, "step_order") ?? 999;
}

function latestOutcome(task: AtlasTaskCard) {
  return task.task_outcomes?.[0] ?? null;
}

function isChecklistDone(task: AtlasTaskCard) {
  return task.status === "done" || latestOutcome(task)?.outcome === "done" || metaString(task, "checklist_status") === "done";
}

function isCompletedTask(task: AtlasTaskCard) {
  return task.status === "done" || latestOutcome(task)?.outcome === "done" || isChecklistDone(task);
}

function progressPercent(done: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function workWindowForTask(task: AtlasTaskCard, weatherLabel: string) {
  const display = displayTask(task);
  const text = `${task.task_type} ${task.title} ${display.rhythm} ${display.action}`.toLowerCase();
  const weather = weatherLabel.toLowerCase();

  if (weather.includes("rain") && text.includes("germin")) return "After rain";
  if (text.includes("weed") || text.includes("hoe") || text.includes("mow") || display.lane === "harvest") return "Morning";
  if (display.lane === "venue") return "Afternoon";
  return "";
}

function carryoverLabel(task: AtlasTaskCard, today: string) {
  const outcome = latestOutcome(task);
  if (task.status === "blocked" || outcome?.outcome === "blocked") return "Waiting";
  if (outcome?.outcome === "partial") return "Needs next step";
  if (task.due_date && task.due_date < today) return `Carried from ${prettyDate(task.due_date)}`;
  if (!task.due_date) return "";
  if (task.due_date === today) return "Today";
  return prettyDate(task.due_date);
}

function isCarryoverTask(task: AtlasTaskCard, today: string) {
  const outcome = latestOutcome(task);
  return task.status === "blocked" || outcome?.outcome === "blocked" || outcome?.outcome === "partial" || Boolean(task.due_date && task.due_date < today);
}

function rowMeta(task: AtlasTaskCard, today: string, weatherLabel: string) {
  const display = displayTask(task);
  return [display.location, workWindowForTask(task, weatherLabel), carryoverLabel(task, today)].filter(Boolean).join(" · ");
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function nextTimeBlockDate(task: AtlasTaskCard, allTasks: AtlasTaskCard[], today: string) {
  const display = displayTask(task);
  const sameBlock = allTasks
    .filter((candidate) => candidate.task_id !== task.task_id)
    .filter((candidate) => (candidate.status === "open" || candidate.status === "blocked") && !isChildTask(candidate))
    .filter((candidate) => Boolean(candidate.due_date && candidate.due_date > today))
    .filter((candidate) => {
      const candidateDisplay = displayTask(candidate);
      return candidateDisplay.lane === display.lane && (candidateDisplay.action === display.action || candidateDisplay.rhythm === display.rhythm);
    })
    .sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)))[0];

  return sameBlock?.due_date ?? addDaysIso(today, 7);
}

function childTasksFor(task: AtlasTaskCard, allTasks: AtlasTaskCard[]) {
  return allTasks
    .filter((candidate) => childParentId(candidate) === task.task_id && candidate.status !== "archived")
    .sort((a, b) => stepOrder(a) - stepOrder(b));
}

async function postOutcome(task: AtlasTaskCard, outcome: Outcome, note = "") {
  const display = displayTask(task);
  const response = await fetch("/api/atlas/task-outcome", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      taskId: task.task_id,
      outcome,
      note,
      reason: note,
      laneKey: display.lane,
      workKey: workKeyForDisplay(display),
    }),
  });
  const data = (await response.json()) as { ok?: boolean; error?: string; details?: string };
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Task update failed.");
}

async function postReschedule(task: AtlasTaskCard, targetDate: string, rescheduleMode: RescheduleMode, reason = "") {
  const display = displayTask(task);
  const response = await fetch("/api/atlas/task-reschedule", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      taskId: task.task_id,
      targetDate,
      rescheduleMode,
      reason,
      laneKey: display.lane,
      workKey: workKeyForDisplay(display),
    }),
  });
  const data = (await response.json()) as { ok?: boolean; error?: string; details?: string };
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Task reschedule failed.");
}

async function postNote(task: AtlasTaskCard, note: string) {
  const response = await fetch("/api/atlas/task-note", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ taskId: task.task_id, note, laneKey: laneForTask(task) }),
  });
  const data = (await response.json()) as { ok?: boolean; error?: string; details?: string };
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Task note failed.");
}

function TaskSummaryButton({ task, selected, onSelect, today, weatherLabel }: { task: AtlasTaskCard; selected: boolean; onSelect: () => void; today: string; weatherLabel: string }) {
  const display = displayTask(task);
  const windowLabel = workWindowForTask(task, weatherLabel);

  return (
    <button type="button" className={selected ? "atlas-task-page-row selected" : "atlas-task-page-row"} onClick={onSelect}>
      <div>
        <strong>{display.rhythm} — {display.subject}</strong>
        <span>{rowMeta(task, today, weatherLabel)}</span>
      </div>
      {windowLabel ? <small>{windowLabel}</small> : null}
    </button>
  );
}

function DetailCard({ heading, lines }: { heading: string | null; lines: string[] }) {
  if (!heading || lines.length === 0) return null;
  return (
    <section className="atlas-task-detail-card">
      <strong>{heading}</strong>
      {lines.map((line) => <p key={line}>{line}</p>)}
    </section>
  );
}

function ProgressLine({ label, value, percent }: { label: string; value: string; percent: number }) {
  return (
    <div className="atlas-progress-line">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="atlas-progress-bar"><i style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function ProgressReportHero({ selectedTask, tasks, nextWorkTasks, today }: { selectedTask: AtlasTaskCard | null; tasks: AtlasTaskCard[]; nextWorkTasks: AtlasTaskCard[]; today: string }) {
  const selectedDisplay = selectedTask ? displayTask(selectedTask) : null;
  const childTasks = selectedTask ? childTasksFor(selectedTask, tasks) : [];
  const taskTotal = childTasks.length || (selectedTask ? 1 : 0);
  const taskDone = childTasks.length ? childTasks.filter(isChecklistDone).length : selectedTask && isCompletedTask(selectedTask) ? 1 : 0;
  const dayTasks = tasks.filter((task) => !isChildTask(task) && task.status !== "archived" && (!task.due_date || task.due_date <= today));
  const dayDone = dayTasks.filter(isCompletedTask).length;
  const dayTotal = dayTasks.length;
  const remainingSteps = childTasks.filter((task) => !isChecklistDone(task)).map(checklistLabel).slice(0, 3);
  const nextTask = nextWorkTasks.find((task) => task.task_id !== selectedTask?.task_id) ?? null;

  return (
    <section className="atlas-task-page-hero atlas-task-progress-hero">
      <span>Today · {prettyDate(today)}</span>
      <div className="atlas-progress-hero-head">
        <h2>{selectedDisplay?.subject ?? "Day Progress"}</h2>
        {selectedDisplay ? <small>{selectedDisplay.action} · {selectedDisplay.location}</small> : null}
      </div>
      {selectedTask ? (
        <div className="atlas-progress-report">
          <ProgressLine label="Task" value={`${taskDone} / ${taskTotal} steps done`} percent={progressPercent(taskDone, taskTotal)} />
          <ProgressLine label="Day" value={`${dayDone} / ${dayTotal} tasks done`} percent={progressPercent(dayDone, dayTotal)} />
          <div className="atlas-progress-next-line">
            <span>Remaining here</span>
            <strong>{remainingSteps.length ? remainingSteps.join(" · ") : "Ready to finish this card"}</strong>
          </div>
          {nextTask ? (
            <div className="atlas-progress-next-line">
              <span>Next task</span>
              <strong>{displayTask(nextTask).subject}</strong>
            </div>
          ) : null}
        </div>
      ) : (
        <p>No active task selected.</p>
      )}
    </section>
  );
}

function ActiveTaskCard({ task, allTasks, onChange, onChildChange, onDoneComplete, today, weatherLabel }: { task: AtlasTaskCard; allTasks: AtlasTaskCard[]; onChange: () => Promise<void>; onChildChange: () => Promise<void>; onDoneComplete: () => void; today: string; weatherLabel: string }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unfinishedOpen, setUnfinishedOpen] = useState(false);
  const display = displayTask(task);
  const windowLabel = workWindowForTask(task, weatherLabel);
  const childTasks = childTasksFor(task, allTasks);

  async function submitOutcome(outcome: Outcome, note = "") {
    try {
      setSaving(outcome);
      setMessage(null);
      await postOutcome(task, outcome, note);
      if (outcome === "done") {
        setMessage("Done.");
        window.setTimeout(onDoneComplete, 150);
        return;
      }
      await onChange();
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task update failed.");
    } finally {
      setSaving(null);
    }
  }

  async function submitReschedule(targetDate: string, mode: RescheduleMode, reason = "") {
    try {
      setSaving(mode);
      setMessage(null);
      await postReschedule(task, targetDate, mode, reason);
      await onChange();
      setMessage(`Moved to ${prettyDate(targetDate)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task reschedule failed.");
    } finally {
      setSaving(null);
    }
  }

  function finishDone() {
    void submitOutcome("done");
  }

  function markPartial() {
    const note = window.prompt("What is left?", "")?.trim() || "Unfinished — partly done";
    void submitOutcome("partial", note);
  }

  function markBlocked() {
    const note = window.prompt("What blocked it?", "")?.trim() || "Blocked";
    void submitOutcome("blocked", note);
  }

  function markNotRelevant() {
    const note = window.prompt("Why is this no longer relevant?", "")?.trim() || "Not relevant now";
    void submitOutcome("not_relevant", note);
  }

  function markChangedPlan() {
    const note = window.prompt("What changed?", "")?.trim() || "Plan changed";
    void submitOutcome("changed_plan", note);
  }

  function reschedule(mode: RescheduleMode) {
    const defaultDate = mode === "tomorrow" ? addDaysIso(today, 1) : mode === "next_time_block" ? nextTimeBlockDate(task, allTasks, today) : task.due_date && task.due_date > today ? task.due_date : addDaysIso(today, 1);
    const targetDate = mode === "pick_date" ? window.prompt("Pick a date (YYYY-MM-DD)", defaultDate)?.trim() ?? "" : defaultDate;
    if (!validDate(targetDate)) {
      setMessage("Use a date like 2026-07-09.");
      return;
    }
    const reason = mode === "next_time_block" ? "Moved to the next matching time block" : mode === "tomorrow" ? "Moved to tomorrow" : "Picked a new date";
    void submitReschedule(targetDate, mode, reason);
  }

  async function addNote() {
    const note = window.prompt("Note", "")?.trim();
    if (!note) return;
    try {
      setSaving("note");
      setMessage(null);
      await postNote(task, note);
      await onChange();
      setMessage("Note saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task note failed.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <article className="atlas-task-page-active atlas-task-ticket-card">
      <div className="atlas-task-page-kicker"><span>Up Now</span><small>{display.rhythm}</small></div>
      <h1>{display.subject.toUpperCase()}</h1>
      <div className="atlas-task-page-time-row">
        <span>{display.action}</span>
        {windowLabel ? <span>{windowLabel}</span> : null}
        <span>{task.due_date ? prettyDate(task.due_date) : carryoverLabel(task, today)}</span>
      </div>
      <section className="atlas-task-place-card">
        <small>Location</small>
        <strong>{display.location}</strong>
      </section>
      <DetailCard heading={display.detailHeading} lines={display.detailLines} />
      <TaskChildChecklist childTasks={childTasks} onChange={onChildChange} />
      <div className="atlas-task-page-actions atlas-task-primary-actions">
        <button type="button" className="done" disabled={Boolean(saving)} onClick={finishDone}>{saving === "done" ? "Saving" : "Done"}</button>
        <button type="button" disabled={Boolean(saving)} onClick={() => setUnfinishedOpen((open) => !open)}>{unfinishedOpen ? "Close" : "Unfinished"}</button>
      </div>
      {unfinishedOpen ? (
        <section className="atlas-task-unfinished-panel">
          <strong>What happened?</strong>
          <div className="atlas-task-unfinished-grid">
            <button type="button" disabled={Boolean(saving)} onClick={markPartial}>{saving === "partial" ? "Saving" : "Partly done"}</button>
            <button type="button" className="blocked" disabled={Boolean(saving)} onClick={markBlocked}>{saving === "blocked" ? "Saving" : "Blocked"}</button>
          </div>
          <span>Reschedule</span>
          <div className="atlas-task-unfinished-grid reschedule">
            <button type="button" disabled={Boolean(saving)} onClick={() => reschedule("tomorrow")}>{saving === "tomorrow" ? "Saving" : "Tomorrow"}</button>
            <button type="button" disabled={Boolean(saving)} onClick={() => reschedule("next_time_block")}>{saving === "next_time_block" ? "Saving" : "Next time block"}</button>
            <button type="button" disabled={Boolean(saving)} onClick={() => reschedule("pick_date")}>{saving === "pick_date" ? "Saving" : "Pick a date"}</button>
          </div>
          <span>Close this card without doing it</span>
          <div className="atlas-task-unfinished-grid quiet">
            <button type="button" disabled={Boolean(saving)} onClick={markChangedPlan}>{saving === "changed_plan" ? "Saving" : "Changed plan"}</button>
            <button type="button" disabled={Boolean(saving)} onClick={markNotRelevant}>{saving === "not_relevant" ? "Saving" : "Not relevant"}</button>
            <button type="button" disabled={Boolean(saving)} onClick={() => void addNote()}>{saving === "note" ? "Saving" : "Note only"}</button>
          </div>
        </section>
      ) : null}
      {message ? <p className="atlas-task-page-message">{message}</p> : null}
    </article>
  );
}

export default function AtlasTaskPage() {
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedLane, setSelectedLane] = useState<LaneKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [message, setMessage] = useState<string | null>(null);
  const activeTaskAnchorRef = useRef<HTMLDivElement | null>(null);
  const today = todayIso();
  const nextWeek = addDaysIso(today, 7);

  async function loadTasks() {
    try {
      setLoading(true);
      setError(null);
      const response = await fetchAtlasTaskCards();
      setTasks((response.taskCards ?? []).filter((task) => task.status !== "archived").sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b))));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Tasks failed.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshTaskData() {
    try {
      const response = await fetchAtlasTaskCards();
      setTasks((response.taskCards ?? []).filter((task) => task.status !== "archived").sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b))));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Tasks failed.");
    }
  }

  async function loadWeather() {
    try {
      const response = await fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = (await response.json()) as WeatherResponse;
      setWeatherLabel(response.ok && data.ok && data.label ? data.label : "weather unavailable");
    } catch {
      setWeatherLabel("weather unavailable");
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get("taskId");
    const laneParam = params.get("lane");
    if (taskId) setSelectedTaskId(taskId);
    if (laneParam === "start" || laneParam === "maintain" || laneParam === "harvest" || laneParam === "venue") setSelectedLane(laneParam);
    void loadTasks();
    void loadWeather();
  }, []);

  const openTasks = useMemo(() => tasks.filter((task) => task.status === "open" || task.status === "blocked"), [tasks]);
  const visibleTasks = useMemo(() => selectedLane ? openTasks.filter((task) => laneForTask(task) === selectedLane) : openTasks, [openTasks, selectedLane]);
  const todayTasks = useMemo(() => visibleTasks.filter((task) => !task.due_date || task.due_date <= today), [visibleTasks, today]);
  const nextTasks = useMemo(() => visibleTasks.filter((task) => task.due_date && task.due_date > today && task.due_date <= nextWeek), [visibleTasks, nextWeek, today]);
  const nextWorkTasks = useMemo(() => (todayTasks.length ? todayTasks : nextTasks).filter((task) => !isChildTask(task)).slice(0, 3), [nextTasks, todayTasks]);
  const laterWorkTasks = useMemo(() => (todayTasks.length ? todayTasks : nextTasks).filter((task) => !isChildTask(task)).slice(3), [nextTasks, todayTasks]);
  const carryoverTasks = useMemo(() => visibleTasks.filter((task) => isCarryoverTask(task, today) && !isChildTask(task)).slice(0, 5), [visibleTasks, today]);
  const matchingLane = useMemo(() => selectedLane ? openTasks.filter((task) => laneForTask(task) === selectedLane && !isChildTask(task)) : [], [openTasks, selectedLane]);
  const selectedTask = useMemo(() => {
    if (selectedTaskId) return tasks.find((task) => task.task_id === selectedTaskId) ?? null;
    if (matchingLane.length) return matchingLane[0];
    return nextWorkTasks[0] ?? todayTasks.find((task) => !isChildTask(task)) ?? nextTasks.find((task) => !isChildTask(task)) ?? openTasks.find((task) => !isChildTask(task)) ?? null;
  }, [matchingLane, nextTasks, nextWorkTasks, openTasks, selectedTaskId, tasks, todayTasks]);

  function scrollToActiveTask() {
    window.setTimeout(() => activeTaskAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function selectTask(taskId: string) {
    setSelectedTaskId(taskId);
    scrollToActiveTask();
  }

  function selectLane(lane: LaneKey) {
    setSelectedLane((current) => current === lane ? null : lane);
    setSelectedTaskId(null);
    scrollToActiveTask();
  }

  async function handleTaskChanged() {
    await loadTasks();
    setSelectedTaskId(null);
    setSelectedLane(null);
    if (window.location.pathname === "/task") {
      window.history.replaceState(null, "", "/task");
    }
  }

  function returnAfterDone() {
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get("returnTo");
    if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("/task")) {
      window.location.assign(returnTo);
      return;
    }

    if (document.referrer) {
      try {
        const referrer = new URL(document.referrer);
        const referrerPath = `${referrer.pathname}${referrer.search}${referrer.hash}`;
        if (referrer.origin === window.location.origin && referrer.pathname !== "/task") {
          window.location.assign(referrerPath);
          return;
        }
      } catch {
        // Ignore malformed referrers and fall back to history/day overview.
      }
    }

    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    window.location.assign(`/day?date=${encodeURIComponent(today)}`);
  }

  async function addHeaderNote() {
    if (!selectedTask) {
      setMessage("Choose a task first.");
      return;
    }
    const note = window.prompt("Note", "")?.trim();
    if (!note) return;
    try {
      setMessage(null);
      await postNote(selectedTask, note);
      await loadTasks();
      setMessage("Note saved.");
    } catch (noteError) {
      setMessage(noteError instanceof Error ? noteError.message : "Task note failed.");
    }
  }

  function renderTaskRows(rows: AtlasTaskCard[], empty: string) {
    return rows.length === 0 ? <p className="atlas-task-page-muted">{empty}</p> : rows.map((task) => <TaskSummaryButton key={task.task_id} task={task} selected={task.task_id === selectedTask?.task_id} onSelect={() => selectTask(task.task_id)} today={today} weatherLabel={weatherLabel} />);
  }

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Elm Farm</span></Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <button type="button" className="atlas-note-plus" aria-label="Add task note" onClick={() => void addHeaderNote()}>+</button>
        </header>
        <div className="atlas-task-page-body">
          <ProgressReportHero selectedTask={selectedTask} tasks={tasks} nextWorkTasks={nextWorkTasks} today={today} />
          {loading ? <div className="atlas-task-page-empty">Loading tasks.</div> : null}
          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {message ? <div className="atlas-task-page-empty">{message}</div> : null}
          {!loading && !selectedTask ? <div className="atlas-task-page-empty">No open tasks.</div> : null}
          {selectedTask ? <div ref={activeTaskAnchorRef} className="atlas-task-page-active-anchor"><ActiveTaskCard task={selectedTask} allTasks={tasks} onChange={handleTaskChanged} onChildChange={refreshTaskData} onDoneComplete={returnAfterDone} today={today} weatherLabel={weatherLabel} /></div> : null}
          <section className="atlas-task-page-section"><div className="atlas-task-page-section-head"><span>Next</span><small>{nextWorkTasks.length}</small></div>{renderTaskRows(nextWorkTasks, "No next tasks ready.")}</section>
          <section className="atlas-task-page-section"><div className="atlas-task-page-section-head"><span>Later</span><small>{laterWorkTasks.length}</small></div>{renderTaskRows(laterWorkTasks, "No later tasks ready.")}</section>
          <section className="atlas-task-page-section"><div className="atlas-task-page-section-head"><span>Waiting</span><small>{carryoverTasks.length}</small></div>{renderTaskRows(carryoverTasks, "Nothing waiting.")}</section>
          <section className="atlas-task-page-section"><div className="atlas-task-page-section-head"><span>This Week</span><small>{nextTasks.filter((task) => !isChildTask(task)).length}</small></div>{renderTaskRows(nextTasks.filter((task) => !isChildTask(task)), "No later weekly tasks.")}</section>
        </div>
      </section>
    </main>
  );
}
