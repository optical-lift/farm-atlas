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
import {
  atlasBuildMowingCollectionSummary,
  atlasBuildWeedingCollectionSummary,
  atlasIsMowingCollectionMember,
  atlasIsWeedingCollectionMember,
  type AtlasWorkCollectionSummary,
} from "@/lib/atlas/work-collections";

type WeatherResponse = { ok: boolean; label?: string };

function validIso(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime()));
}

function TaskDueLabel({ task, anchorIso }: { task: AtlasTaskCard; anchorIso: string }) {
  if (!task.due_date) return <em>open</em>;
  if (task.due_date < anchorIso) return <em className="urgent">carryover · {prettyShortDate(task.due_date)}</em>;
  return <em>{prettyShortDate(task.due_date)}</em>;
}

function CollectionOverviewCard({ collection }: { collection: AtlasWorkCollectionSummary }) {
  return (
    <details className="atlas-overview-zone-card atlas-work-collection-section" open>
      <summary>
        <div>
          <strong>{collection.label}</strong>
          <span>{collection.dueCount} due · {collection.doneRecentCount} resting · {collection.notReadyCount} not ready</span>
        </div>
        <b>Collection</b>
      </summary>
      <div className="atlas-overview-task-list">
        <Link className="atlas-overview-task-card atlas-work-collection-task-card" href={collection.href}>
          <div>
            <strong>{collection.label}</strong>
            <span>{collection.preview}</span>
          </div>
          <em>next {collection.nextDueLabel}</em>
        </Link>
      </div>
    </details>
  );
}

function taskLocationLine(task: AtlasTaskCard) {
  const taskDetail = detail(task).trim();
  const taskLocation = location(task).trim();
  if (routeForTask(task) === "weed" && taskDetail) return taskDetail;
  if (taskLocation && taskLocation !== collectionZone(task)) return taskLocation;
  return taskDetail || taskLocation;
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
              <span>{taskLocationLine(task)}</span>
            </div>
            <TaskDueLabel task={task} anchorIso={anchorIso} />
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
  const weedingCollection = useMemo(() => atlasBuildWeedingCollectionSummary(tasks, weekEndIso), [tasks, weekEndIso]);
  const mowingCollection = useMemo(() => atlasBuildMowingCollectionSummary(tasks, weekEndIso), [tasks, weekEndIso]);
  const showWeedingCollection = Boolean(weedingCollection && weedingCollection.dueCount > 0);
  const showMowingCollection = Boolean(mowingCollection && mowingCollection.dueCount > 0);
  const standaloneWeekTasks = useMemo(
    () => weekTasks.filter((task) => !atlasIsWeedingCollectionMember(task) && !atlasIsMowingCollectionMember(task)),
    [weekTasks],
  );
  const carryoverCount = useMemo(() => standaloneWeekTasks.filter((task) => Boolean(task.due_date && task.due_date < anchorIso)).length, [anchorIso, standaloneWeekTasks]);
  const zoneGroups = useMemo(() => groupTasksByZone(standaloneWeekTasks, anchorIso), [anchorIso, standaloneWeekTasks]);
  const collectionCount = Number(showWeedingCollection) + Number(showMowingCollection);
  const topZone = showWeedingCollection ? "Weeding" : showMowingCollection ? "Mowing" : zoneGroups[0]?.zone ?? "No active zone";
  const displayedOpenCount = standaloneWeekTasks.length + collectionCount;

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
            <p>{loading ? "Loading farm week" : routeCountLineForTasks(standaloneWeekTasks)}</p>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Week overview stats">
            <article><strong>{loading ? "…" : displayedOpenCount}</strong><span>open</span></article>
            <article><strong>{loading ? "…" : carryoverCount}</strong><span>carryover</span></article>
            <article><strong>{loading ? "…" : zoneGroups.length + collectionCount}</strong><span>zones</span></article>
            <article><strong>{topZone}</strong><span>most open</span></article>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}

          <section className="atlas-overview-zone-list" aria-label="Open work by zone">
            {loading ? <div className="atlas-task-page-empty">Loading zone overview.</div> : null}
            {!loading && zoneGroups.length === 0 && collectionCount === 0 ? <div className="atlas-task-page-empty">No open work in this week window.</div> : null}
            {showWeedingCollection && weedingCollection ? <CollectionOverviewCard collection={weedingCollection} /> : null}
            {showMowingCollection && mowingCollection ? <CollectionOverviewCard collection={mowingCollection} /> : null}
            {zoneGroups.map((zone, index) => <ZoneSection key={zone.zone} zone={zone} anchorIso={anchorIso} openDefault={collectionCount === 0 && index === 0} />)}
          </section>
        </div>
      </section>
    </main>
  );
}
