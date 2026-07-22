"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  atlasOperationalAreaSort,
  atlasTaskOperationalArea,
  atlasTaskWorkCategoryLabel,
  atlasTasksHaveRooms,
} from "@/lib/atlas/operational-areas";
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
  atlasBuildGerminationCollectionSummary,
  atlasBuildMowingCollectionSummary,
  atlasBuildWeedingCollectionSummary,
  atlasIsGerminationCollectionMember,
  atlasIsMowingCollectionMember,
  atlasIsWeedingCollectionMember,
  type AtlasWorkCollectionSummary,
} from "@/lib/atlas/work-collections";

type RouteKey = AtlasWorkRouteKey;
type DayViewMode = "work_order" | "zone";
type TaskCardContext = "work_order" | "area";
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
  const joined = [task.task_type, task.title, text(meta(task, "work_route")), text(meta(task, "work_rhythm")), text(meta(task, "display_action")), text(meta(task, "collection_label"))].filter(Boolean).join(" ").toLowerCase();
  return joined.includes("kid chore") || joined.includes("kid_chore") || joined.includes("feed chickens");
}

function isOwnerOnlyTask(task: AtlasTaskCard) {
  const ownerTask = meta(task, "owner_task");
  const assignedTo = text(meta(task, "assigned_to")).toLowerCase();
  return ownerTask === true || ownerTask === "true" || assignedTo === "owner";
}

function taskHref(task: AtlasTaskCard, returnTo?: string) {
  const suffix = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
  return `/task-focus/${encodeURIComponent(task.task_id)}${suffix}`;
}

function routeHref(dateIso: string, key: RouteKey) {
  return `/day?date=${encodeURIComponent(dateIso)}&route=${encodeURIComponent(key)}`;
}

function isExtraCredit(task: AtlasTaskCard) {
  const mode = text(meta(task, "day_work_order_mode")) || text(meta(task, "work_order_mode"));
  const label = `${text(meta(task, "day_work_order_label"))} ${text(meta(task, "work_order_label"))}`.toLowerCase();
  return mode === "extra_credit" || label.includes("extra credit");
}

function TaskCard({
  task,
  complete = false,
  overdue = false,
  returnTo,
  context = "work_order",
}: {
  task: AtlasTaskCard;
  complete?: boolean;
  overdue?: boolean;
  returnTo?: string;
  context?: TaskCardContext;
}) {
  const display = atlasTaskDisplay(task);
  const area = atlasTaskOperationalArea(task);
  const category = atlasTaskWorkCategoryLabel(task);
  const statusLine = context === "area" ? category : `${atlasWorkOrderLabel(task)} · ${area}`;

  return (
    <Link className={`atlas-day-task-card${complete ? " complete" : ""}${overdue ? " atlas-day-overdue-task-card" : ""}${atlasIsCropCycleTask(task) ? " atlas-crop-cycle-task-card" : ""}`} href={taskHref(task, returnTo)}>
      {overdue ? <b className="atlas-day-overdue-badge">Overdue</b> : null}
      <strong>{display.title}</strong>
      <span>{overdue ? `Due ${prettyDate(task.due_date ?? "")}` : complete ? "Complete" : statusLine}</span>
      <em>{display.detail}</em>
    </Link>
  );
}

function WorkCollectionCard({ collection }: { collection: AtlasWorkCollectionSummary }) {
  const status = collection.key === "germination"
    ? `${collection.dueCount} need a look · ${collection.openCount} active`
    : `${collection.dueCount} due · ${collection.doneRecentCount} resting · ${collection.notReadyCount} not ready`;
  return (
    <Link className="atlas-day-task-card atlas-work-collection-day-card" href={collection.href}>
      <strong>{collection.label}</strong>
      <span>{status}</span>
      <em>{collection.preview}</em>
    </Link>
  );
}

