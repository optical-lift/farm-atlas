"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import DayTrailSummary from "@/components/atlas/day-trail-summary";
import {
  atlasDayCurrentTask,
  atlasDayIsCarePulse,
  atlasDayRouteState,
  atlasDayTaskCues,
  atlasDayTaskFamily,
  type AtlasDayRouteState,
} from "@/lib/atlas/day-route";
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
  atlasBuildWeedingCollectionSummary,
  atlasIsGerminationCollectionMember,
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

function shiftIsoDate(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function dayHref(dateIso: string) {
  return `/day?date=${encodeURIComponent(dateIso)}&view=work_order`;
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

function isOwnerOnlyTask(task: AtlasTaskCard) {
  const ownerTask = meta(task, "owner_task");
  const assignedTo = text(meta(task, "assigned_to")).toLowerCase();
  return ownerTask === true || ownerTask === "true" || assignedTo === "owner";
}

function collectionZone(task: AtlasTaskCard) {
  return text(task.zone_label) || text(meta(task, "collection_zone")) || atlasTaskDisplay(task).location || "Elm Farm";
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
  routeState,
}: {
  task: AtlasTaskCard;
  complete?: boolean;
  overdue?: boolean;
  returnTo?: string;
  routeState?: AtlasDayRouteState;
}) {
  const display = atlasTaskDisplay(task);
  const zone = collectionZone(task);
  const isGrowRoomCare = task.title === "Grow Room Care" && task.task_type === "grow_room_care";
  const statusLine = isGrowRoomCare ? zone : `${atlasWorkOrderLabel(task)} · ${zone}`;
  const family = atlasDayTaskFamily(task);
  const cues = atlasDayTaskCues(task);
  const routeClass = routeState ? ` atlas-day-route-${routeState}` : "";

  return (
    <Link
      className={`atlas-day-task-card${complete ? " complete" : ""}${overdue ? " atlas-day-overdue-task-card" : ""}${atlasIsCropCycleTask(task) ? " atlas-crop-cycle-task-card" : ""}${routeClass}`}
      href={taskHref(task, returnTo)}
      aria-current={routeState === "current" ? "step" : undefined}
    >
      {overdue ? <b className="atlas-day-overdue-badge">Overdue</b> : null}
      {!complete && !overdue ? <small className="atlas-day-task-family">{routeState === "current" ? `Current · ${family}` : family}</small> : null}
      <strong>{display.title}</strong>
      <span>{overdue ? `Due ${prettyDate(task.due_date ?? "")}` : complete ? "Complete" : statusLine}</span>
      {display.detail ? <em>{display.detail}</em> : null}
      {!complete && !overdue && cues.length ? <span className="atlas-day-task-cues">{cues.map((cue) => <i key={cue}>{cue}</i>)}</span> : null}
    </Link>
  );
}

function WorkCollectionCard({ collection, route = false }: { collection: AtlasWorkCollectionSummary; route?: boolean }) {
  const status = collection.key === "germination"
    ? `${collection.dueCount} need a look · ${collection.openCount} active`
    : `${collection.dueCount} due · ${collection.doneRecentCount} resting · ${collection.notReadyCount} not ready`;
  return (
    <Link className={`atlas-day-task-card atlas-work-collection-day-card${route ? " atlas-day-route-collection" : ""}`} href={collection.href}>
      {route ? <small className="atlas-day-task-family">Collection</small> : null}
      <strong>{collection.label}</strong>
      <span>{status}</span>
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

function AtlasDayPageContent() {
  const searchParams = useSearchParams();
  const dateIso = searchParams.get("date") || todayIso();
  const requestedRoute = searchParams.get("route");
  const requestedView = searchParams.get("view");
  const routeFilter = requestedRoute && routeOrder.includes(requestedRoute as RouteKey) ? requestedRoute as RouteKey : null;
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");
  const [viewMode, setViewMode] = useState<DayViewMode>("work_order");
  const requestSequence = useRef(0);

  useEffect(() => {
    if (requestedView === "zone" || requestedView === "area") setViewMode("zone");
    else setViewMode("work_order");
  }, [requestedView, dateIso]);

  useEffect(() => {
    const requestId = ++requestSequence.current;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        setTasks([]);
        const response = await fetchAtlasTaskCards({
          viewerScoped: true,
          dueThrough: dateIso,
          doneDate: dateIso,
        });
        if (requestId !== requestSequence.current) return;

        const taskCards = response.taskCards ?? [];
        setTasks(taskCards);
      } catch (loadError) {
        if (requestId === requestSequence.current) {
          setError(loadError instanceof Error ? loadError.message : "Tasks failed.");
        }
      } finally {
        if (requestId === requestSequence.current) setLoading(false);
      }
    }

    void load();
  }, [dateIso]);

  useEffect(() => {
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
  }, []);

  const allDayTasks = useMemo(() => tasks.filter(isWorkTask).filter((task) => task.due_date === dateIso), [dateIso, tasks]);
  const dayTasks = useMemo(() => tasks.filter(isDashboardWork).filter((task) => task.due_date === dateIso).sort((a, b) => atlasWorkOrderSortValue(a).localeCompare(atlasWorkOrderSortValue(b))), [dateIso, tasks]);
  const overdueTasks = useMemo(() => {
    if (dateIso !== todayIso()) return [];
    return tasks.filter(isDashboardWork).filter((task) => Boolean(task.due_date && task.due_date < dateIso)).filter((task) => !isOwnerOnlyTask(task) && !isExtraCredit(task)).filter((task) => !atlasIsMowingCollectionMember(task) && !atlasIsWeedingCollectionMember(task) && !atlasIsGerminationCollectionMember(task)).sort((a, b) => `${a.due_date ?? ""}-${atlasWorkOrderSortValue(a)}`.localeCompare(`${b.due_date ?? ""}-${atlasWorkOrderSortValue(b)}`));
  }, [dateIso, tasks]);
  const progressTasks = useMemo(() => allDayTasks.filter((task) => !isExtraCredit(task)), [allDayTasks]);
  const requiredTasks = useMemo(() => dayTasks.filter((task) => !isExtraCredit(task)), [dayTasks]);
  const standaloneTasks = useMemo(() => requiredTasks.filter((task) => !atlasIsMowingCollectionMember(task) && !atlasIsWeedingCollectionMember(task) && !atlasIsGerminationCollectionMember(task)), [requiredTasks]);
  const extraCreditTasks = useMemo(() => dayTasks.filter(isExtraCredit), [dayTasks]);
  const doneDayTasks = useMemo(() => allDayTasks.filter(isDoneTask).filter((task) => !atlasIsGerminationCollectionMember(task)), [allDayTasks]);
  const finishedProgressTasks = useMemo(() => progressTasks.filter(isDoneTask), [progressTasks]);
  const blockedProgressTasks = useMemo(() => progressTasks.filter((task) => task.status === "blocked" && !isDoneTask(task)), [progressTasks]);
  const doneStandaloneTasks = useMemo(() => doneDayTasks.filter((task) => !atlasIsMowingCollectionMember(task) && !atlasIsWeedingCollectionMember(task)), [doneDayTasks]);
  const filteredTasks = useMemo(() => routeFilter ? standaloneTasks.filter((task) => atlasRouteKeyForTask(task) === routeFilter) : standaloneTasks, [routeFilter, standaloneTasks]);
  const currentTask = useMemo(() => atlasDayCurrentTask(standaloneTasks) ?? atlasDayCurrentTask(requiredTasks), [requiredTasks, standaloneTasks]);
  const careTasks = useMemo(() => requiredTasks.filter(atlasDayIsCarePulse).filter((task) => task.task_id !== currentTask?.task_id).slice(0, 3), [currentTask, requiredTasks]);
  const openRequiredCount = useMemo(() => requiredTasks.filter((task) => task.status === "open").length, [requiredTasks]);

  const weedingCollection = useMemo(() => atlasBuildWeedingCollectionSummary(tasks, dateIso), [dateIso, tasks]);
  const germinationCollection = useMemo(() => atlasBuildGerminationCollectionSummary(tasks, dateIso), [dateIso, tasks]);
  const showWeedingCollection = Boolean(weedingCollection && weedingCollection.dueCount > 0);
  const showGerminationCollection = Boolean(germinationCollection && germinationCollection.dueCount > 0);
  const collectionCount = Number(showWeedingCollection) + Number(showGerminationCollection);

  const routeCards = useMemo(() => {
    const regularEntries = routeOrder.map((key) => {
      const collection = key === "weed" ? weedingCollection : null;
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
  }, [germinationCollection, standaloneTasks, weedingCollection]);

  const zones = useMemo(() => Array.from(new Set(filteredTasks.map(collectionZone))).sort((a, b) => a.localeCompare(b)), [filteredTasks]);
  const returnTo = routeFilter ? routeHref(dateIso, routeFilter) : dayHref(dateIso);
  const previousDate = shiftIsoDate(dateIso, -1);
  const nextDate = shiftIsoDate(dateIso, 1);

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
              <Link href={routeFilter ? dayHref(dateIso) : "/"} className="atlas-route-back atlas-day-back">{routeFilter ? "← Day plan" : "← Week"}</Link>
              <div className="atlas-day-browse-title-row"><span>{routeFilter ? routeLabels[routeFilter] : dayOnly(dateIso)}</span><strong>{loading ? "Loading" : `${dayTasks.length} open · ${overdueTasks.length} overdue · ${doneDayTasks.length} done`}</strong></div>
              <p>{loading ? "Loading farm work" : routeFilter ? `${filteredTasks.length} ${filteredTasks.length === 1 ? "task" : "tasks"} in this collection` : `${standaloneTasks.length} regular tasks · ${collectionCount} work collections`}</p>
            </div>

            {error ? <div className="atlas-task-page-empty error">{error}</div> : null}

            {!routeFilter ? (
              <article className="atlas-day-command-header">
                <div className="atlas-day-command-topline">
                  <strong>{prettyDate(dateIso)}</strong>
                  <span>{loading ? "Loading" : `${openRequiredCount} open${blockedProgressTasks.length ? ` · ${blockedProgressTasks.length} blocked` : ""}`}</span>
                </div>
                <DayTrailSummary compact loading={loading} completed={finishedProgressTasks.length} total={progressTasks.length} blocked={blockedProgressTasks.length} />
                {currentTask ? (
                  <Link className="atlas-day-current-move" href={taskHref(currentTask, returnTo)}>
                    <span>Next</span>
                    <strong>{atlasTaskDisplay(currentTask).title}</strong>
                    <em>{collectionZone(currentTask)}</em>
                  </Link>
                ) : !loading ? <div className="atlas-day-current-move empty"><span>Next</span><strong>The day is clear</strong></div> : null}
                {careTasks.length ? (
                  <div className="atlas-day-care-lane">
                    <span>Care today</span>
                    <p>{careTasks.map((task) => atlasTaskDisplay(task).title).join(" · ")}</p>
                  </div>
                ) : null}
              </article>
            ) : null}

            {!routeFilter ? (
              <details className="atlas-day-overview-drawer">
                <summary>
                  <div><strong>Day overview</strong><span>{routeCards.length} {routeCards.length === 1 ? "group" : "groups"}</span></div>
                  <div className="atlas-day-overview-pills">
                    {routeCards.slice(0, 4).map((entry) => <span key={entry.key}>{entry.key === "germination" ? "Check" : routeLabels[entry.key as RouteKey]} {entry.collection?.dueCount ?? entry.tasks.length}</span>)}
                  </div>
                  <b aria-hidden="true">⌄</b>
                </summary>
                <div className="atlas-day-route-grid">
                  {routeCards.length ? routeCards.map((entry) => {
                    if (entry.collection) return <Link key={entry.key} className="atlas-day-route-box" href={entry.collection.href}><strong>{entry.collection.label}</strong><span>{entry.collection.dueCount} due</span><em>{entry.collection.preview}</em></Link>;
                    return <Link key={entry.key} className="atlas-day-route-box" href={routeHref(dateIso, entry.key as RouteKey)}><strong>{routeLabels[entry.key as RouteKey]}</strong><span>{entry.tasks.length} {entry.tasks.length === 1 ? "task" : "tasks"}</span><em>{entry.tasks.slice(0, 2).map((task) => atlasTaskDisplay(task).title).join(" · ")}</em></Link>;
                  }) : <div className="atlas-day-route-empty">{loading ? "Loading farm tasks." : "No open farm tasks planned for this day."}</div>}
                </div>
              </details>
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
                  <div className="atlas-day-work-order-list atlas-day-route-spine">
                    {filteredTasks.map((task) => <TaskCard task={task} routeState={atlasDayRouteState(task, currentTask?.task_id ?? null)} key={task.task_id} returnTo={returnTo} />)}
                    {!loading && !filteredTasks.length ? <div className="atlas-day-route-empty">No open tasks in this collection.</div> : null}
                  </div>
                </article>
              ) : viewMode === "work_order" ? (
                <article className="atlas-day-route-group atlas-day-work-order-group">
                  <h3>Work Order</h3>
                  <div className="atlas-day-work-order-list atlas-day-route-spine">
                    {showWeedingCollection && weedingCollection ? <WorkCollectionCard collection={weedingCollection} route /> : null}
                    {showGerminationCollection && germinationCollection ? <WorkCollectionCard collection={germinationCollection} route /> : null}
                    {standaloneTasks.map((task) => <TaskCard task={task} routeState={atlasDayRouteState(task, currentTask?.task_id ?? null)} key={task.task_id} returnTo={returnTo} />)}
                    {!loading && !collectionCount && !standaloneTasks.length ? <div className="atlas-day-route-empty">No open farm tasks planned for this day.</div> : null}
                  </div>
                </article>
              ) : (
                <>
                  {showWeedingCollection && weedingCollection ? <article className="atlas-day-route-group atlas-day-work-collection-group"><h3>{weedingCollection.label}</h3><div className="atlas-day-zone-group"><WorkCollectionCard collection={weedingCollection} /></div></article> : null}
                  {showGerminationCollection && germinationCollection ? <article className="atlas-day-route-group atlas-day-work-collection-group"><h3>{germinationCollection.label}</h3><div className="atlas-day-zone-group"><WorkCollectionCard collection={germinationCollection} /></div></article> : null}
                  {zones.map((zone) => <article className="atlas-day-route-group" key={zone}><h3>{zone}</h3><div className="atlas-day-zone-group">{filteredTasks.filter((task) => collectionZone(task) === zone).map((task) => <TaskCard task={task} key={task.task_id} returnTo={returnTo} />)}</div></article>)}
                </>
              )}

              {!routeFilter && extraCreditTasks.length ? <article className="atlas-day-route-group atlas-day-extra-credit-group"><h3>Extra Credit</h3><div className="atlas-day-zone-group">{extraCreditTasks.map((task) => <TaskCard task={task} key={task.task_id} returnTo={returnTo} />)}</div></article> : null}
              {!routeFilter && doneStandaloneTasks.length ? <article className="atlas-day-route-group atlas-day-complete-group"><h3>Complete</h3><div className="atlas-day-zone-group">{doneStandaloneTasks.map((task) => <TaskCard task={task} complete key={task.task_id} returnTo={returnTo} />)}</div></article> : null}
            </div>

            {!routeFilter ? (
              <nav className="atlas-day-adjacent-nav" aria-label="Browse adjacent days">
                <Link href={dayHref(previousDate)} aria-label="Open yesterday"><span aria-hidden="true">←</span><em>Yesterday</em></Link>
                <Link href={dayHref(nextDate)} aria-label="Open tomorrow"><em>Tomorrow</em><span aria-hidden="true">→</span></Link>
              </nav>
            ) : null}
          </section>
        </div>
      </section>
    </main>
  );
}

function DayPageFallback() {
  return (
    <main className="atlas-phone-shell atlas-home-shell atlas-task-page-shell">
      <section className="atlas-phone atlas-dashboard-phone atlas-task-page-phone">
        <div className="atlas-task-page-body">
          <section className="atlas-task-page-section atlas-route-collection atlas-day-browse">
            <div className="atlas-day-route-empty">Loading farm tasks.</div>
          </section>
        </div>
      </section>
    </main>
  );
}

export default function AtlasDayPage() {
  return (
    <Suspense fallback={<DayPageFallback />}>
      <AtlasDayPageContent />
    </Suspense>
  );
}
