"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { atlasMetadataValue, atlasTaskDisplay } from "@/lib/atlas/task-display";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type WeatherResponse = { ok: boolean; label?: string };

type DayGroup = {
  dateIso: string;
  label: string;
  tasks: AtlasTaskCard[];
};

const startIso = "2026-07-19";
const endIso = "2026-07-25";

function prettyDate(dateIso: string | null | undefined, weekday = false) {
  if (!dateIso) return "No date";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", weekday ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
}

function addDaysIsoFrom(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function metaNumber(task: AtlasTaskCard, key: string) {
  const value = atlasMetadataValue(task, key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 999;
}

function isChildTask(task: AtlasTaskCard) {
  return atlasMetadataValue(task, "is_child_task") === true || atlasMetadataValue(task, "is_child_task") === "true";
}

function isOpenTask(task: AtlasTaskCard) {
  return task.status === "open" || task.status === "blocked";
}

function isDoneTask(task: AtlasTaskCard) {
  return task.status === "done" || task.task_outcomes?.[0]?.outcome === "done" || atlasMetadataValue(task, "checklist_status") === "done";
}

function taskSortValue(task: AtlasTaskCard) {
  return `${task.due_date ?? "9999-12-31"}-${String(metaNumber(task, "day_order")).padStart(5, "0")}-${atlasTaskDisplay(task).title}`;
}

function taskHref(task: AtlasTaskCard) {
  return `/task-focus/${encodeURIComponent(task.task_id)}?returnTo=${encodeURIComponent("/marshall")}`;
}

function dayRange() {
  return Array.from({ length: 7 }, (_, index) => addDaysIsoFrom(startIso, index));
}

function MarshallTaskCard({ task }: { task: AtlasTaskCard }) {
  const display = atlasTaskDisplay(task);
  return (
    <Link className="atlas-overview-task-card atlas-marshall-task-card" href={taskHref(task)}>
      <div>
        <strong>{display.title}</strong>
        <span>{display.location}</span>
      </div>
      <em>{prettyDate(task.due_date)}</em>
      <p>{display.detail}</p>
    </Link>
  );
}

function MarshallDaySection({ group }: { group: DayGroup }) {
  return (
    <section className="atlas-overview-zone-card atlas-marshall-day-section">
      <summary>
        <div>
          <strong>{group.label}</strong>
          <span>{group.tasks.length} {group.tasks.length === 1 ? "task" : "tasks"}</span>
        </div>
        <b>Marshall</b>
      </summary>
      <div className="atlas-overview-task-list">
        {group.tasks.length ? group.tasks.map((task) => <MarshallTaskCard key={task.task_id} task={task} />) : <p className="atlas-task-page-muted">No Marshall tasks scheduled.</p>}
      </div>
    </section>
  );
}

export default function AtlasMarshallPage() {
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetchAtlasTaskCards({ scope: "marshall" });
        setTasks((response.taskCards ?? []).sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b))));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Marshall tasks failed.");
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

    void load();
    void loadWeather();
  }, []);

  const parentTasks = useMemo(() => tasks.filter((task) => !isChildTask(task)), [tasks]);
  const weekTasks = useMemo(() => parentTasks.filter((task) => task.due_date && task.due_date >= startIso && task.due_date <= endIso), [parentTasks]);
  const openWeekTasks = useMemo(() => weekTasks.filter(isOpenTask), [weekTasks]);
  const doneWeekTasks = useMemo(() => weekTasks.filter(isDoneTask), [weekTasks]);
  const dayGroups = useMemo(() => dayRange().map((dateIso) => ({
    dateIso,
    label: prettyDate(dateIso, true),
    tasks: openWeekTasks.filter((task) => task.due_date === dateIso).sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b))),
  })), [openWeekTasks]);
  const blockedCount = openWeekTasks.filter((task) => task.status === "blocked").length;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-marshall-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Marshall</span></Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <Link href="/" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to farm tasks">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-marshall-body">
          <section className="atlas-overview-hero atlas-marshall-hero">
            <div>
              <strong>Marshall Week</strong>
              <span>{prettyDate(startIso)}–{prettyDate(endIso)}</span>
            </div>
            <p>{loading ? "Loading Marshall list" : `${openWeekTasks.length} open tasks · ${blockedCount} waiting`}</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Marshall task stats">
            <article><strong>{loading ? "…" : openWeekTasks.length}</strong><span>open</span></article>
            <article><strong>{loading ? "…" : doneWeekTasks.length}</strong><span>done</span></article>
            <article><strong>{loading ? "…" : blockedCount}</strong><span>waiting</span></article>
            <article><strong>{loading ? "…" : dayGroups.filter((group) => group.tasks.length).length}</strong><span>days</span></article>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Loading Marshall tasks.</div> : null}

          {!loading ? (
            <section className="atlas-overview-zone-list atlas-marshall-list" aria-label="Marshall task list">
              {dayGroups.map((group) => <MarshallDaySection key={group.dateIso} group={group} />)}
              {!openWeekTasks.length ? <div className="atlas-task-page-empty">No Marshall tasks are open for Jul 19–25.</div> : null}
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