function AreaTaskGroup({ area, tasks, returnTo }: { area: string; tasks: AtlasTaskCard[]; returnTo: string }) {
  const categories = Array.from(
    tasks.reduce((groups, task) => {
      const category = atlasTaskWorkCategoryLabel(task);
      const current = groups.get(category) ?? [];
      current.push(task);
      groups.set(category, current);
      return groups;
    }, new Map<string, AtlasTaskCard[]>()),
  ).sort(([a], [b]) => a.localeCompare(b));

  return (
    <article className="atlas-day-route-group atlas-day-area-group" data-operational-area={area}>
      <div className="atlas-day-area-head"><h3>{area}</h3><b>{tasks.length}</b></div>
      {categories.map(([category, categoryTasks]) => (
        <section className="atlas-day-area-category" key={category}>
          <div className="atlas-day-area-category-head"><span>{category}</span><em>{categoryTasks.length}</em></div>
          <div className="atlas-day-zone-group">
            {categoryTasks.map((task) => <TaskCard task={task} context="area" key={task.task_id} returnTo={returnTo} />)}
          </div>
        </section>
      ))}
    </article>
  );
}

function ViewToggle({ viewMode, onChange }: { viewMode: DayViewMode; onChange: (mode: DayViewMode) => void }) {
  return (
    <div className="atlas-day-filter-pill" aria-label="Filter day overview">
      <span>Filter by</span>
      <button type="button" className={viewMode === "work_order" ? "selected" : ""} onClick={() => onChange("work_order")}>Work order</button>
      <button type="button" className={viewMode === "zone" ? "selected" : ""} onClick={() => onChange("zone")}>Area</button>
    </div>
  );
}

