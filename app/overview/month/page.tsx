"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import {
  collectionZone,
  detail,
  filterMonthOverviewTasks,
  groupTasksByZone,
  isUrgentTask,
  location,
  monthEndIso,
  monthName,
  monthProgress,
  prettyShortDate,
  routeCountLineForTasks,
  routeForTask,
  routeLabels,
  subject,
  todayIso,
  type ZoneTaskOverview,
} from "@/lib/atlas/task-overview";

type WeatherResponse = { ok: boolean; label?: string };

function TaskDueLabel({ task, anchorIso }: { task: AtlasTaskCard; anchorIso: string }) {
  if (!task.due_date) return <em>open</em>;
  if (task.due_date < anchorIso) return <em className="urgent">carryover · {prettyShortDate(task.due_date)}</em>;
  return <em>{prettyShortDate(task.due_date)}</em>;
}

function ZoneSection({ zone, anchorIso }: { zone: ZoneTaskOverview; anchorIso: string }) {
  return (
    <details className="atlas-overview-zone-card">
      <summary>
        <div>
          <strong>{zone.zone}</strong>
          <span>{zone.tasks.length} open{zone.urgentCount ? ` · ${zone.urgentCount} urgent` : ""}</span>
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

export default function AtlasMonthOverviewPage() {
  const [anchorIso, setAnchorIso] = useState(todayIso());
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");

  useEffect(() => {
    setAnchorIso(new URLSearchParams(window.location.search).get("date") || todayIso());

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

  const progress = monthProgress(anchorIso);
  const endIso = monthEndIso(anchorIso);
  const monthTasks = useMemo(() => filterMonthOverviewTasks(tasks, anchorIso), [anchorIso, tasks]);
  const urgentCount = useMemo(() => monthTasks.filter((task) => isUrgentTask(task, anchorIso)).length, [anchorIso, monthTasks]);
  const zoneGroups = useMemo(() => groupTasksByZone(monthTasks, anchorIso), [anchorIso, monthTasks]);
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
          <section className="atlas-overview-hero atlas-overview-month-hero">
            <div>
              <strong>{monthName(anchorIso)}</strong>
              <span>through {prettyShortDate(endIso)}</span>
            </div>
            <div className="atlas-overview-month-progress-row">
              <div className="atlas-overview-month-progress"><i style={{ width: `${progress.percent}%` }} /></div>
              <p>{progress.day} of {progress.days} days · {loading ? "loading" : `${monthTasks.length} open`}</p>
            </div>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Month overview stats">
            <article><strong>{loading ? "…" : monthTasks.length}</strong><span>open</span></article>
            <article><strong>{loading ? "…" : urgentCount}</strong><span>urgent</span></article>
            <article><strong>{loading ? "…" : zoneGroups.length}</strong><span>zones</span></article>
            <article><strong>{topZone}</strong><span>most open</span></article>
          </section>

          <section className="atlas-overview-summary-line">
            <p>{loading ? "Loading month work" : routeCountLineForTasks(monthTasks)}</p>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}

          <section className="atlas-overview-zone-list" aria-label="Open work by zone">
            {loading ? <div className="atlas-task-page-empty">Loading zone overview.</div> : null}
            {!loading && zoneGroups.length === 0 ? <div className="atlas-task-page-empty">No open work in this month window.</div> : null}
            {zoneGroups.map((zone) => <ZoneSection key={zone.zone} zone={zone} anchorIso={anchorIso} />)}
          </section>
        </div>
      </section>
    </main>
  );
}
