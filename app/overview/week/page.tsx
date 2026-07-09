"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import {
  addDaysIsoFrom,
  collectionZone,
  detail,
  filterWeekOverviewTasks,
  groupTasksByZone,
  isRelevantOpenTask,
  location,
  prettyShortDate,
  routeCountLineForTasks,
  routeForTask,
  routeLabels,
  subject,
  taskSortValue,
  todayIso,
  type ZoneTaskOverview,
} from "@/lib/atlas/task-overview";

type WeatherResponse = { ok: boolean; label?: string };

function validIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function TaskDueLabel({ task, anchorIso }: { task: AtlasTaskCard; anchorIso: string }) {
  if (!task.due_date) return <em>open</em>;
  if (task.due_date < anchorIso) return <em className="urgent">carryover · {prettyShortDate(task.due_date)}</em>;
  return <em>{prettyShortDate(task.due_date)}</em>;
}

function ZoneSection({ zone, anchorIso, openDefault }: { zone: ZoneTaskOverview; anchorIso: string; openDefault: boolean }) {
  return (
    <details className="atlas-overview-zone-card" open={openDefault}>
      <summary>
        <div>
          <strong>{zone.zone}</strong>
          <span>{zone.tasks.length} open{zone.urgentCount ? ` · ${zone.urgentCount} carryover` : ""}</span>
        </div>
        <b>Open</b>
      </summary>
      <div className="atlas-overview-route-chip-row">
        {zone.routeCounts.map((item) => <span key={item.key}>{item.label} {item.count}</span>)}
      </div>
      <div className="atlas-overview-task-list">
        {zone.tasks.map((task) => (
          <Link className="atlas-overview-task-card" href={`/task?taskId=${encodeURIComponent(task.task_id)}`} key={task.task_id}>
            <div>
              <strong>{subject(task)}</strong>
              <span>{routeLabels[routeForTask(task)]} · {collectionZone(task)}</span>
            </div>
            <TaskDueLabel task={task} anchorIso={anchorIso} />
            <p>{detail(task) || location(task)}</p>
          </Link>
        ))}
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get("date");
    const endParam = params.get("end");
    setAnchorIso(validIso(dateParam) ? dateParam as string : todayIso());
    setExplicitEndIso(validIso(endParam) ? endParam : null);

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetchAtlasTaskCards();
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
  const weekTasks = useMemo(() => {
    if (!explicitEndIso) return filterWeekOverviewTasks(tasks, anchorIso);
    return tasks
      .filter(isRelevantOpenTask)
      .filter((task) => Boolean(task.due_date && task.due_date >= anchorIso && task.due_date <= weekEndIso))
      .sort((a, b) => taskSortValue(a).localeCompare(taskSortValue(b)));
  }, [anchorIso, explicitEndIso, tasks, weekEndIso]);
  const carryoverCount = useMemo(() => weekTasks.filter((task) => Boolean(task.due_date && task.due_date < anchorIso)).length, [anchorIso, weekTasks]);
  const zoneGroups = useMemo(() => groupTasksByZone(weekTasks, anchorIso), [anchorIso, weekTasks]);
  const topZone = zoneGroups[0]?.zone ?? "No active zone";

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Elm Farm</span></Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <span className="atlas-note-plus atlas-overview-top-dot" aria-hidden="true">•</span>
        </header>

        <div className="atlas-task-page-body atlas-overview-body">
          <section className="atlas-overview-hero">
            <div>
              <strong>{explicitEndIso ? "Work Week" : "This Week"}</strong>
              <span>{prettyShortDate(anchorIso)}–{prettyShortDate(weekEndIso)}</span>
            </div>
            <p>{loading ? "Loading farm week" : routeCountLineForTasks(weekTasks)}</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Week overview stats">
            <article><strong>{loading ? "…" : weekTasks.length}</strong><span>open</span></article>
            <article><strong>{loading ? "…" : carryoverCount}</strong><span>carryover</span></article>
            <article><strong>{loading ? "…" : zoneGroups.length}</strong><span>zones</span></article>
            <article><strong>{topZone}</strong><span>most open</span></article>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}

          <section className="atlas-overview-zone-list" aria-label="Open work by zone">
            {loading ? <div className="atlas-task-page-empty">Loading zone overview.</div> : null}
            {!loading && zoneGroups.length === 0 ? <div className="atlas-task-page-empty">No open work in this week window.</div> : null}
            {zoneGroups.map((zone, index) => <ZoneSection key={zone.zone} zone={zone} anchorIso={anchorIso} openDefault={index === 0} />)}
          </section>
        </div>
      </section>
    </main>
  );
}
