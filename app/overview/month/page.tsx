"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import {
  collectionZone,
  detail,
  filterMonthOverviewTasks,
  groupTasksByZone,
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
import { atlasBuildMowingCollectionSummary, atlasIsMowingCollectionMember, type AtlasWorkCollectionSummary } from "@/lib/atlas/work-collections";

type WeatherResponse = { ok: boolean; label?: string };

function TaskDueLabel({ task, anchorIso }: { task: AtlasTaskCard; anchorIso: string }) {
  if (!task.due_date) return <em>open</em>;
  if (task.due_date < anchorIso) return <em className="urgent">carryover · {prettyShortDate(task.due_date)}</em>;
  return <em>{prettyShortDate(task.due_date)}</em>;
}

function taskHref(task: AtlasTaskCard, returnTo: string) {
  return `/task-focus/${encodeURIComponent(task.task_id)}?returnTo=${encodeURIComponent(returnTo)}`;
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
            <strong>{collection.label} Work Collection</strong>
            <span>Independent mowing clocks</span>
          </div>
          <em>next {collection.nextDueLabel}</em>
          <p>{collection.preview}</p>
        </Link>
      </div>
    </details>
  );
}

function GroupSection({ group, anchorIso, returnTo }: { group: ZoneTaskOverview; anchorIso: string; returnTo: string }) {
  return (
    <details className="atlas-overview-zone-card">
      <summary>
        <div>
          <strong>{group.zone}</strong>
          <span>{group.tasks.length} open{group.urgentCount ? ` · ${group.urgentCount} carryover` : ""}</span>
        </div>
        <b>Open</b>
      </summary>
      <div className="atlas-overview-route-chip-row">
        {group.routeCounts.map((item) => <span key={item.key}>{item.label} {item.count}</span>)}
      </div>
      <div className="atlas-overview-task-list">
        {group.tasks.map((task) => (
          <Link className="atlas-overview-task-card" href={taskHref(task, returnTo)} key={task.task_id}>
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
  const [portalLabel, setPortalLabel] = useState("Atlas");
  const [hasFarmScope, setHasFarmScope] = useState<boolean | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");

  useEffect(() => {
    const requestedAnchor = new URLSearchParams(window.location.search).get("date");
    const resolvedAnchor = requestedAnchor && /^\d{4}-\d{2}-\d{2}$/.test(requestedAnchor) ? requestedAnchor : todayIso();
    const resolvedEnd = monthEndIso(resolvedAnchor);
    setAnchorIso(resolvedAnchor);

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetchAtlasTaskCards({
          viewerScoped: true,
          doneDate: resolvedAnchor,
          dueThrough: resolvedEnd,
        });
        setTasks(response.taskCards ?? []);
        setPortalLabel(response.portalLabel || response.activeFarmName || "Atlas");
        setHasFarmScope(response.hasFarmScope ?? true);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Tasks failed.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  useEffect(() => {
    if (hasFarmScope !== true) return;
    async function loadWeather() {
      try {
        const response = await fetch("/api/atlas/weather", { headers: { Accept: "application/json" }, cache: "no-store" });
        const data = (await response.json()) as WeatherResponse;
        setWeatherLabel(response.ok && data.ok && data.label ? data.label : "weather unavailable");
      } catch {
        setWeatherLabel("weather unavailable");
      }
    }
    void loadWeather();
  }, [hasFarmScope]);

  const progress = monthProgress(anchorIso);
  const endIso = monthEndIso(anchorIso);
  const returnTo = `/overview/month?date=${encodeURIComponent(anchorIso)}`;
  const monthTasks = useMemo(() => filterMonthOverviewTasks(tasks, anchorIso), [anchorIso, tasks]);
  const mowingCollection = useMemo(() => atlasBuildMowingCollectionSummary(tasks, endIso), [endIso, tasks]);
  const showMowingCollection = Boolean(mowingCollection && mowingCollection.dueCount > 0);
  const standaloneMonthTasks = useMemo(() => monthTasks.filter((task) => !atlasIsMowingCollectionMember(task)), [monthTasks]);
  const carryoverCount = useMemo(() => standaloneMonthTasks.filter((task) => Boolean(task.due_date && task.due_date < anchorIso)).length, [anchorIso, standaloneMonthTasks]);
  const groups = useMemo(() => groupTasksByZone(standaloneMonthTasks, anchorIso), [anchorIso, standaloneMonthTasks]);
  const topGroup = showMowingCollection ? "Mowing" : groups[0]?.zone ?? "No active group";
  const displayedOpenCount = standaloneMonthTasks.length + (showMowingCollection ? 1 : 0);
  const headerStatus = hasFarmScope === false ? `${displayedOpenCount} open` : weatherLabel;

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell atlas-overview-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone atlas-overview-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">{portalLabel}</span></Link>
          <span className="atlas-weather-line">{headerStatus}</span>
          <Link href={`/journal?date=${encodeURIComponent(anchorIso)}`} className="atlas-note-plus atlas-overview-top-dot" aria-label="Open Farm Journal">J</Link>
        </header>

        <div className="atlas-task-page-body atlas-overview-body">
          <section className="atlas-overview-hero atlas-overview-month-hero">
            <div>
              <strong>{monthName(anchorIso)}</strong>
              <span>through {prettyShortDate(endIso)}</span>
            </div>
            <div className="atlas-overview-month-progress-row">
              <div className="atlas-overview-month-progress"><i style={{ width: `${progress.percent}%` }} /></div>
              <p>{progress.day} of {progress.days} days · {loading ? "loading" : `${displayedOpenCount} open`}</p>
            </div>
          </section>

          <section className="atlas-overview-stat-grid" aria-label="Month overview stats">
            <article><strong>{loading ? "…" : displayedOpenCount}</strong><span>open</span></article>
            <article><strong>{loading ? "…" : carryoverCount}</strong><span>carryover</span></article>
            <article><strong>{loading ? "…" : groups.length + (showMowingCollection ? 1 : 0)}</strong><span>groups</span></article>
            <article><strong>{topGroup}</strong><span>most open</span></article>
          </section>

          <section className="atlas-overview-summary-line">
            <p>{loading ? "Loading month work" : routeCountLineForTasks(standaloneMonthTasks)}</p>
          </section>

          {error ? <div className="atlas-task-page-empty error">{error}</div> : null}

          <section className="atlas-overview-zone-list" aria-label="Open work by group">
            {loading ? <div className="atlas-task-page-empty">Loading task overview.</div> : null}
            {!loading && groups.length === 0 && !showMowingCollection ? <div className="atlas-task-page-empty">No open work in this month window.</div> : null}
            {showMowingCollection && mowingCollection ? <CollectionOverviewCard collection={mowingCollection} /> : null}
            {groups.map((group) => <GroupSection key={group.zone} group={group} anchorIso={anchorIso} returnTo={returnTo} />)}
          </section>
        </div>
      </section>
    </main>
  );
}
