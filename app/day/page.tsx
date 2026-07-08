"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type RouteKey = "plant" | "weed" | "mow" | "seed" | "harvest" | "build" | "venue" | "water";
type WeatherResponse = { ok: boolean; label?: string };

const routeLabels: Record<RouteKey, string> = {
  plant: "Plant",
  weed: "Weed",
  mow: "Mow",
  seed: "Seed",
  harvest: "Harvest",
  build: "Build / Prep",
  venue: "Venue",
  water: "Water",
};

const routeOrder: RouteKey[] = ["weed", "plant", "mow", "seed", "harvest", "build", "venue", "water"];

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

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function meta(task: AtlasTaskCard, key: string) {
  return task.metadata?.[key];
}

function isRouteKey(value: string): value is RouteKey {
  return routeOrder.includes(value as RouteKey);
}

function isChildTask(task: AtlasTaskCard) {
  return meta(task, "is_child_task") === true || meta(task, "is_child_task") === "true";
}

function isWorkTask(task: AtlasTaskCard) {
  const joined = `${task.task_type ?? ""} ${task.title} ${task.unlock_text ?? ""}`.toLowerCase();
  return task.status !== "archived" && task.status !== "skipped" && !isChildTask(task) && !(joined.includes("verify") || joined.includes("check") || joined.includes("confirm") || joined.includes("count") || joined.includes("germin") || joined.includes("walk field rows"));
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
  return text(meta(task, "collection_label")) || text(meta(task, "display_subject")) || task.title.split("—").slice(1).join("—").trim() || task.title;
}

function location(task: AtlasTaskCard) {
  return text(meta(task, "display_detail")) || task.unlock_text || task.zone_label || "Elm Farm";
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
  const explicit = text(meta(task, "work_route"));
  if (isRouteKey(explicit)) return explicit;
  const joined = `${task.task_type ?? ""} ${task.title} ${text(meta(task, "work_rhythm"))} ${text(meta(task, "display_action"))}`.toLowerCase();
  if (joined.includes("water")) return "water";
  if (joined.includes("mow")) return "mow";
  if (joined.includes("weed")) return "weed";
  if (joined.includes("seed") || joined.includes("sow")) return "seed";
  if (joined.includes("harvest") || joined.includes("postharvest") || joined.includes("garlic") || joined.includes("gather")) return "harvest";
  if (joined.includes("build") || joined.includes("prep") || joined.includes("string") || joined.includes("arch")) return "build";
  if (joined.includes("plant") || joined.includes("transplant")) return "plant";
  return "venue";
}

function detail(task: AtlasTaskCard) {
  return stringList(meta(task, "detail_lines"))[0] || location(task);
}

function taskSortKey(task: AtlasTaskCard) {
  const dayOrder = typeof meta(task, "day_order") === "number" ? meta(task, "day_order") : 999;
  return `${String(dayOrder).padStart(3, "0")}-${subject(task)}`;
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
  return (
    <Link className={`atlas-day-task-card${complete ? " complete" : ""}`} href={`/task?taskId=${encodeURIComponent(task.task_id)}`}>
      <strong>{subject(task)}</strong>
      <span>{complete ? "Complete" : location(task)}</span>
      <em>{detail(task)}</em>
    </Link>
  );
}

export default function AtlasDayPage() {
  const [dateIso, setDateIso] = useState(todayIso());
  const [tasks, setTasks] = useState<AtlasTaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weatherLabel, setWeatherLabel] = useState("live weather loading…");

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
    .sort((a, b) => taskSortKey(a).localeCompare(taskSortKey(b))), [dateIso, tasks]);

  const dayTasks = useMemo(() => tasks
    .filter(isDashboardWork)
    .filter((task) => task.due_date === dateIso)
    .sort((a, b) => taskSortKey(a).localeCompare(taskSortKey(b))), [dateIso, tasks]);

  const doneDayTasks = useMemo(() => allDayTasks.filter(isDoneTask), [allDayTasks]);

  const routes = useMemo(() => routeOrder
    .map((key) => ({ key, tasks: dayTasks.filter((task) => routeForTask(task) === key) }))
    .filter((route) => route.tasks.length > 0), [dayTasks]);

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
              <div className="atlas-day-route-hero-head"><div><span>Day plan</span><strong>{prettyDate(dateIso)}</strong></div><em className="atlas-day-route-count-pill">{loading ? "…" : dayTasks.length}</em></div>
              <div className="atlas-day-route-grid">
                {routes.length ? routes.map((route) => (
                  <a key={route.key} className="atlas-day-route-box" href={`#atlas-day-route-${route.key}`}>
                    <strong>{routeLabels[route.key]}</strong>
                    <span>{route.tasks.length} {route.tasks.length === 1 ? "task" : "tasks"}</span>
                    <em>{routePreview(route.tasks)}</em>
                  </a>
                )) : <div className="atlas-day-route-empty">{loading ? "Loading farm tasks." : "No open farm tasks planned for this day."}</div>}
              </div>
            </article>

            <div className="atlas-day-task-groups">
              {routes.map((route) => {
                const zones = Array.from(new Set(route.tasks.map(collectionZone)));
                return (
                  <article className="atlas-day-route-group" id={`atlas-day-route-${route.key}`} key={route.key}>
                    <h3>{routeLabels[route.key]}</h3>
                    {zones.map((zone) => (
                      <div className="atlas-day-zone-group" key={zone}>
                        <h4>{zone}</h4>
                        {route.tasks.filter((task) => collectionZone(task) === zone).map((task) => (
                          <TaskCard task={task} key={task.task_id} />
                        ))}
                      </div>
                    ))}
                  </article>
                );
              })}

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
