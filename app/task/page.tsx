"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  atlasFarmDateIso,
  atlasShiftFarmDate,
} from "@/lib/atlas/farm-day";
import {
  atlasRouteKeyForTask,
  atlasRouteLabels,
  atlasTaskDisplay,
  type AtlasWorkRouteKey,
} from "@/lib/atlas/task-display";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type LaneKey = "start" | "maintain" | "harvest" | "venue";
type WeatherResponse = { ok: boolean; label?: string };

type CollectionQuery = {
  route: AtlasWorkRouteKey | null;
  lane: LaneKey | null;
};

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function initialQuery(): CollectionQuery {
  if (typeof window === "undefined") return { route: null, lane: null };
  const params = new URLSearchParams(window.location.search);
  const route = params.get("route");
  const lane = params.get("lane");
  return {
    route: route && route in atlasRouteLabels ? route as AtlasWorkRouteKey : null,
    lane: lane === "start" || lane === "maintain" || lane === "harvest" || lane === "venue" ? lane : null,
  };
}

function metaString(task: AtlasTaskCard, key: string) {
  const value = task.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metaNumber(task: AtlasTaskCard, key: string) {
  const value = task.metadata?.[key];
  return typeof value === "number" ? value : null;
}

function isChildTask(task: AtlasTaskCard) {
  return Boolean(task.parent_task_id)
    || task.metadata?.is_child_task === true
    || task.metadata?.is_child_task === "true";
}

function laneForTask(task: AtlasTaskCard): LaneKey {
  const display = atlasTaskDisplay(task);
  const joined = `${task.task_type} ${task.action_key ?? ""} ${display.title} ${display.action}`.toLowerCase();
  if (joined.includes("harvest") || joined.includes("postharvest") || joined.includes("gather")) return "harvest";
  if (joined.includes("venue") || joined.includes("paint") || joined.includes("trim") || joined.includes("chicken")) return "venue";
  if (joined.includes("seed") || joined.includes("sow") || joined.includes("plant") || joined.includes("transplant")) return "start";
  return "maintain";
}

function taskSortValue(task: AtlasTaskCard) {
  const dayOrder = metaNumber(task, "day_order") ?? 999;
  return `${task.due_date ?? "9999-12-31"}-${priorityRank[task.priority] ?? 9}-${String(dayOrder).padStart(3, "0")}-${task.title}`;
}

function prettyDate(dateIso: string | null | undefined) {
  if (!dateIso) return "No date";
  const date = new Date(`${dateIso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateIso : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function currentReturnTo(query: CollectionQuery) {
  const params = new URLSearchParams();
  if (query.route) params.set("route", query.route);
  if (query.lane) params.set("lane", query.lane);
  const search = params.toString();
  return `/task${search ? `?${search}` : ""}`;
}

function taskHref(task: AtlasTaskCard, query: CollectionQuery) {
  return `/task-focus/${encodeURIComponent(task.task_id)}?returnTo=${encodeURIComponent(currentReturnTo(query))}`;
}

function TaskCollectionRow({ task, query }: { task: AtlasTaskCard; query: CollectionQuery }) {
  const display = atlasTaskDisplay(task);
  const meta = [display.location, task.due_date ? prettyDate(task.due_date) : "Undated", task.status === "blocked" ? "Blocked" : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link className="atlas-task-page-row" href={taskHref(task, query)}>
      <div>
        <strong>{display.title}</strong>
        <span>{meta}</span>
      </div>
      <small>{display.action || atlasRouteLabels[atlasRouteKeyForTask(task)]}</small>
    </Link>
  );
}

function TaskSection({
  label,
  tasks,
  query,
  empty,
}: {
  label: string;
  tasks: AtlasTaskCard[];
  query: CollectionQuery;
  empty: string;
}) {
  return (
    <section className="atlas-task-page-section">
      <div className="atlas-task-page-section-head"><span>{label}</span><small>{tasks.length}</small></div>
      {tasks.length ? tasks.map((task) => <TaskCollectionRow key={task.task_id} task={task} query={query} />) : <p className="atlas-task-page-muted">{empty}</p>}
    </section>
  );
}

export default function AtlasTaskPage() {
  const query = useMemo(initialQuery, []);
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const today = atlasFarmDateIso();
  const nextWeek = atlasShiftFarmDate(today, 7);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchAtlasTaskCards(),
      fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" })
        .then((response) => response.json() as Promise<WeatherResponse>)
        .catch(() => ({ ok: false } as WeatherResponse)),
    ])
      .then(([taskResponse, weather]) => {
        if (!active) return;
        setTasks((taskResponse.taskCards ?? [])
          .filter((task) => task.status !== "archived")
          .sort((left, right) => taskSortValue(left).localeCompare(taskSortValue(right))));
        setWeatherLabel(weather.ok && weather.label ? weather.label : "weather unavailable");
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Tasks failed.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const openTasks = useMemo(
    () => tasks
      .filter((task) => (task.status === "open" || task.status === "blocked") && !isChildTask(task))
      .filter((task) => !query.route || atlasRouteKeyForTask(task) === query.route)
      .filter((task) => !query.lane || laneForTask(task) === query.lane),
    [tasks, query],
  );

  const todayTasks = useMemo(
    () => openTasks.filter((task) => !task.due_date || task.due_date <= today),
    [openTasks, today],
  );
  const thisWeekTasks = useMemo(
    () => openTasks.filter((task) => task.due_date && task.due_date > today && task.due_date <= nextWeek),
    [nextWeek, openTasks, today],
  );
  const laterTasks = useMemo(
    () => openTasks.filter((task) => task.due_date && task.due_date > nextWeek),
    [nextWeek, openTasks],
  );

  const collectionLabel = query.route
    ? atlasRouteLabels[query.route]
    : query.lane
      ? query.lane.replace(/^./, (letter) => letter.toUpperCase())
      : "Task collection";

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell" data-atlas-task-collection="true">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Elm Farm</span></Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <Link href={`/day?date=${encodeURIComponent(today)}&view=work_order`} className="atlas-note-plus" aria-label="Open today">↩</Link>
        </header>
        <div className="atlas-task-page-body">
          <section className="atlas-task-page-hero atlas-route-collection-head">
            <span>Work collection</span>
            <h2>{collectionLabel}</h2>
            <p>{openTasks.length} open {openTasks.length === 1 ? "task" : "tasks"}. Opening one always enters canonical Task Focus.</p>
          </section>
          {loading ? <div className="atlas-task-page-empty">Loading tasks.</div> : null}
          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {!loading && !error ? (
            <>
              <TaskSection label="Today + carry-forward" tasks={todayTasks} query={query} empty="Nothing due or carried forward here." />
              <TaskSection label="Next 7 days" tasks={thisWeekTasks} query={query} empty="Nothing else scheduled in the next seven days." />
              <TaskSection label="Later" tasks={laterTasks} query={query} empty="No later work in this collection." />
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
