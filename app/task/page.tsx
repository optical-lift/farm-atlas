"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type LaneKey = "start" | "maintain" | "verify" | "harvest" | "venue";
type Outcome = "done" | "partial" | "blocked";
type WeatherResponse = { ok: boolean; label?: string; rainAge?: string; daysSinceRain?: number | null; error?: string };

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const laneLabels: Record<LaneKey, string> = {
  start: "Start",
  maintain: "Maintain",
  verify: "Verify",
  harvest: "Harvest",
  venue: "Venue",
};

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
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function taskSortValue(task: AtlasTaskCard) {
  return `${task.due_date ?? "9999-12-31"}-${priorityRank[task.priority] ?? 9}-${task.title}`;
}

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/truth/gi, "state").replace(/\bAnna\b/g, "crew").replace(/\bLex\b/g, "crew");
}

function laneForTask(task: AtlasTaskCard): LaneKey {
  const text = `${task.task_type} ${task.title} ${task.unlock_text ?? ""}`.toLowerCase();
  if (text.includes("harvest") || text.includes("cut") || text.includes("bucket") || text.includes("bundle")) return "harvest";
  if (text.includes("venue") || text.includes("guest") || text.includes("entry") || text.includes("courtyard")) return "venue";
  if (text.includes("sow") || text.includes("seed") || text.includes("plant") || text.includes("transplant") || text.includes("assign")) return "start";
  if (text.includes("check") || text.includes("confirm") || text.includes("count") || text.includes("germin") || text.includes("walk") || text.includes("mark")) return "verify";
  return "maintain";
}

function objectLine(task: AtlasTaskCard) {
  const labels = task.objects.map((object) => object.object_label).filter(Boolean).slice(0, 4);
  if (labels.length === 0) return task.zone_label ?? "Elm Farm";
  return labels.join(" · ");
}

function taskMeta(task: AtlasTaskCard) {
  return [task.zone_label, task.due_date ? prettyDate(task.due_date) : null, task.priority, laneLabels[laneForTask(task)]].filter(Boolean).join(" · ");
}

function helperLines(task: AtlasTaskCard) {
  const lines = [
    task.unlock_text ? clean(task.unlock_text) : null,
    task.note ? clean(task.note).split("\n").slice(-1)[0] : null,
    task.resource_requirements.length > 0 ? `Bring/check: ${task.resource_requirements.map((item) => item.resource_label).filter(Boolean).slice(0, 3).join(" · ")}` : null,
  ].filter(Boolean) as string[];
  return Array.from(new Set(lines)).slice(0, 3);
}

function knownLines(task: AtlasTaskCard) {
  const recentLogs = task.task_logs
    .slice(0, 2)
    .map((log) => clean(log.summary_sentence || log.note || ""))
    .filter(Boolean);
  const objectSummary = task.objects.length > 0 ? [`Linked: ${objectLine(task)}`] : [];
  return [...recentLogs, ...objectSummary].slice(0, 3);
}

async function postOutcome(task: AtlasTaskCard, outcome: Outcome, note = "") {
  const response = await fetch("/api/atlas/task-outcome", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ taskId: task.task_id, outcome, note, reason: note, laneKey: laneForTask(task), workKey: laneForTask(task) }),
  });
  const data = (await response.json()) as { ok?: boolean; error?: string; details?: string };
  if (!response.ok || !data.ok) throw new Error(data.details || data.error || "Task update failed.");
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

function TaskSummaryButton({ task, selected, onSelect }: { task: AtlasTaskCard; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={selected ? "atlas-task-page-row selected" : "atlas-task-page-row"} onClick={onSelect}>
      <div>
        <strong>{clean(task.title)}</strong>
        <span>{taskMeta(task)}</span>
      </div>
      <small>{laneLabels[laneForTask(task)]}</small>
    </button>
  );
}