export default function AtlasDayPage() {
  const [dateIso, setDateIso] = useState(todayIso());
  const [routeFilter, setRouteFilter] = useState<RouteKey | null>(null);
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [viewMode, setViewMode] = useState<DayViewMode>("work_order");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDateIso(params.get("date") || todayIso());
    const requestedRoute = params.get("route");
    const requestedView = params.get("view");
    setRouteFilter(requestedRoute && routeOrder.includes(requestedRoute as RouteKey) ? requestedRoute as RouteKey : null);

    async function load() {
      try {
        setLoading(true);
        const response = await fetchAtlasTaskCards();
        const taskCards = response.taskCards ?? [];
        setTasks(taskCards);
        if (requestedView === "area") setViewMode("zone");
        else if (requestedView === "work_order") setViewMode("work_order");
        else if (atlasTasksHaveRooms(taskCards)) setViewMode("zone");
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
    return tasks.filter(isDashboardWork).filter((task) => Boolean(task.due_date && task.due_date < dateIso)).filter((task) => !isKidChore(task) && !isOwnerOnlyTask(task) && !isExtraCredit(task)).filter((task) => !atlasIsMowingCollectionMember(task) && !atlasIsWeedingCollectionMember(task) && !atlasIsGerminationCollectionMember(task)).sort((a, b) => `${a.due_date ?? ""}-${atlasWorkOrderSortValue(a)}`.localeCompare(`${b.due_date ?? ""}-${atlasWorkOrderSortValue(b)}`));
  }, [dateIso, tasks]);
  const requiredTasks = useMemo(() => dayTasks.filter((task) => !isExtraCredit(task)), [dayTasks]);
  const standaloneTasks = useMemo(() => requiredTasks.filter((task) => !atlasIsMowingCollectionMember(task) && !atlasIsWeedingCollectionMember(task) && !atlasIsGerminationCollectionMember(task)), [requiredTasks]);
  const extraCreditTasks = useMemo(() => dayTasks.filter(isExtraCredit), [dayTasks]);
  const doneDayTasks = useMemo(() => allDayTasks.filter(isDoneTask).filter((task) => !atlasIsGerminationCollectionMember(task)), [allDayTasks]);
  const filteredTasks = useMemo(() => routeFilter ? standaloneTasks.filter((task) => atlasRouteKeyForTask(task) === routeFilter) : standaloneTasks, [routeFilter, standaloneTasks]);

  const mowingCollection = useMemo(() => atlasBuildMowingCollectionSummary(tasks, dateIso), [dateIso, tasks]);
  const weedingCollection = useMemo(() => atlasBuildWeedingCollectionSummary(tasks, dateIso), [dateIso, tasks]);
  const germinationCollection = useMemo(() => atlasBuildGerminationCollectionSummary(tasks, dateIso), [dateIso, tasks]);
  const showWeedingCollection = Boolean(weedingCollection && weedingCollection.dueCount > 0);
  const showGerminationCollection = Boolean(germinationCollection && germinationCollection.dueCount > 0);
  const showMowingCollection = Boolean(mowingCollection && mowingCollection.dueCount > 0);
  const collectionCount = Number(showWeedingCollection) + Number(showGerminationCollection) + Number(showMowingCollection);

  const routeCards = useMemo(() => {
    const regularEntries = routeOrder.map((key) => {
      const collection = key === "weed" ? weedingCollection : key === "mow" ? mowingCollection : null;
      const routeTasks = standaloneTasks.filter((task) => atlasRouteKeyForTask(task) === key);
      return { key, collection: collection && collection.dueCount > 0 ? collection : null, tasks: routeTasks };
    }).filter((entry) => entry.collection || entry.tasks.length);
    const germinationEntry = germinationCollection && germinationCollection.dueCount > 0
      ? [{ key: "germination" as const, collection: germinationCollection, tasks: [] as AtlasTaskCard[] }]
      : [];
    return [...regularEntries, ...germinationEntry].sort((a, b) => {
      if (a.key === "weed") return -1;
      if (b.key === "weed") return 1;
      if (a.key === "germination") return -1;
      if (b.key === "germination") return 1;
      if (a.key === "mow") return 1;
      if (b.key === "mow") return -1;
      return routeOrder.indexOf(a.key as RouteKey) - routeOrder.indexOf(b.key as RouteKey);
    });
  }, [germinationCollection, mowingCollection, standaloneTasks, weedingCollection]);

  const areas = useMemo(() => Array.from(new Set(filteredTasks.map(atlasTaskOperationalArea))).sort(atlasOperationalAreaSort), [filteredTasks]);
  const returnTo = routeFilter ? routeHref(dateIso, routeFilter) : `/day?date=${encodeURIComponent(dateIso)}`;

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
              <Link href={routeFilter ? `/day?date=${encodeURIComponent(dateIso)}` : "/"} className="atlas-route-back atlas-day-back">{routeFilter ? "← Day plan" : "← Week"}</Link>
              <div className="atlas-day-browse-title-row"><span>{routeFilter ? routeLabels[routeFilter] : dayOnly(dateIso)}</span><strong>{loading ? "Loading" : `${dayTasks.length} open · ${overdueTasks.length} overdue · ${doneDayTasks.length} done`}</strong></div>
              <p>{loading ? "Loading farm work" : routeFilter ? `${filteredTasks.length} ${filteredTasks.length === 1 ? "task" : "tasks"} in this collection` : `${standaloneTasks.length} regular tasks · ${collectionCount} work collections`}</p>
            </div>

            {error ? <div className="atlas-task-page-empty error">{error}</div> : null}

            {!routeFilter ? (
              <article className="atlas-day-route-hero">
                <div className="atlas-day-route-hero-head"><div><span>Day plan</span><strong>{prettyDate(dateIso)}</strong></div><em className="atlas-day-route-count-pill">{loading ? "…" : standaloneTasks.length + collectionCount + overdueTasks.length}</em></div>
                <div className="atlas-day-route-grid">
                  {routeCards.length ? routeCards.map((entry) => {
                    if (entry.collection) return <Link key={entry.key} className="atlas-day-route-box" href={entry.collection.href}><strong>{entry.collection.label}</strong><span>{entry.collection.dueCount} due</span><em>{entry.collection.preview}</em></Link>;
                    return <Link key={entry.key} className="atlas-day-route-box" href={routeHref(dateIso, entry.key as RouteKey)}><strong>{routeLabels[entry.key as RouteKey]}</strong><span>{entry.tasks.length} {entry.tasks.length === 1 ? "task" : "tasks"}</span><em>{entry.tasks.slice(0, 2).map((task) => atlasTaskDisplay(task).title).join(" · ")}</em></Link>;
                  }) : <div className="atlas-day-route-empty">{loading ? "Loading farm tasks." : "No open farm tasks planned for this day."}</div>}
                </div>
              </article>
            ) : null}

            {!routeFilter && overdueTasks.length ? (
              <article className="atlas-day-route-group atlas-day-overdue-group" aria-label="Overdue carry-forward work">
                <div className="atlas-day-overdue-group-head"><div><span>Carry forward</span><h3>Overdue</h3></div><b>{overdueTasks.length}</b></div>
                <p>These unfinished tasks remain ahead of today’s regular work.</p>
                <div className="atlas-day-work-order-list">{overdueTasks.map((task) => <TaskCard task={task} overdue key={task.task_id} returnTo={returnTo} />)}</div>
              </article>
            ) : null}

            {!routeFilter ? <ViewToggle viewMode={viewMode} onChange={setViewMode} /> : null}

            <div className="atlas-day-task-groups">
              {routeFilter ? (
                <article className="atlas-day-route-group atlas-day-work-order-group">
                  <h3>{routeLabels[routeFilter]}</h3>
                  <div className="atlas-day-work-order-list">
                    {filteredTasks.map((task) => <TaskCard task={task} key={task.task_id} returnTo={returnTo} />)}
                    {!filteredTasks.length ? <div className="atlas-day-route-empty">No open tasks in this collection.</div> : null}
                  </div>
                </article>
              ) : viewMode === "work_order" ? (
                <article className="atlas-day-route-group atlas-day-work-order-group">
                  <h3>Work Order</h3>
                  <div className="atlas-day-work-order-list">
                    {showWeedingCollection && weedingCollection ? <WorkCollectionCard collection={weedingCollection} /> : null}
                    {showGerminationCollection && germinationCollection ? <WorkCollectionCard collection={germinationCollection} /> : null}
                    {standaloneTasks.map((task) => <TaskCard task={task} key={task.task_id} returnTo={returnTo} />)}
                    {showMowingCollection && mowingCollection ? <WorkCollectionCard collection={mowingCollection} /> : null}
                    {!collectionCount && !standaloneTasks.length ? <div className="atlas-day-route-empty">No open farm tasks planned for this day.</div> : null}
                  </div>
                </article>
              ) : (
                <>
                  {showWeedingCollection && weedingCollection ? <article className="atlas-day-route-group atlas-day-work-collection-group"><h3>{weedingCollection.label}</h3><div className="atlas-day-zone-group"><WorkCollectionCard collection={weedingCollection} /></div></article> : null}
                  {showGerminationCollection && germinationCollection ? <article className="atlas-day-route-group atlas-day-work-collection-group"><h3>{germinationCollection.label}</h3><div className="atlas-day-zone-group"><WorkCollectionCard collection={germinationCollection} /></div></article> : null}
                  {areas.map((area) => <AreaTaskGroup area={area} tasks={filteredTasks.filter((task) => atlasTaskOperationalArea(task) === area)} key={area} returnTo={returnTo} />)}
                  {showMowingCollection && mowingCollection ? <article className="atlas-day-route-group atlas-day-work-collection-group"><h3>{mowingCollection.label}</h3><div className="atlas-day-zone-group"><WorkCollectionCard collection={mowingCollection} /></div></article> : null}
                </>
              )}

              {!routeFilter && extraCreditTasks.length ? <article className="atlas-day-route-group atlas-day-extra-credit-group"><h3>Extra Credit</h3><div className="atlas-day-zone-group">{extraCreditTasks.map((task) => <TaskCard task={task} key={task.task_id} returnTo={returnTo} />)}</div></article> : null}
              {!routeFilter && doneDayTasks.length ? <article className="atlas-day-route-group atlas-day-complete-group"><h3>Complete</h3><div className="atlas-day-zone-group">{doneDayTasks.map((task) => <TaskCard task={task} complete key={task.task_id} returnTo={returnTo} />)}</div></article> : null}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
