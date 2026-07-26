"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { atlasDayTaskCues, atlasDayTaskFamily } from "@/lib/atlas/day-route";
import {
  atlasRouteLabels,
  atlasRouteOrder,
  atlasTaskDisplay,
  type AtlasWorkRouteKey,
} from "@/lib/atlas/task-display";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import {
  addDaysIsoFrom,
  collectionZone,
  dateFromIso,
  isChildTask,
  prettyShortDate,
  routeForTask,
  taskSortValue,
  todayIso,
} from "@/lib/atlas/task-overview";
import { atlasWorkOrderLabel } from "@/lib/atlas/work-order";

type WeatherResponse = { ok: boolean; label?: string };
type WeekViewMode = "timeline" | "zone";
type WeekRouteFilter = "all" | AtlasWorkRouteKey;

type WeekDay = {
  dateIso: string;
  index: number;
  tasks: AtlasTaskCard[];
  openTasks: AtlasTaskCard[];
  doneTasks: AtlasTaskCard[];
};

function validIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function meta(task: AtlasTaskCard, key: string) {
  return task.metadata?.[key];
}

function isDoneTask(task: AtlasTaskCard) {
  return task.status === "done" || text(meta(task, "checklist_status")) === "done" || task.task_outcomes?.[0]?.outcome === "done";
}

function isOpenTask(task: AtlasTaskCard) {
  return (task.status === "open" || task.status === "blocked") && !isChildTask(task);
}

function isExtraCredit(task: AtlasTaskCard) {
  const mode = text(meta(task, "day_work_order_mode")) || text(meta(task, "work_order_mode"));
  const label = `${text(meta(task, "day_work_order_label"))} ${text(meta(task, "work_order_label"))}`.toLowerCase();
  return mode === "extra_credit" || label.includes("extra credit");
}

function isWeekTask(task: AtlasTaskCard) {
  return !isChildTask(task) && !isExtraCredit(task) && (isOpenTask(task) || isDoneTask(task));
}

