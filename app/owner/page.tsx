"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { atlasMetadataValue, atlasMetaString, atlasTaskDisplay } from "@/lib/atlas/task-display";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type WeatherResponse = { ok: boolean; label?: string };

type OwnerSectionProps = {
  title: string;
  tasks: AtlasTaskCard[];
  childrenByParent: Map<string, AtlasTaskCard[]>;
  empty: string;
};

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDaysIsoFrom(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "No date";
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

function parentTaskId(task: AtlasTaskCard) {
  return atlasMetaString(task, "parent_task_id") || "";
}

function isOpenTask(task: AtlasTaskCard) {
  return task.status === "open" || task.status === "blocked";
}

function isDoneTask(task: AtlasTaskCard) {
  return task.status === "done" || task.task_outcomes?.[0]?.outcome === "done" || atlasMetaString(task, "checklist_status") === "done";
}

function taskSortValue(task: AtlasTaskCard) {
  return `${task.due_date ?? "9999-12-31"}-${String(metaNumber(task, "day_order")).padStart(5, "0")}-${atlasTaskDisplay(task).title}`;
}

function buildChildrenByParent(tasks: AtlasTaskCard[]) {
  const map = new Map<string, AtlasTaskCard[]>();
  tasks.filter(isChildTask).forEach((task) => {
    const parentId = parentTaskId(task);
    if (!parentId) return;
    const rows = map.get(parentId) ?? [];
    map.set(parentId, [...rows, task].sort((a, b) => metaNumber(a, "step_order") - metaNumber(b, "step_order")));
  });
  return map;
}

function taskHref(task: AtlasTaskCard) {
  const params = new URLSearchParams({
    taskId: task.task_id,
    direct: "1",
    returnTo: "/owner",
  });
  return `/task?${params.toString()}`;
}

function OwnerTaskCard({ task, childrenByParent }: { task: AtlasTaskCard; childrenByParent: Map<string, AtlasTaskCard[]> }) {
  const display = atlasTaskDisplay(task);
  const children = childrenByParent.get(task.task_id) ?? [];
  const openSteps = children.filter((child) => !isDoneTask(child)).length;
  const stepLine = children.length ? `${children.length - openSteps}/${children.length} steps done` : display.detail;

  return (
    <a className="atlas-overview-task-card atlas-owner-task-card" href={taskHref(task)}>
      <div>
        <strong>{display.title}</strong>
        <span>{display.location}</span>
      </div>
      <em>{prettyDate(task.due_date)}</em>
      <p>{stepLine}</p>
    </a>
  );
}

function OwnerSection({ title, tasks, childrenByParent, empty }: OwnerSectionProps) {
  return (
    <section className="atlas-overview-zone-card atlas-owner-section">
      <summary>
        <div>
          <strong>{title}</strong>
          <span>{tasks.length} {tasks.length === 1 ? "task" : "tasks"}</span>
        </div>
        <b>Owner</b>
      </summary>
      <div className="atlas-overview-task-list">
        {tasks.length ? tasks.map((task) => <OwnerTaskCard key={task.task_id} task={task} childrenByParent={childrenByParent} />) : <p className="atlas-task-page-muted">{empty}</p>}
      </div>
    </section>
  );
}

export default function AtlasOwnerPage() {
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const today = todayIso();
  const weekEnd = addDaysIsoFrom(today, 6);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetchAtlasTaskCards({ scope: "owner" });
        setTasks((response.taskCards ?? []).sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b))));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Owner tasks failed.");
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
  const childrenByParent = useMemo(() => buildChildrenByParent(tasks), [tasks]);
  const openParents = useMemo(() => parentTasks.filter(isOpenTask), [parentTasks]);
  const todayTasks = useMemo(() => openParents.filter((task) => task.due_date === today), [openParents, today]);
  const weekTasks = useMemo(() => openParents.filter((task) => task.due_date && task.due_date > today && task.due_date <= weekEnd), [openParents, today, weekEnd]);
  const laterTasks = useMemo(() => openParents.filter((task) => !task.due_date || task.due_date > weekEnd), [openParents, weekEnd]);
  const doneTasks = useMemo(() => parentTasks.filter(isDoneTask).slice(0, 8), [parentTasks]);
  const blockedCount = openParents.filter((task) => task.status === "blocked").length;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-owner-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Owner</span></Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <Link href="/" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to farm tasks">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-owner-body">
          <section className="atlas-overview-hero atlas-owner-hero">
            <div>
              <strong>Owner Work</strong>
              <span>{prettyDate(today)}–{prettyDate(weekEnd)}</span>
            </div>
            <p>{loading ? "Loading owner list" : `${openParents.length} open owner tasks · ${blockedCount} waiting`}</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Owner task stats">
            <article><strong>{loading ? "…" : todayTasks.length}</strong><span>today</span></article>
            <article><strong>{loading ? "…" : weekTasks.length}</strong><span>this week</span></article>
            <article><strong>{loading ? "…" : laterTasks.length}</strong><span>later</span></article>
            <article><strong>{loading ? "…" : doneTasks.length}</strong><span>done</span></article>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Loading owner tasks.</div> : null}

          {!loading ? (
            <section className="atlas-overview-zone-list atlas-owner-list" aria-label="Owner task list">
              <OwnerSection title="Today" tasks={todayTasks} childrenByParent={childrenByParent} empty="No owner tasks due today." />
              <OwnerSection title="This Week" tasks={weekTasks} childrenByParent={childrenByParent} empty="No owner tasks later this week." />
              <OwnerSection title="Later" tasks={laterTasks} childrenByParent={childrenByParent} empty="No later owner tasks." />
              {doneTasks.length ? <OwnerSection title="Recently Done" tasks={doneTasks} childrenByParent={childrenByParent} empty="No owner tasks done yet." /> : null}
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
