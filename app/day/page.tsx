"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  atlasIsCropCycleTask,
  atlasRouteKeyForTask,
  atlasRouteLabels,
  atlasRouteOrder,
  atlasTaskDisplay,
  type AtlasWorkRouteKey,
} from "@/lib/atlas/task-display";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasWorkOrderLabel, atlasWorkOrderSortValue } from "@/lib/atlas/work-order";
import {
  atlasBuildMowingCollectionSummary,
  atlasBuildWeedingCollectionSummary,
  atlasIsMowingCollectionMember,
  atlasIsWeedingCollectionMember,
  type AtlasWorkCollectionSummary,
} from "@/lib/atlas/work-collections";

type RouteKey = AtlasWorkRouteKey;
type DayViewMode = "work_order" | "zone";
type WeatherResponse = { ok: boolean; label?: string };

const routeLabels = atlasRouteLabels;
const routeOrder = atlasRouteOrder;

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function prettyDate(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function dayOnly(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function meta(task: AtlasTaskCard, key: string) {
  return task.metadata?.[key];
}

function isChildTask(task: AtlasTaskCard) {
  return Boolean(task.parent_task_id) || meta(task, "is_child_task") === true || meta(task, "is_child_task") === "true";
}

function isWorkTask(task: AtlasTaskCard) {
  const joined = `${task.task_type ?? ""} ${task.title} ${task.unlock_text ?? ""}`.toLowerCase();
  if (task.status === "archived" || task.status === "skipped" || isChildTask(task)) return false;
  if (atlasIsCropCycleTask(task)) return true;
  return !(joined.includes("verify") || joined.includes("check") || joined.includes("confirm") || joined.includes("count") || joined.includes("germin") || joined.includes("walk field rows"));
}

function isDashboardWork(task: AtlasTaskCard) {
  return (task.status === "open" || task.status === "blocked") && isWorkTask(task);
}

function isDoneTask(task: AtlasTaskCard) {
  return task.status === "done" || text(meta(task, "checklist_status")) === "done" || task.task_outcomes?.[0]?.outcome === "done";
}

function isKidChore(task: AtlasTaskCard) {
  const joined = [
    task.task_type,
    task.title,
    text(meta(task, "work_route")),
    text(meta(task, "work_rhythm")),
    text(meta(task, "display_action")),
    text(meta(task, "collection_label")),
  ].filter(Boolean).join(" ").toLowerCase();
  return joined.includes("kid chore") || joined.includes("kid_chore") || joined.includes("feed chickens");
}

function isOwnerOnlyTask(task: AtlasTaskCard) {
  const ownerTask = meta(task, "owner_task");
  const assignedTo = text(meta(task, "assigned_to")).toLowerCase();
  return ownerTask === true || ownerTask === "true" || assignedTo === "owner";
}

function collectionZone(task: AtlasTaskCard) {
  return text(meta(task, "collection_zone")) || atlasTaskDisplay(task).location || "Elm Farm";
}

function taskHref(task: AtlasTaskCard) {
  return `/task?taskId=${encodeURIComponent(task.task_id)}`;
}

function isExtraCredit(task: AtlasTaskCard) {
  const mode = text(meta(task, "day_work_order_mode")) || text(meta(task, "work_order_mode"));
  const label = `${text(meta(task, "day_work_order_label"))} ${text(meta(task, "work_order_label"))}`.toLowerCase();
  return mode === "extra_credit" || label.includes("extra credit");
}

function TaskCard({ task, complete = false, overdue = false }: { task: AtlasTaskCard; complete?: boolean; overdue?: boolean }) {
  const display = atlasTaskDisplay(task);
  return (
    <Link className={`atlas-day-task-card${complete ? " complete" : ""}${overdue ? " atlas-day-overdue-task-card" : ""}${atlasIsCropCycleTask(task) ? " atlas-crop-cycle-task-card" : ""}`} href={taskHref(task)}>
      {overdue ? <b className="atlas-day-overdue-badge">Overdue</b> : null}
      <strong>{display.title}</strong>
      <span>{overdue ? `Due ${prettyDate(task.due_date ?? "")}` : complete ? "Complete" : `${atlasWorkOrderLabel(task)} · ${collectionZone(task)}`}</span>
      <em>{display.detail}</em>
    </Link>
  );
}

function WorkCollectionCard({ collection }: { collection: AtlasWorkCollectionSummary }) {
  return (
    <Link className="atlas-day-task-card atlas-work-collection-day-card" href={collection.href}>
      <strong>{collection.label}</strong>
      <span>{collection.dueCount} due · {collection.doneRecentCount} resting · {collection.notReadyCount} not ready</span>
      <em>{collection.preview}</em>
    </Link>
  );
}

function ViewToggle({ viewMode, onChange }: { viewMode: DayViewMode; onChange: (mode: DayViewMode) => void }) {
  return (
    <div className="atlas-day-filter-pill" aria-label="Filter day overview">
      <span>Filter by</span>
      <button type="button" className={viewMode === "work_order" ? "selected" : ""} onClick={() => onChange("work_order")}>Work order</button>
      <button type="button" className={viewMode === "zone" ? "selected" : ""} onClick={() => onChange("zone")}>Zone</button>
    </div>
  );
}

export default function AtlasDayPage() {
  const [dateIso, setDateIso] = useState(todayIso());
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [viewMode, setViewMode] = useState<DayViewMode>("work_order");

  useEffect(() => {
    setDateIso(new URLSearchParams(window.location.search).get("date") || todayIso());
    async function load() {
      try {
        setLoading(true);
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

  const allDayTasks = useMemo(() => tasks.filter(isWorkTask).filter((task) => task.due_date === dateIso), [dateIso, tasks]);
  const dayTasks = useMemo(() => tasks.filter(isDashboardWork).filter((task) => task.due_date === dateIso).sort((a, b) => atlasWorkOrderSortValue(a).localeCompare(atlasWorkOrderSortValue(b))), [dateIso, tasks]);
  const overdueTasks = useMemo(() => {
    if (dateIso !== todayIso()) return [];
    return tasks
      .filter(isDashboardWork)
      .filter((task) => Boolean(task.due_date && task.due_date < dateIso))
      .filter((task) => !isKidChore(task) && !isOwnerOnlyTask(task) && !isExtraCredit(task))
      .filter((task) => !atlasIsMowingCollectionMember(task) && !atlasIsWeedingCollectionMember(task))
      .sort((a, b) => `${a.due_date ?? ""}-${atlasWorkOrderSortValue(a)}`.localeCompare(`${b.due_date ?? ""}-${atlasWorkOrderSortValue(b)}`));
  }, [dateIso, tasks]);
  const requiredTasks = useMemo(() => dayTasks.filter((task) => !isExtraCredit(task)), [dayTasks]);
  const standaloneTasks = useMemo(() => requiredTasks.filter((task) => !atlasIsMowingCollectionMember(task) && !atlasIsWeedingCollectionMember(task)), [requiredTasks]);
  const extraCreditTasks = useMemo(() => dayTasks.filter(isExtraCredit), [dayTasks]);
  const doneDayTasks = useMemo(() => allDayTasks.filter(isDoneTask), [allDayTasks]);

  const mowingCollection = useMemo(() => atlasBuildMowingCollectionSummary(tasks, dateIso), [dateIso, tasks]);
  const weedingCollection = useMemo(() => atlasBuildWeedingCollectionSummary(tasks, dateIso), [dateIso, tasks]);
  const showWeedingCollection = Boolean(weedingCollection && weedingCollection.dueCount > 0);
  const showMowingCollection = Boolean(mowingCollection && mowingCollection.dueCount > 0);
  const collectionCount = Number(showWeedingCollection) + Number(showMowingCollection);

  const routeCards = useMemo(() => {
    const entries = routeOrder.map((key) => {
      const collection = key === "weed" ? weedingCollection : key === "mow" ? mowingCollection : null;
      const routeTasks = standaloneTasks.filter((task) => atlasRouteKeyForTask(task) === key);
      return { key, collection: collection && collection.dueCount > 0 ? collection : null, tasks: routeTasks };
    }).filter((entry) => entry.collection || entry.tasks.length);

    return entries.sort((a, b) => {
      if (a.key === "weed") return -1;
      if (b.key === "weed") return 1;
      if (a.key === "mow") return 1;
      if (b.key === "mow") return -1;
      return routeOrder.indexOf(a.key) - routeOrder.indexOf(b.key);
    });
  }, [mowingCollection, standaloneTasks, weedingCollection]);

  const zones = useMemo(() => Array.from(new Set(standaloneTasks.map(collectionZone))).sort(), [standaloneTasks]);

  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <header className="atlas-phone-top atlas-dashboard-top">
          <Link href="/" className="atlas-phone-brand atlas-task-header-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Elm Farm</span></Link>
          <span className="atlas-weather-line">{weatherLabel}</span>
          <Link href="/" className="atlas-note-plus" aria-label="Back to today">+</Link>
        </header>

        <div className="atlas-task-page-body">
          <section className="atlas-task-page-section atlas-route-collection atlas-day-browse">
            <div className="atlas-day-browse-head">
              <Link href="/" className="atlas-route-back atlas-day-back">← Week</Link>
              <div className="atlas-day-browse-title-row"><span>{dayOnly(dateIso)}</span><strong>{loading ? "Loading" : `${dayTasks.length} open · ${overdueTasks.length} overdue · ${doneDayTasks.length} done`}</strong></div>
              <p>{loading ? "Loading farm work" : `${standaloneTasks.length} regular tasks · ${collectionCount} work collections`}</p>
            </div>

            {error ? <div className="atlas-task-page-empty error">{error}</div> : null}

            <article className="atlas-day-route-hero">
              <div className="atlas-day-route-hero-head"><div><span>Day plan</span><strong>{prettyDate(dateIso)}</strong></div><em className="atlas-day-route-count-pill">{loading ? "…" : standaloneTasks.length + collectionCount + overdueTasks.length}</em></div>
              <div className="atlas-day-route-grid">
                {routeCards.length ? routeCards.map((entry) => {
                  if (entry.collection) return <Link key={entry.key} className="atlas-day-route-box" href={entry.collection.href}><strong>{entry.collection.label}</strong><span>{entry.collection.dueCount} due</span><em>{entry.collection.preview}</em></Link>;
                  const first = entry.tasks[0];
                  return <Link key={entry.key} className="atlas-day-route-box" href={taskHref(first)}><strong>{routeLabels[entry.key as RouteKey]}</strong><span>{entry.tasks.length} {entry.tasks.length === 1 ? "task" : "tasks"}</span><em>{entry.tasks.slice(0, 2).map((task) => atlasTaskDisplay(task).title).join(" · ")}</em></Link>;
                }) : <div className="atlas-day-route-empty">{loading ? "Loading farm tasks." : "No open farm tasks planned for this day."}</div>}
              </div>
            </article>

            {overdueTasks.length ? (
              <article className="atlas-day-route-group atlas-day-overdue-group" aria-label="Overdue carry-forward work">
                <div className="atlas-day-overdue-group-head"><div><span>Carry forward</span><h3>Overdue</h3></div><b>{overdueTasks.length}</b></div>
                <p>These unfinished tasks remain ahead of today’s regular work.</p>
                <div className="atlas-day-work-order-list">{overdueTasks.map((task) => <TaskCard task={task} overdue key={task.task_id} />)}</div>
              </article>
            ) : null}

            <ViewToggle viewMode={viewMode} onChange={setViewMode} />

            <div className="atlas-day-task-groups">
              {viewMode === "work_order" ? (
                <article className="atlas-day-route-group atlas-day-work-order-group">
                  <h3>Work Order</h3>
                  <div className="atlas-day-work-order-list">
                    {showWeedingCollection && weedingCollection ? <WorkCollectionCard collection={weedingCollection} /> : null}
                    {standaloneTasks.map((task) => <TaskCard task={task} key={task.task_id} />)}
                    {showMowingCollection && mowingCollection ? <WorkCollectionCard collection={mowingCollection} /> : null}
                    {!collectionCount && !standaloneTasks.length ? <div className="atlas-day-route-empty">No open farm tasks planned for this day.</div> : null}
                  </div>
                </article>
              ) : (
                <>
                  {showWeedingCollection && weedingCollection ? <article className="atlas-day-route-group atlas-day-work-collection-group"><h3>{weedingCollection.label}</h3><div className="atlas-day-zone-group"><WorkCollectionCard collection={weedingCollection} /></div></article> : null}
                  {zones.map((zone) => <article className="atlas-day-route-group" key={zone}><h3>{zone}</h3><div className="atlas-day-zone-group">{standaloneTasks.filter((task) => collectionZone(task) === zone).map((task) => <TaskCard task={task} key={task.task_id} />)}</div></article>)}
                  {showMowingCollection && mowingCollection ? <article className="atlas-day-route-group atlas-day-work-collection-group"><h3>{mowingCollection.label}</h3><div className="atlas-day-zone-group"><WorkCollectionCard collection={mowingCollection} /></div></article> : null}
                </>
              )}

              {extraCreditTasks.length ? <article className="atlas-day-route-group atlas-day-extra-credit-group"><h3>Extra Credit</h3><div className="atlas-day-zone-group">{extraCreditTasks.map((task) => <TaskCard task={task} key={task.task_id} />)}</div></article> : null}
              {doneDayTasks.length ? <article className="atlas-day-route-group atlas-day-complete-group"><h3>Complete</h3><div className="atlas-day-zone-group">{doneDayTasks.map((task) => <TaskCard task={task} complete key={task.task_id} />)}</div></article> : null}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