function ActiveTaskCard({ task, onChange }: { task: AtlasTaskCard; onChange: () => Promise<void> }) {
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const helpers = helperLines(task);
  const known = knownLines(task);

  async function save(outcome: Outcome) {
    const note = outcome === "done" ? "" : window.prompt(outcome === "partial" ? "What is still left?" : "What stopped it?", "") ?? "";
    try {
      setSaving(outcome);
      setMessage(null);
      await postOutcome(task, outcome, note);
      await onChange();
      setMessage(outcome === "done" ? "Done." : "Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Task update failed.");
    } finally {
      setSaving(null);
    }
  }

  async function addNote() {
    const note = window.prompt("Task note", "")?.trim();
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
    <article className="atlas-task-page-active">
      <div className="atlas-task-page-kicker">
        <span>Up Now</span>
        <small>{laneLabels[laneForTask(task)]}</small>
      </div>
      <h1>{clean(task.title)}</h1>
      <p>{taskMeta(task)}</p>
      <div className="atlas-task-page-context-grid">
        <section>
          <span>Focus</span>
          {helpers.length ? helpers.map((line) => <p key={line}>{line}</p>) : <p>Open the task, do the visible work, and leave a note if anything changed.</p>}
        </section>
        <section>
          <span>Already linked</span>
          {known.length ? known.map((line) => <p key={line}>{line}</p>) : <p>{objectLine(task)}</p>}
        </section>
      </div>
      <div className="atlas-task-page-actions">
        <button type="button" className="done" disabled={Boolean(saving)} onClick={() => void save("done")}>{saving === "done" ? "Saving" : "Done"}</button>
        <button type="button" disabled={Boolean(saving)} onClick={() => void save("partial")}>{saving === "partial" ? "Saving" : "Partial"}</button>
        <button type="button" className="blocked" disabled={Boolean(saving)} onClick={() => void save("blocked")}>{saving === "blocked" ? "Saving" : "Blocked"}</button>
        <button type="button" disabled={Boolean(saving)} onClick={() => void addNote()}>{saving === "note" ? "Saving" : "Note"}</button>
      </div>
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
    const lane = params.get("lane") as LaneKey | null;
    if (taskId) setSelectedTaskId(taskId);
    if (lane && laneLabels[lane]) setSelectedLane(lane);
    void loadTasks();
    void loadWeather();
  }, []);

  const openTasks = useMemo(() => tasks.filter((task) => task.status === "open" || task.status === "blocked"), [tasks]);
  const todayTasks = useMemo(() => openTasks.filter((task) => !task.due_date || task.due_date <= today), [openTasks, today]);
  const nextTasks = useMemo(() => openTasks.filter((task) => task.due_date && task.due_date > today && task.due_date <= nextWeek), [openTasks, nextWeek, today]);
  const matchingLane = useMemo(() => selectedLane ? openTasks.filter((task) => laneForTask(task) === selectedLane) : [], [openTasks, selectedLane]);
  const selectedTask = useMemo(() => {
    if (selectedTaskId) return tasks.find((task) => task.task_id === selectedTaskId) ?? null;
    if (matchingLane.length) return matchingLane[0];
    return todayTasks[0] ?? nextTasks[0] ?? openTasks[0] ?? null;
  }, [matchingLane, nextTasks, openTasks, selectedTaskId, tasks, todayTasks]);

  async function handleTaskChanged() {
    await loadTasks();
    setSelectedTaskId(null);
  }

  async function addHeaderNote() {
    if (!selectedTask) { setMessage("Choose a task first."); return; }
    const note = window.prompt("Task note", "")?.trim();
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

  return (
    <main className="atlas-phone-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand">
            <span className="atlas-phone-kicker">Atlas</span>
            <span className="atlas-phone-title">Elm Farm</span>
          </Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <button type="button" className="atlas-note-plus" aria-label="Add task note" onClick={() => void addHeaderNote()}>+</button>
        </header>

        <section className="atlas-task-page-hero">
          <span>Today · {prettyDate(today)}</span>
          <h2>Production Setup</h2>
          <p>{todayTasks.length} today · {nextTasks.length} next 7 days</p>
          <div className="atlas-task-page-lanes">
            {(Object.keys(laneLabels) as LaneKey[]).map((lane) => {
              const count = openTasks.filter((task) => laneForTask(task) === lane).length;
              return <button key={lane} type="button" className={selectedLane === lane ? "selected" : ""} onClick={() => { setSelectedLane(lane); setSelectedTaskId(null); }}>{laneLabels[lane]} <b>{count}</b></button>;
            })}
          </div>
        </section>

        {loading ? <div className="atlas-task-page-empty">Loading tasks.</div> : null}
        {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
        {message ? <div className="atlas-task-page-empty">{message}</div> : null}
        {!loading && !selectedTask ? <div className="atlas-task-page-empty">No open tasks.</div> : null}
        {selectedTask ? <ActiveTaskCard task={selectedTask} onChange={handleTaskChanged} /> : null}

        <section className="atlas-task-page-section">
          <div className="atlas-task-page-section-head"><span>Today</span><small>{todayTasks.length}</small></div>
          {todayTasks.length === 0 ? <p className="atlas-task-page-muted">No open tasks due today.</p> : todayTasks.map((task) => <TaskSummaryButton key={task.task_id} task={task} selected={task.task_id === selectedTask?.task_id} onSelect={() => setSelectedTaskId(task.task_id)} />)}
        </section>

        <section className="atlas-task-page-section">
          <div className="atlas-task-page-section-head"><span>Next 7 Days</span><small>{nextTasks.length}</small></div>
          {nextTasks.length === 0 ? <p className="atlas-task-page-muted">No scheduled tasks in the next week.</p> : nextTasks.map((task) => <TaskSummaryButton key={task.task_id} task={task} selected={task.task_id === selectedTask?.task_id} onSelect={() => setSelectedTaskId(task.task_id)} />)}
        </section>
      </section>
    </main>
  );
}
