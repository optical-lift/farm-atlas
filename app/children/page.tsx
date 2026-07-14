"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { atlasMetadataValue, atlasMetaString, atlasTaskDisplay } from "@/lib/atlas/task-display";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type WeatherResponse = { ok: boolean; label?: string };

type ChildrenSectionProps = {
  title: string;
  tasks: AtlasTaskCard[];
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

function isOpenTask(task: AtlasTaskCard) {
  return task.status === "open" || task.status === "blocked";
}

function isDoneTask(task: AtlasTaskCard) {
  return task.status === "done" || task.task_outcomes?.[0]?.outcome === "done" || atlasMetaString(task, "checklist_status") === "done";
}

function taskSortValue(task: AtlasTaskCard) {
  return `${task.due_date ?? "9999-12-31"}-${String(metaNumber(task, "day_order")).padStart(5, "0")}-${atlasTaskDisplay(task).title}`;
}

function taskHref(task: AtlasTaskCard) {
  return `/task-focus/${encodeURIComponent(task.task_id)}?returnTo=${encodeURIComponent("/children")}`;
}

function childSafeLabel(task: AtlasTaskCard) {
  return atlasMetaString(task, "child_safe_label") || "Kid chore";
}

function helperLine(task: AtlasTaskCard) {
  return atlasMetaString(task, "kids_helper_line") || atlasMetaString(task, "display_detail") || atlasTaskDisplay(task).detail;
}

function ChildrenTaskCard({ task }: { task: AtlasTaskCard }) {
  const display = atlasTaskDisplay(task);
  return (
    <Link className="atlas-overview-task-card atlas-owner-task-card atlas-children-task-card" href={taskHref(task)}>
      <div>
        <strong>{display.title}</strong>
        <span>{childSafeLabel(task)} · {display.location}</span>
      </div>
      <em>{prettyDate(task.due_date)}</em>
      <p>{helperLine(task)}</p>
    </Link>
  );
}

function ChildrenSection({ title, tasks, empty }: ChildrenSectionProps) {
  return (
    <section className="atlas-overview-zone-card atlas-owner-section atlas-children-section">
      <summary>
        <div>
          <strong>{title}</strong>
          <span>{tasks.length} {tasks.length === 1 ? "chore" : "chores"}</span>
        </div>
        <b>Kids</b>
      </summary>
      <div className="atlas-overview-task-list">
        {tasks.length ? tasks.map((task) => <ChildrenTaskCard key={task.task_id} task={task} />) : <p className="atlas-task-page-muted">{empty}</p>}
      </div>
    </section>
  );
}

export default function AtlasChildrenPage() {
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
        const response = await fetchAtlasTaskCards({ scope: "children" });
        setTasks((response.taskCards ?? []).sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b))));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Children chores failed.");
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
  const openParents = useMemo(() => parentTasks.filter(isOpenTask), [parentTasks]);
  const todayTasks = useMemo(() => openParents.filter((task) => task.due_date === today || !task.due_date), [openParents, today]);
  const weekTasks = useMemo(() => openParents.filter((task) => task.due_date && task.due_date > today && task.due_date <= weekEnd), [openParents, today, weekEnd]);
  const doneTasks = useMemo(() => parentTasks.filter(isDoneTask).slice(0, 8), [parentTasks]);
  const recurringCount = openParents.filter((task) => atlasMetadataValue(task, "recreate_on_done") === true || atlasMetadataValue(task, "recreate_on_done") === "true").length;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-owner-page-shell atlas-children-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Children</span></Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <Link href="/" className="atlas-note-plus atlas-overview-top-dot" aria-label="Back to farm tasks">↩</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-owner-body atlas-children-body">
          <section className="atlas-overview-hero atlas-owner-hero atlas-children-hero">
            <div>
              <strong>Kid Chores</strong>
              <span>{prettyDate(today)}–{prettyDate(weekEnd)}</span>
            </div>
            <p>{loading ? "Loading children list" : `${openParents.length} open chores · ${recurringCount} weekly/repeating`}</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Children chore stats">
            <article><strong>{loading ? "…" : todayTasks.length}</strong><span>ready</span></article>
            <article><strong>{loading ? "…" : weekTasks.length}</strong><span>this week</span></article>
            <article><strong>{loading ? "…" : recurringCount}</strong><span>weekly</span></article>
            <article><strong>{loading ? "…" : doneTasks.length}</strong><span>done</span></article>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Loading children chores.</div> : null}

          {!loading ? (
            <section className="atlas-overview-zone-list atlas-owner-list atlas-children-list" aria-label="Children chore list">
              <ChildrenSection title="Ready for Kids" tasks={todayTasks} empty="No kid chores ready now." />
              <ChildrenSection title="This Week" tasks={weekTasks} empty="No kid chores later this week." />
              {doneTasks.length ? <ChildrenSection title="Recently Done" tasks={doneTasks} empty="No kid chores done yet." /> : null}
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
