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
import {
  atlasBuildMowingCollectionSummary,
  atlasIsMowingCollectionMember,
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

function metaNumber(task: AtlasTaskCard, ...keys: string[]) {
  for (const key of keys) {
    const value = meta(task, key);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function isChildTask(task: AtlasTaskCard) {
  return meta(task, "is_child_task") === true || meta(task, "is_child_task") === "true";
}

function isWorkTask(task: AtlasTaskCard) {
  const joined = `${task.task_type ?? ""} ${task.title} ${task.unlock_text ?? ""}`.toLowerCase();
  const hidden = task.status === "archived" || task.status === "skipped" || isChildTask(task);
  if (hidden) return false;
  if (atlasIsCropCycleTask(task)) return true;
  return !(joined.includes("verify") || joined.includes("check") || joined.includes("confirm") || joined.includes("count") || joined.includes("germin") || joined.includes("walk field rows"));
}

function isDashboardWork(task: AtlasTaskCard) {
  return (task.status === "open" || task.status === "blocked") && isWorkTask(task);
}

function isDoneTask(task: AtlasTaskCard) {
  return task.status === "done" || text(meta(task, "checklist_status")) === "done" || task.task_outcomes?.[0]?.outcome === "done";
}

function progressPercent(done: number, total: number) {
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function subject(task: AtlasTaskCard) {
  return atlasTaskDisplay(task).title;
}

function location(task: AtlasTaskCard) {
  return atlasTaskDisplay(task).location;
}

function zoneBucket(value: string) {
  const lower = value.toLowerCase();
  if (lower.includes("oak") || lower.includes("strawberry orchard")) return "Shady Oak";
  if (lower.includes("main garden") || lower.includes("straw strip")) return "Main Garden";
  if (lower.includes("field") || lower.includes("fr")) return "Field Rows";
  if (lower.includes("barn")) return "Barn Beds";
  if (lower.includes("berry") || lower.includes("bw")) return "Berry Walk";
  if (lower.includes("u-pick") || lower.includes("u pick")) return "U-Pick";
  if (lower.includes("follow me")) return "Follow Me";
  if (lower.includes("curve")) return "Curve Garden";
  if (lower.includes("lilac")) return "Lilac Haven";
  if (lower.includes("garage") || lower.includes("hydrangea")) return "Garage / House Beds";
  if (lower.includes("grow room")) return "Grow Room";
  if (lower.includes("entry") || lower.includes("billboard")) return "Entry Billboard";
  if (lower.includes("chicken")) return "Chicken Coop";
  return value || "Elm Farm";
}

function collectionZone(task: AtlasTaskCard) {
  return text(meta(task, "collection_zone")) || zoneBucket(location(task));
}

function routeForTask(task: AtlasTaskCard): RouteKey {
  return atlasRouteKeyForTask(task);
}

function detail(task: AtlasTaskCard) {
  return atlasTaskDisplay(task).detail;
}

function taskHref(task: AtlasTaskCard) {
  return `/task?taskId=${encodeURIComponent(task.task_id)}`;
}

function explicitWorkOrder(task: AtlasTaskCard) {
  return metaNumber(task, "day_work_order", "work_order", "day_order_override", "run_sheet_order", "day_order");
}

function workOrderMode(task: AtlasTaskCard) {
  const mode = text(meta(task, "day_work_order_mode")) || text(meta(task, "work_order_mode")) || text(meta(task, "day_flow_mode"));
  const label = `${text(meta(task, "day_work_order_label"))} ${text(meta(task, "work_order_label"))} ${text(meta(task, "work_order_bucket"))}`.toLowerCase();
  if (mode === "extra_credit" || label.includes("extra credit")) return "extra_credit";
  return "required";
}

function isExtraCredit(task: AtlasTaskCard) {
  return workOrderMode(task) === "extra_credit";
}

function fallbackOrder(task: AtlasTaskCard) {
  const routeIndex = routeOrder.indexOf(routeForTask(task));
  return 99900 + (routeIndex < 0 ? 99 : routeIndex);
}

function workOrderSortKey(task: AtlasTaskCard) {
  const primary = explicitWorkOrder(task) ?? fallbackOrder(task);
  return `${String(primary).padStart(5, "0")}-${subject(task)}`;
}

function zoneSortKey(task: AtlasTaskCard) {
  return `${collectionZone(task)}-${workOrderSortKey(task)}`;
}

function routePreview(tasks: AtlasTaskCard[]) {
  return tasks.map(subject).slice(0, 2).join(" · ");
}

function routeCountLine(tasks: AtlasTaskCard[]) {
  return routeOrder
    .map((key) => ({ key, count: tasks.filter((task) => routeForTask(task) === key).length }))
    .filter((item) => item.count > 0)
    .map((item) => `${routeLabels[item.key]} ${item.count}`)
    .join(" · ") || "No open farm tasks planned";
}

function DayProgressBar({ done, total }: { done: number; total: number }) {
  const percent = progressPercent(done, total);
  return (
    <div className="atlas-day-progress-card" aria-label={`${done} of ${total} tasks done`}>
      <div>
        <span>Day progress</span>
        <strong>{total ? `${done} / ${total} done` : "Complete"}</strong>
      </div>
      <div className="atlas-day-progress-bar"><i style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function TaskCard({ task, complete = false }: { task: AtlasTaskCard; complete?: boolean }) {
  const display = atlasTaskDisplay(task);
  return (
    <Link className={`atlas-day-task-card${complete ? " complete" : ""}${atlasIsCropCycleTask(task) ? " atlas-crop-cycle-task-card" : ""}`} href={taskHref(task)}>
      <strong>{display.title}</strong>
      <span>{complete ? "Complete" : display.location}</span>
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

const filterPillStyle = {
  border: "1px solid rgba(139, 145, 194, 0.18)",
  borderRadius: "999px",
  background: "rgba(246, 242, 230, 0.62)",
  padding: "4px",
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  width: "fit-content",
  maxWidth: "100%",
} as const;

const filterLabelStyle = {
  color: "#858bb8",
  padding: "0 6px 0 8px",
  fontSize: "9px",
  lineHeight: 1,
  fontWeight: 950,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
} as const;

function filterButtonStyle(selected: boolean) {
  return {
    border: 0,
    borderRadius: "999px",
    background: selected ? "rgba(167, 171, 214, 0.28)" : "transparent",
    color: selected ? "var(--atlas-text)" : "var(--atlas-muted)",
    padding: "8px 10px",
    fontSize: "12px",
    lineHeight: 1,
    fontWeight: 950,
    whiteSpace: "nowrap",
  } as const;
}

function ViewToggle({ viewMode, onChange }: { viewMode: DayViewMode; onChange: (mode: DayViewMode) => void }) {
  return (
    <div className="atlas-day-filter-pill" style={filterPillStyle} aria-label="Filter day overview">
      <span style={filterLabelStyle}>Filter by</span>
      <button type="button" style={filterButtonStyle(viewMode === "work_order")} className={viewMode === "work_order" ? "selected" : ""} onClick={() => onChange("work_order")}>Work order</button>
      <button type="button" style={filterButtonStyle(viewMode === "zone")} className={viewMode === "zone" ? "selected" : ""} onClick={() => onChange("zone")}>Zone</button>
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

  const allDayTasks = useMemo(() => tasks
    .filter(isWorkTask)
    .filter((task) => task.due_date === dateIso)
    .sort((a, b) => workOrderSortKey(a).localeCompare(workOrderSortKey(b))), [dateIso, tasks]);

  const dayTasks = useMemo(() => tasks
    .filter(isDashboardWork)
    .filter((task) => task.due_date === dateIso)
    .sort((a, b) => workOrderSortKey(a).localeCompare(workOrderSortKey(b))), [dateIso, tasks]);

  const requiredTasks = useMemo(() => dayTasks.filter((task) => !isExtraCredit(task)), [dayTasks]);
  const requiredStandaloneTasks = useMemo(() => requiredTasks.filter((task) => !atlasIsMowingCollectionMember(task)), [requiredTasks]);
  const mowingCollection = useMemo(() => atlasBuildMowingCollectionSummary(tasks, dateIso), [dateIso, tasks]);
  const showMowingCollection = Boolean(mowingCollection && mowingCollection.dueCount > 0);
  const extraCreditTasks = useMemo(() => dayTasks.filter(isExtraCredit), [dayTasks]);
  const doneDayTasks = useMemo(() => allDayTasks.filter(isDoneTask), [allDayTasks]);

  const routes = useMemo(() => routeOrder
    .map((key) => ({ key, tasks: requiredTasks.filter((task) => routeForTask(task) === key) }))
    .filter((route) => route.tasks.length > 0), [requiredTasks]);

  const zoneGroups = useMemo(() => {
    const zones = Array.from(new Set(requiredStandaloneTasks.map(collectionZone))).sort((a, b) => a.localeCompare(b));
    return zones.map((zone) => ({
      zone,
      tasks: requiredStandaloneTasks.filter((task) => collectionZone(task) === zone).sort((a, b) => zoneSortKey(a).localeCompare(zoneSortKey(b))),
    }));
  }, [requiredStandaloneTasks]);

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
              <div className="atlas-day-browse-title-row">
                <span>{dayOnly(dateIso)}</span>
                <strong>{loading ? "Loading" : `${dayTasks.length} open · ${doneDayTasks.length} done`}</strong>
              </div>
              <p>{loading ? "Loading farm work" : routeCountLine(dayTasks)}</p>
              <DayProgressBar done={doneDayTasks.length} total={allDayTasks.length} />
            </div>

            {error ? <div className="atlas-task-page-empty error">{error}</div> : null}

            <article className="atlas-day-route-hero">
              <div className="atlas-day-route-hero-head"><div><span>Day plan</span><strong>{prettyDate(dateIso)}</strong></div><em className="atlas-day-route-count-pill">{loading ? "…" : requiredTasks.length}</em></div>
              {viewMode === "work_order" ? (
                <div className="atlas-day-route-grid">
                  {routes.length ? routes.map((route) => {
                    const firstTask = route.tasks[0];
                    const isMowingRoute = route.key === "mow" && showMowingCollection && mowingCollection;
                    return (
                      <Link key={route.key} className="atlas-day-route-box" href={isMowingRoute ? mowingCollection.href : taskHref(firstTask)}>
                        <strong>{isMowingRoute ? mowingCollection.label : routeLabels[route.key]}</strong>
                        <span>{isMowingRoute ? `${mowingCollection.dueCount} due · ${mowingCollection.doneRecentCount} resting` : `${route.tasks.length} ${route.tasks.length === 1 ? "task" : "tasks"}`}</span>
                        <em>{isMowingRoute ? mowingCollection.preview : routePreview(route.tasks)}</em>
                      </Link>
                    );
                  }) : <div className="atlas-day-route-empty">{loading ? "Loading farm tasks." : "No open farm tasks planned for this day."}</div>}
                </div>
              ) : (
                <div className="atlas-day-route-grid">
                  {showMowingCollection && mowingCollection ? (
                    <Link className="atlas-day-route-box" href={mowingCollection.href}>
                      <strong>{mowingCollection.label}</strong>
                      <span>{mowingCollection.dueCount} due · {mowingCollection.doneRecentCount} resting</span>
                      <em>{mowingCollection.preview}</em>
                    </Link>
                  ) : null}
                  {zoneGroups.length ? zoneGroups.slice(0, showMowingCollection ? 3 : 4).map((group) => {
                    const firstTask = group.tasks[0];
                    return (
                      <Link key={group.zone} className="atlas-day-route-box" href={taskHref(firstTask)}>
                        <strong>{group.zone}</strong>
                        <span>{group.tasks.length} {group.tasks.length === 1 ? "task" : "tasks"}</span>
                        <em>{group.tasks.map(subject).slice(0, 2).join(" · ")}</em>
                      </Link>
                    );
                  }) : !showMowingCollection ? <div className="atlas-day-route-empty">{loading ? "Loading farm tasks." : "No open farm tasks planned for this day."}</div> : null}
                </div>
              )}
            </article>

            <ViewToggle viewMode={viewMode} onChange={setViewMode} />

            <div className="atlas-day-task-groups">
              {viewMode === "work_order" ? (
                <article className="atlas-day-route-group atlas-day-work-order-group" id="atlas-day-work-order">
                  <h3>Work Order</h3>
                  <div className="atlas-day-work-order-list">
                    {showMowingCollection && mowingCollection ? <WorkCollectionCard collection={mowingCollection} /> : null}
                    {requiredStandaloneTasks.length ? requiredStandaloneTasks.map((task) => <TaskCard task={task} key={task.task_id} />) : !showMowingCollection ? <div className="atlas-day-route-empty">{loading ? "Loading farm tasks." : "No open farm tasks planned for this day."}</div> : null}
                  </div>
                </article>
              ) : (
                <>
                  {showMowingCollection && mowingCollection ? (
                    <article className="atlas-day-route-group atlas-day-work-collection-group" id="atlas-day-collection-mowing">
                      <h3>{mowingCollection.label}</h3>
                      <div className="atlas-day-zone-group"><WorkCollectionCard collection={mowingCollection} /></div>
                    </article>
                  ) : null}
                  {zoneGroups.length ? zoneGroups.map((group) => (
                    <article className="atlas-day-route-group" id={`atlas-day-zone-${group.zone.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} key={group.zone}>
                      <h3>{group.zone}</h3>
                      <div className="atlas-day-zone-group">
                        {group.tasks.map((task) => <TaskCard task={task} key={task.task_id} />)}
                      </div>
                    </article>
                  )) : !showMowingCollection ? <article className="atlas-day-route-group"><div className="atlas-day-route-empty">{loading ? "Loading farm tasks." : "No open farm tasks planned for this day."}</div></article> : null}
                </>
              )}

              {extraCreditTasks.length ? (
                <article className="atlas-day-route-group atlas-day-extra-credit-group" id="atlas-day-extra-credit">
                  <h3>Extra Credit</h3>
                  <div className="atlas-day-zone-group">
                    {extraCreditTasks.map((task) => <TaskCard task={task} key={task.task_id} />)}
                  </div>
                </article>
              ) : null}

              {doneDayTasks.length ? (
                <article className="atlas-day-route-group atlas-day-complete-group" id="atlas-day-complete">
                  <h3>Complete</h3>
                  <div className="atlas-day-zone-group">
                    <h4>{doneDayTasks.length} finished</h4>
                    {doneDayTasks.map((task) => <TaskCard task={task} complete key={task.task_id} />)}
                  </div>
                </article>
              ) : null}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