function prettyDay(dateIso: string) {
  const date = dateFromIso(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function railDay(dateIso: string) {
  const date = dateFromIso(dateIso);
  if (Number.isNaN(date.getTime())) return { weekday: dateIso, day: "" };
  return {
    weekday: date.toLocaleDateString("en-US", { weekday: "short" }),
    day: date.toLocaleDateString("en-US", { day: "numeric" }),
  };
}

function daysInRange(startIso: string, endIso: string) {
  const start = dateFromIso(startIso).getTime();
  const end = dateFromIso(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 7;
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function taskHref(task: AtlasTaskCard, returnTo: string) {
  return `/task-focus/${encodeURIComponent(task.task_id)}?returnTo=${encodeURIComponent(returnTo)}`;
}

function dayHref(dateIso: string) {
  return `/day?date=${encodeURIComponent(dateIso)}&view=work_order`;
}

function progressPercent(done: number, total: number) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function matchesRoute(task: AtlasTaskCard, routeFilter: WeekRouteFilter) {
  return routeFilter === "all" || routeForTask(task) === routeFilter;
}

function WeekTaskCard({ task, current, returnTo }: { task: AtlasTaskCard; current: boolean; returnTo: string }) {
  const display = atlasTaskDisplay(task);
  const family = atlasDayTaskFamily(task);
  const cues = atlasDayTaskCues(task);
  const blocked = task.status === "blocked";
  const routeState = blocked ? "blocked" : current ? "current" : "future";

  return (
    <Link
      className={`atlas-day-task-card atlas-week-task-card atlas-day-route-${routeState}`}
      href={taskHref(task, returnTo)}
      aria-current={current ? "step" : undefined}
    >
      <small className="atlas-day-task-family">{current ? `Current · ${family}` : family}</small>
      <strong>{display.title}</strong>
      <span>{atlasWorkOrderLabel(task)} · {collectionZone(task)}</span>
      {display.detail ? <em>{display.detail}</em> : null}
      {cues.length ? <span className="atlas-day-task-cues">{cues.map((cue) => <i key={cue}>{cue}</i>)}</span> : null}
    </Link>
  );
}

function WeekDaySection({
  day,
  activeRoute,
  viewMode,
  returnTo,
  today,
}: {
  day: WeekDay;
  activeRoute: WeekRouteFilter;
  viewMode: WeekViewMode;
  returnTo: string;
  today: string;
}) {
  const filteredOpenTasks = day.openTasks.filter((task) => matchesRoute(task, activeRoute));
  const previewLimit = day.index === 0 ? 5 : day.index === 1 ? 3 : 2;
  const previewTasks = filteredOpenTasks.slice(0, previewLimit);
  const remaining = Math.max(0, filteredOpenTasks.length - previewTasks.length);
  const currentTaskId = day.dateIso === today
    ? filteredOpenTasks.find((task) => task.status === "open")?.task_id ?? filteredOpenTasks[0]?.task_id ?? null
    : null;
  const routeCounts = atlasRouteOrder
    .map((key) => ({ key, label: atlasRouteLabels[key], count: day.openTasks.filter((task) => routeForTask(task) === key).length }))
    .filter((entry) => entry.count > 0)
    .slice(0, 4);
  const zones = Array.from(new Set(previewTasks.map(collectionZone))).map((zone) => ({
    zone,
    tasks: previewTasks.filter((task) => collectionZone(task) === zone),
  }));
  const total = day.tasks.length;
  const done = day.doneTasks.length;
  const isToday = day.dateIso === today;

  return (
    <details
      id={`week-day-${day.dateIso}`}
      className={`atlas-week-day-section${isToday ? " today" : ""}${total === done && total > 0 ? " complete" : ""}`}
      open={day.index <= 1}
    >
      <summary>
        <div className="atlas-week-day-summary-copy">
          <div><strong>{prettyDay(day.dateIso)}</strong>{isToday ? <span>Today</span> : null}</div>
          <p>{total ? `${done} of ${total} finished · ${day.openTasks.length} open` : "No work planned"}</p>
        </div>
        <b aria-hidden="true">⌄</b>
      </summary>

      <div className="atlas-week-day-body">
        {total ? (
          <div className="atlas-week-day-progress" aria-label={`${prettyDay(day.dateIso)} progress`}>
            <span style={{ width: `${progressPercent(done, total)}%` }} />
          </div>
        ) : null}

        {routeCounts.length ? (
          <div className="atlas-week-day-route-counts" aria-label={`${prettyDay(day.dateIso)} work types`}>
            {routeCounts.map((entry) => <span key={entry.key}>{entry.label} {entry.count}</span>)}
          </div>
        ) : null}

        {viewMode === "timeline" ? (
          <div className="atlas-day-route-spine atlas-week-route-spine">
            {previewTasks.map((task) => (
              <WeekTaskCard task={task} current={task.task_id === currentTaskId} returnTo={returnTo} key={task.task_id} />
            ))}
          </div>
        ) : (
          <div className="atlas-week-zone-preview">
            {zones.map((zone) => (
              <section key={zone.zone}>
                <h3>{zone.zone}</h3>
                <div className="atlas-day-route-spine atlas-week-route-spine">
                  {zone.tasks.map((task) => (
                    <WeekTaskCard task={task} current={task.task_id === currentTaskId} returnTo={returnTo} key={task.task_id} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {!previewTasks.length ? (
          <div className="atlas-week-day-empty">{activeRoute === "all" ? (total && done === total ? "This day is complete." : "No open work planned.") : `No ${atlasRouteLabels[activeRoute]} work planned.`}</div>
        ) : null}

        <footer>
          {remaining ? <span>{remaining} more {remaining === 1 ? "task" : "tasks"}</span> : <span>{day.openTasks.length ? "Day preview complete" : "Day clear"}</span>}
          <Link href={dayHref(day.dateIso)}>Open full day <span aria-hidden="true">→</span></Link>
        </footer>
      </div>
    </details>
  );
}

function ExceptionStrip({
  label,
  tasks,
  activeRoute,
  returnTo,
}: {
  label: string;
  tasks: AtlasTaskCard[];
  activeRoute: WeekRouteFilter;
  returnTo: string;
}) {
  const filtered = tasks.filter((task) => matchesRoute(task, activeRoute));
  if (!filtered.length) return null;

  return (
    <details className="atlas-week-exception-strip">
      <summary><strong>{label}</strong><span>{filtered.length} {filtered.length === 1 ? "task" : "tasks"}</span><b aria-hidden="true">⌄</b></summary>
      <div className="atlas-day-route-spine atlas-week-route-spine">
        {filtered.slice(0, 4).map((task) => <WeekTaskCard task={task} current={false} returnTo={returnTo} key={task.task_id} />)}
      </div>
    </details>
  );
}

export default function AtlasWeekOverviewPage() {
  const [anchorIso, setAnchorIso] = useState(todayIso());
  const [explicitEndIso, setExplicitEndIso] = useState<string | null>(null);
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [activeRoute, setActiveRoute] = useState<WeekRouteFilter>("all");
  const [viewMode, setViewMode] = useState<WeekViewMode>("timeline");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get("date");
    const endParam = params.get("end");
    const resolvedAnchor = validIso(dateParam) ? dateParam as string : todayIso();
    const resolvedEnd = validIso(endParam) ? endParam as string : addDaysIsoFrom(resolvedAnchor, 6);
    setAnchorIso(resolvedAnchor);
    setExplicitEndIso(validIso(endParam) ? endParam : null);

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetchAtlasTaskCards({ viewerScoped: true, dueThrough: resolvedEnd, doneDate: resolvedAnchor });
        setTasks(response.taskCards ?? []);
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

    void load();
    void loadWeather();
  }, []);

  const weekEndIso = explicitEndIso ?? addDaysIsoFrom(anchorIso, 6);
  const dateCount = daysInRange(anchorIso, weekEndIso);
  const weekDates = useMemo(() => Array.from({ length: dateCount }, (_, index) => addDaysIsoFrom(anchorIso, index)), [anchorIso, dateCount]);
  const returnTo = `/overview/week?date=${encodeURIComponent(anchorIso)}${explicitEndIso ? `&end=${encodeURIComponent(explicitEndIso)}` : ""}`;

  const relevantTasks = useMemo(() => tasks.filter(isWeekTask).sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b))), [tasks]);
  const openTasks = useMemo(() => relevantTasks.filter(isOpenTask), [relevantTasks]);
  const scheduledWeekTasks = useMemo(() => openTasks.filter((task) => Boolean(task.due_date && task.due_date >= anchorIso && task.due_date <= weekEndIso)), [anchorIso, openTasks, weekEndIso]);
  const doneWeekTasks = useMemo(() => relevantTasks.filter(isDoneTask).filter((task) => Boolean(task.due_date && task.due_date >= anchorIso && task.due_date <= weekEndIso)), [anchorIso, relevantTasks, weekEndIso]);
  const carryoverTasks = useMemo(() => openTasks.filter((task) => Boolean(task.due_date && task.due_date < anchorIso)), [anchorIso, openTasks]);
  const unplacedTasks = useMemo(() => openTasks.filter((task) => !task.due_date), [openTasks]);
  const weekOpenCount = scheduledWeekTasks.length + carryoverTasks.length + unplacedTasks.length;

  const routeCounts = useMemo(() => atlasRouteOrder
    .map((key) => ({ key, label: atlasRouteLabels[key], count: openTasks.filter((task) => routeForTask(task) === key).length }))
    .filter((entry) => entry.count > 0), [openTasks]);

  const days = useMemo<WeekDay[]>(() => weekDates.map((dateIso, index) => {
    const dayTasks = relevantTasks.filter((task) => task.due_date === dateIso);
    return {
      dateIso,
      index,
      tasks: dayTasks,
      openTasks: dayTasks.filter(isOpenTask),
      doneTasks: dayTasks.filter(isDoneTask),
    };
  }), [relevantTasks, weekDates]);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell atlas-week-route-page">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Elm Farm</span></Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <span className="atlas-note-plus atlas-overview-top-dot" aria-hidden="true">•</span>
        </header>

        <div className="atlas-task-page-body atlas-overview-body atlas-week-route-body">
          <section className="atlas-week-route-header">
            <div className="atlas-week-route-title-row">
              <div><strong>{explicitEndIso ? "Work Week" : "This Week"}</strong><span>{prettyShortDate(anchorIso)}–{prettyShortDate(weekEndIso)}</span></div>
              <div className="atlas-day-filter-pill atlas-day-view-toggle" aria-label="View week as timeline or zone">
                <button type="button" className={viewMode === "timeline" ? "selected" : ""} onClick={() => setViewMode("timeline")}>Timeline</button>
                <button type="button" className={viewMode === "zone" ? "selected" : ""} onClick={() => setViewMode("zone")}>Zone</button>
              </div>
            </div>
            <p>{loading ? "Loading farm week" : `${doneWeekTasks.length} finished · ${weekOpenCount} open${carryoverTasks.length ? ` · ${carryoverTasks.length} carryover` : ""}`}</p>

            <div className="atlas-week-route-filters" aria-label="Filter week by work type">
              <button type="button" className={activeRoute === "all" ? "selected" : ""} onClick={() => setActiveRoute("all")}>All {weekOpenCount}</button>
              {routeCounts.map((entry) => (
                <button type="button" className={activeRoute === entry.key ? "selected" : ""} onClick={() => setActiveRoute(entry.key)} key={entry.key}>{entry.label} {entry.count}</button>
              ))}
            </div>
          </section>

          <nav className="atlas-week-day-rail" aria-label="Days in this week">
            {days.map((day) => {
              const label = railDay(day.dateIso);
              const filteredOpen = day.openTasks.filter((task) => matchesRoute(task, activeRoute)).length;
              const total = activeRoute === "all" ? day.tasks.length : filteredOpen;
              return (
                <a href={`#week-day-${day.dateIso}`} className={day.dateIso === anchorIso ? "today" : ""} key={day.dateIso}>
                  <span>{label.weekday}</span><strong>{label.day}</strong><em>{activeRoute === "all" && day.tasks.length ? `${day.doneTasks.length}/${day.tasks.length}` : total || "—"}</em>
                </a>
              );
            })}
          </nav>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}
          {loading ? <div className="atlas-task-page-empty">Loading daily timeline.</div> : null}

          {!loading ? <ExceptionStrip label="Carryover needs placement" tasks={carryoverTasks} activeRoute={activeRoute} returnTo={returnTo} /> : null}
          {!loading ? <ExceptionStrip label="Unscheduled work" tasks={unplacedTasks} activeRoute={activeRoute} returnTo={returnTo} /> : null}

          {!loading ? (
            <section className="atlas-week-day-list" aria-label="Daily week timeline">
              {days.map((day) => <WeekDaySection day={day} activeRoute={activeRoute} viewMode={viewMode} returnTo={returnTo} today={anchorIso} key={day.dateIso} />)}
            </section>
          ) : null}
        </div>
      </section>
    </main>
  );
}
